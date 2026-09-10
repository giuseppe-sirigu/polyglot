import { existsSync, mkdirSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  DEFAULT_SCENARIO_TOOLS,
  type ReplayReport,
  type ScenarioResult,
  type Session,
  ToolRegistry,
  createWebSearchTool,
  listSessions,
  loadConfig,
  loadSession,
  loadSessionFromPath,
  parseToolResultBlocks,
  replaySession,
  runScenario,
  scenarioInvariants,
} from "@usepolyglot/core";
import type { CliArgs } from "./args.js";

function looksLikePath(token: string): boolean {
  return token.includes("/") || token.endsWith(".jsonl") || token.endsWith(".json");
}

/** A `pnpm scenario:live` failure transcript (`captured-failures/*.json`) rebuilt into a
 * `Session` so it can be replayed / `--save`d like a real one. */
interface CapturedFailure {
  userInput: string;
  completions: string[];
  resultsSeenByModel?: string[];
}

function sessionFromCapture(path: string, raw: string): Session | null {
  let parsed: CapturedFailure;
  try {
    parsed = JSON.parse(raw) as CapturedFailure;
  } catch {
    return null;
  }
  if (typeof parsed.userInput !== "string" || !Array.isArray(parsed.completions)) return null;

  const messages: Session["messages"] = [
    { id: "u0", role: "user", content: parsed.userInput, createdAt: 0 },
  ];
  parsed.completions.forEach((completion, i) => {
    messages.push({ id: `a${i}`, role: "assistant", content: completion, createdAt: i * 2 + 1 });
    const recorded = parsed.resultsSeenByModel?.[i];
    if (recorded !== undefined) {
      messages.push({ id: `r${i}`, role: "user", content: recorded, createdAt: i * 2 + 2 });
    }
  });
  return {
    id: path.replace(/^.*\//, "").replace(/\.json$/, ""),
    cwd: "/replay",
    provider: "capture",
    model: "capture",
    messages,
  };
}

/** The tool registry a replayed session is re-resolved against: the real editing toolset the
 * agent loop uses, plus web_search when a config is available. */
function replayRegistry(cwd: string): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of DEFAULT_SCENARIO_TOOLS) registry.register(tool);
  try {
    registry.register(createWebSearchTool(loadConfig(cwd).webSearch));
  } catch {
    // no config - the base tools are enough to re-resolve a transcript
  }
  return registry;
}

async function resolveSession(target: string | undefined, cwd: string): Promise<Session | null> {
  if (target && looksLikePath(target)) {
    const full = isAbsolute(target) ? target : resolve(cwd, target);
    if (full.endsWith(".json")) {
      // a scenario:live capture, not a session .jsonl
      const raw = await readFile(full, "utf8").catch(() => null);
      return raw === null ? null : sessionFromCapture(full, raw);
    }
    return loadSessionFromPath(full);
  }
  const id = target ?? (await listSessions())[0]?.id;
  return id ? loadSession(id) : null;
}

/** Reads a `--seed` directory into a flat `{ relPath: contents }` map (text files only). */
async function readSeedDir(dir: string): Promise<Record<string, string>> {
  const root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  const files: Record<string, string> = {};
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          files[relative(root, full)] = await readFile(full, "utf8");
        } catch {
          // binary / unreadable - skip
        }
      }
    }
  };
  await walk(root);
  return files;
}

function renderParseLevel(report: ReplayReport): string {
  const lines: string[] = [];
  lines.push(`session ${report.sessionId} - ${report.summary.turns} assistant turn(s)`);
  lines.push("");
  for (const turn of report.turns) {
    const calls = turn.resolvedCalls.map((c) => {
      const marks = [
        c.repaired ? "repaired" : null,
        c.correctedFromName ? `was "${c.correctedFromName}"` : null,
      ].filter(Boolean);
      return `${c.name}${marks.length ? ` (${marks.join(", ")})` : ""}`;
    });
    const parts: string[] = [];
    if (calls.length) parts.push(calls.join(", "));
    if (turn.parseErrors.length) parts.push(`${turn.parseErrors.length} parse error(s)`);
    if (!parts.length) parts.push("no tool calls");
    lines.push(`  turn ${turn.turnIndex} [${turn.transport}]: ${parts.join("; ")}`);
  }
  lines.push("");
  if (report.divergences.length === 0) {
    lines.push("✓ no divergence - the current build resolves this session exactly as recorded");
  } else {
    lines.push(`⚠ ${report.divergences.length} divergence(s) from what the session recorded:`);
    for (const d of report.divergences) lines.push(`  - ${d}`);
  }
  const s = report.summary;
  if (s.nowFailsWasOk > 0)
    lines.push(`  ${s.nowFailsWasOk} call(s) no longer resolve - likely a parser regression`);
  if (s.nowOkWasError > 0)
    lines.push(`  ${s.nowOkWasError} call(s) now resolve that previously errored - a fix landed`);
  return `${lines.join("\n")}\n`;
}

interface ExecuteReport {
  mode: "execute";
  invariants: { name: string; status: "pass" | "fail"; error?: string }[];
  stopReason: ScenarioResult["stopReason"];
  toolCalls: { name: string; input: unknown }[];
  recordedToolCalls: string[];
  finalAssistantText: string;
}

function runExecuteInvariants(result: ScenarioResult): ExecuteReport["invariants"] {
  return Object.entries(scenarioInvariants)
    .filter(([name]) => name !== "subAgentSpawnsBounded")
    .map(([name, check]) => {
      try {
        (check as (r: ScenarioResult) => void)(result);
        return { name, status: "pass" as const };
      } catch (err) {
        return {
          name,
          status: "fail" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
}

function renderExecute(report: ExecuteReport): string {
  const lines: string[] = [`execute replay - stop reason: ${report.stopReason ?? "unknown"}`, ""];
  lines.push("invariants:");
  for (const inv of report.invariants) {
    lines.push(
      `  ${inv.status === "pass" ? "✓" : "✗"} ${inv.name}${inv.error ? ` - ${inv.error}` : ""}`,
    );
  }
  lines.push("");
  lines.push(`tool calls now: ${report.toolCalls.map((c) => c.name).join(", ") || "(none)"}`);
  lines.push(`tool calls recorded: ${report.recordedToolCalls.join(", ") || "(none)"}`);
  return `${lines.join("\n")}\n`;
}

function assistantCompletions(session: Session): string[] {
  return session.messages.filter((m) => m.role === "assistant").map((m) => m.content);
}

function firstUserInput(session: Session): string {
  return session.messages.find((m) => m.role === "user")?.content ?? "";
}

function recordedToolCallNames(session: Session): string[] {
  return session.messages
    .filter((m) => m.role === "user")
    .flatMap((m) => parseToolResultBlocks(m.content).map((b) => b.name));
}

async function saveFixture(
  name: string,
  session: Session,
  seedFiles: Record<string, string> | undefined,
  structured: boolean | undefined,
  cwd: string,
): Promise<string> {
  const fixture = {
    name,
    capturedFrom: `session ${session.id} (${session.provider} / ${session.model})`,
    ...(structured ? { structured: true } : {}),
    userInput: firstUserInput(session),
    ...(seedFiles ? { seedFiles } : {}),
    completions: assistantCompletions(session),
    expect: {
      resolvedToolCalls: replaySession(session, replayRegistry(cwd))
        .turns.flatMap((t) => t.resolvedCalls)
        .map((c) => ({ name: c.name, input: c.input })),
      noParseErrors: true,
    },
  };

  const regressionsDir = join(cwd, "packages/core/src/testing/regressions");
  const outPath = existsSync(regressionsDir)
    ? join(regressionsDir, `${name}.json`)
    : resolve(cwd, `${name}.json`);
  if (!existsSync(regressionsDir)) mkdirSync(regressionsDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return outPath;
}

export async function runReplay(args: CliArgs): Promise<number> {
  const cwd = process.cwd();
  const session = await resolveSession(args.replayTarget, cwd);
  if (!session) {
    process.stderr.write(
      args.replayTarget
        ? `[polyglot] no session found for "${args.replayTarget}".\n`
        : "[polyglot] no sessions to replay.\n",
    );
    return 1;
  }

  const structured = args.replayStructured === undefined ? undefined : args.replayStructured;
  const seedFiles = args.replaySeed ? await readSeedDir(args.replaySeed) : undefined;

  if (args.replaySave) {
    const outPath = await saveFixture(args.replaySave, session, seedFiles, structured, cwd);
    process.stderr.write(`[polyglot] wrote regression fixture ${outPath}\n`);
    if (!outPath.includes("testing/regressions")) {
      process.stderr.write(
        "[polyglot] run from the polyglot repo root to write it into packages/core/src/testing/regressions/.\n",
      );
    }
    return 0;
  }

  if (args.replayExecute) {
    if (!seedFiles) {
      process.stderr.write(
        "[polyglot] --execute without --seed <dir>: read_file calls will error (no working-dir files). Continuing.\n",
      );
    }
    const result = await runScenario({
      model: assistantCompletions(session),
      userInput: firstUserInput(session),
      files: seedFiles ?? {},
      structured,
    });
    const report: ExecuteReport = {
      mode: "execute",
      invariants: runExecuteInvariants(result),
      stopReason: result.stopReason,
      toolCalls: result.toolCalls.map((c) => ({ name: c.name, input: c.input })),
      recordedToolCalls: recordedToolCallNames(session),
      finalAssistantText: result.finalAssistantText,
    };
    process.stdout.write(
      args.replayOutputFormat === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : renderExecute(report),
    );
    return report.invariants.some((i) => i.status === "fail") ? 2 : 0;
  }

  const report = replaySession(session, replayRegistry(cwd), { structured });
  process.stdout.write(
    args.replayOutputFormat === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderParseLevel(report),
  );
  return report.summary.nowFailsWasOk > 0 ? 2 : 0;
}
