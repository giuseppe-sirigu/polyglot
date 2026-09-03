import { matchesSecretPath } from "../permissions/secret-paths.js";
import { finalize, resolveEnvelope } from "../tool-protocol/resolve.js";
import { ToolCallStreamParser } from "../tool-protocol/stream-parser.js";
import { parseStructuredEnvelope } from "../tool-protocol/structured-schema.js";
import type { ToolRegistry } from "../tools/types.js";
import { redactSecrets } from "./redact.js";
import type { Message, Session } from "./types.js";

export type TurnItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool_call"; name: string; input: unknown; toolCallId: string }
  | { kind: "tool_parse_error"; message: string; toolCallId: string }
  | { kind: "tool_result"; name: string; text: string; isError: boolean; toolCallId?: string };

// Same shape agent/loop.ts wraps a tool result in before feeding it back as a "user" message.
const TOOL_RESULT_BLOCK =
  /<tool_result name="([^"]*)"( status="error")?>\n([\s\S]*?)\n<\/tool_result>/g;

function decodeAssistant(content: string, tools: ToolRegistry): TurnItem[] {
  const items: TurnItem[] = [];
  const structured = parseStructuredEnvelope(content);
  if (structured.ok) {
    if (structured.value.message.trim()) {
      items.push({ kind: "assistant", text: structured.value.message });
    }
    for (const call of structured.value.tool_calls) {
      const resolved = finalize({ raw: JSON.stringify(call) }, call.name, call.arguments, tools);
      items.push(
        "message" in resolved
          ? { kind: "tool_call", name: call.name, input: call.arguments, toolCallId: "" }
          : { kind: "tool_call", name: resolved.name, input: resolved.input, toolCallId: "" },
      );
    }
    return items;
  }

  const parser = new ToolCallStreamParser();
  const events = [...parser.push(content), ...parser.flush()];
  let buf = "";
  const flush = () => {
    if (buf.trim()) items.push({ kind: "assistant", text: buf });
    buf = "";
  };
  for (const event of events) {
    if (event.type === "text") {
      buf += event.text;
      continue;
    }
    flush();
    const resolved = resolveEnvelope(event.envelope, tools);
    if ("message" in resolved) {
      // Tolerate a call to a tool this registry doesn't know (a historical web_search / MCP
      // call when `share` built a base-tools-only registry): keep it, don't drop it.
      if (event.envelope.declaredName) {
        items.push({
          kind: "tool_call",
          name: event.envelope.declaredName,
          input: event.envelope.body,
          toolCallId: "",
        });
      } else {
        items.push({ kind: "tool_parse_error", message: resolved.message, toolCallId: "" });
      }
    } else {
      items.push({ kind: "tool_call", name: resolved.name, input: resolved.input, toolCallId: "" });
    }
  }
  flush();
  return items;
}

/** Decodes a session's raw messages into structured turn items - the read-only counterpart of
 * the CLI's `reconstructTranscript`, in core so `polyglot share` and any other non-Ink consumer
 * can use it. Tool results are paired positionally to the preceding step's calls. */
export function decodeSessionTurns(messages: Message[], tools: ToolRegistry): TurnItem[] {
  const items: TurnItem[] = [];
  let pendingCallIds: string[] = [];
  let seq = 0;
  const nextId = () => `c${seq++}`;

  for (const message of messages) {
    if (message.role === "user") {
      const blocks = [...message.content.matchAll(TOOL_RESULT_BLOCK)];
      if (blocks.length > 0) {
        blocks.forEach(([, name, errorAttr, text], i) => {
          items.push({
            kind: "tool_result",
            name: name ?? "",
            text: text ?? "",
            isError: Boolean(errorAttr),
            ...(pendingCallIds[i] ? { toolCallId: pendingCallIds[i] } : {}),
          });
        });
      } else {
        items.push({ kind: "user", text: message.content });
      }
      pendingCallIds = [];
      continue;
    }

    const decoded = decodeAssistant(message.content, tools);
    pendingCallIds = [];
    for (const item of decoded) {
      if (item.kind === "tool_call") {
        item.toolCallId = nextId();
        pendingCallIds.push(item.toolCallId);
      } else if (item.kind === "tool_parse_error") {
        item.toolCallId = nextId();
      }
    }
    items.push(...decoded);
  }
  return items;
}

function firstStringArg(input: unknown): string | undefined {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    for (const k of ["command", "path", "file_path", "pattern", "url", "query", "description"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
  }
  return typeof input === "string" ? input : undefined;
}

function toolArgPath(input: unknown): string | undefined {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    for (const k of ["path", "file_path"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
  }
  return undefined;
}

function summariseCall(name: string, input: unknown): string {
  const arg = firstStringArg(input);
  const short = arg && arg.length > 80 ? `${arg.slice(0, 77)}…` : arg;
  return short ? `${name}(${short.replace(/\n/g, " ")})` : name;
}

interface SerializeOptions {
  redact?: boolean;
  includeToolIO?: boolean;
}

interface RenderedTurns {
  turns: TurnItem[];
  redactedCount: number;
}

function prepareTurns(session: Session, tools: ToolRegistry, redact: boolean): RenderedTurns {
  const turns = decodeSessionTurns(session.messages, tools);
  if (!redact) return { turns, redactedCount: 0 };

  // Tool calls touching a secret path (and their paired results) are blanked wholesale.
  const secretCallIds = new Set<string>();
  let redactedCount = 0;
  const out: TurnItem[] = turns.map((t) => {
    if (t.kind === "tool_call") {
      const p = toolArgPath(t.input);
      if (p && matchesSecretPath(p)) {
        secretCallIds.add(t.toolCallId);
        redactedCount++;
        return { ...t, input: "[redacted: secret path]" };
      }
      return t;
    }
    if (t.kind === "tool_result" && t.toolCallId && secretCallIds.has(t.toolCallId)) {
      return { ...t, text: "[redacted: secret path]" };
    }
    if (t.kind === "user" || t.kind === "assistant") {
      const r = redactSecrets(t.text);
      redactedCount += r.count;
      return { ...t, text: r.text };
    }
    if (t.kind === "tool_result") {
      const r = redactSecrets(t.text);
      redactedCount += r.count;
      return { ...t, text: r.text };
    }
    return t;
  });
  return { turns: out, redactedCount };
}

function metaLines(session: Session): string[] {
  return [
    `- model: ${session.provider} / ${session.model}`,
    `- messages: ${session.messages.length}`,
    ...(session.name ? [`- name: ${session.name}`] : []),
    ...(session.cwd ? [`- cwd: ${session.cwd}`] : []),
  ];
}

/** Renders a session as Markdown. `redact` (default true) runs `redactSecrets` over every text
 * block and blanks any tool call/result touching a secret-file path. `includeToolIO` (default
 * false) renders tool calls as one-line summaries with no result bodies. `tools` only affects
 * how nicely repaired tool-call args decode - an empty registry is fine. */
export function serializeSessionMarkdown(
  session: Session,
  tools: ToolRegistry,
  opts: SerializeOptions = {},
): string {
  const redact = opts.redact ?? true;
  const { turns, redactedCount } = prepareTurns(session, tools, redact);
  const lines: string[] = [`# polyglot session ${session.id}`, "", ...metaLines(session), ""];
  if (redact) lines.push(`_${redactedCount} secret-looking value(s) redacted._`, "");

  for (const t of turns) {
    if (t.kind === "user") lines.push("## User", "", t.text.trim(), "");
    else if (t.kind === "assistant") lines.push("## Assistant", "", t.text.trim(), "");
    else if (t.kind === "tool_call") {
      if (opts.includeToolIO) {
        lines.push(
          `### tool: ${t.name}`,
          "",
          "```json",
          JSON.stringify(t.input, null, 2),
          "```",
          "",
        );
      } else {
        lines.push(`- → \`${summariseCall(t.name, t.input)}\``);
      }
    } else if (t.kind === "tool_parse_error") {
      lines.push(`- ⚠ unparseable tool call: ${t.message}`);
    } else if (t.kind === "tool_result" && opts.includeToolIO) {
      lines.push(
        `${t.isError ? "**error**" : "result"} (${t.name}):`,
        "",
        "```",
        t.text.trim(),
        "```",
        "",
      );
    }
  }
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders a session as one self-contained HTML file (inline CSS, no external requests). */
export function serializeSessionHtml(
  session: Session,
  tools: ToolRegistry,
  opts: SerializeOptions = {},
): string {
  const redact = opts.redact ?? true;
  const { turns, redactedCount } = prepareTurns(session, tools, redact);
  const body: string[] = [];
  for (const t of turns) {
    if (t.kind === "user")
      body.push(`<section class="user"><h2>User</h2><pre>${esc(t.text.trim())}</pre></section>`);
    else if (t.kind === "assistant")
      body.push(
        `<section class="assistant"><h2>Assistant</h2><pre>${esc(t.text.trim())}</pre></section>`,
      );
    else if (t.kind === "tool_call") {
      const inner = opts.includeToolIO ? `<pre>${esc(JSON.stringify(t.input, null, 2))}</pre>` : "";
      body.push(
        `<div class="tool">→ <code>${esc(summariseCall(t.name, t.input))}</code>${inner}</div>`,
      );
    } else if (t.kind === "tool_parse_error") {
      body.push(`<div class="tool err">⚠ unparseable tool call: ${esc(t.message)}</div>`);
    } else if (t.kind === "tool_result" && opts.includeToolIO) {
      body.push(
        `<div class="tool ${t.isError ? "err" : ""}"><em>${t.isError ? "error" : "result"} (${esc(t.name)})</em><pre>${esc(t.text.trim())}</pre></div>`,
      );
    }
  }
  const meta = metaLines(session)
    .map((l) => `<li>${esc(l.replace(/^- /, ""))}</li>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>polyglot session ${esc(session.id)}</title>
<style>
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; background: #fafafa; }
  h1 { font-size: 1.1rem; } h2 { font-size: 0.95rem; margin: 1.5rem 0 0.25rem; }
  ul { color: #555; } pre { white-space: pre-wrap; word-break: break-word; background: #fff; border: 1px solid #e2e2e2; border-radius: 4px; padding: 0.6rem 0.8rem; overflow-x: auto; }
  section.user h2 { color: #0a6; } section.assistant h2 { color: #06c; }
  .tool { color: #666; margin: 0.35rem 0; } .tool.err { color: #b00; } code { background: #f0f0f0; padding: 0.05rem 0.3rem; border-radius: 3px; }
  .note { color: #888; font-style: italic; }
</style></head><body>
<h1>polyglot session ${esc(session.id)}</h1>
<ul>${meta}</ul>
${redact ? `<p class="note">${redactedCount} secret-looking value(s) redacted.</p>` : ""}
${body.join("\n")}
</body></html>
`;
}
