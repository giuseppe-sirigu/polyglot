import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ResolvedHooks } from "../hooks/dispatcher.js";
import type { SecretPattern } from "../permissions/secret-patterns.js";
import type { ModelPricing } from "../pricing/pricing.js";
import type { WebSearchConfig } from "../tools/web-search.js";
import { type AgentDefinition, loadAgentDefinitions } from "./agents.js";
import { type ProjectInstructions, loadProjectInstructions } from "./instructions.js";
import {
  EMPTY_SETTINGS,
  type ModelEntry,
  ModelEntrySchema,
  type Settings,
  SettingsSchema,
} from "./schema.js";
import { type Skill, loadSkills } from "./skills.js";

export interface EngineConfig {
  provider: "anthropic" | "openai-compatible";
  model: string;
  baseURL?: string;
  apiKey?: string;
  structuredOutput?: boolean;
}

export interface ResolvedConfig {
  engine: EngineConfig;
  permissions: Settings["permissions"];
  mcpServers: Settings["mcpServers"];
  /** See SettingsSchema.probeCapabilities. `--probe` forces it on for one run. */
  probeCapabilities?: boolean;
  /** See SettingsSchema.subAgents. Unset here means "let the frontend decide from the model's
   * tool-calling reliability". */
  subAgents?: boolean;
  /** See SettingsSchema.subAgentModel. Unset means "sub-agents run on the parent's model". */
  subAgentModel?: string;
  /** Per-model price overrides for cost estimates - always resolved (defaults to `{}`). */
  pricing: Record<string, ModelPricing>;
  /** See SettingsSchema.audit - always resolved (defaults: disabled, args hashed). */
  audit: { enabled: boolean; hashArgs: boolean; path?: string };
  /** Selectable via the `/model` command — see config/model-options.ts. */
  models: ModelEntry[];
  /** See SettingsSchema.persistTranscripts. Also forced off by `--no-persist`. */
  persistTranscripts: boolean;
  /** See SettingsSchema.retentionDays. */
  retentionDays?: number;
  /** Backend for the `web_search` tool — always resolved (defaults to `duckduckgo`). */
  webSearch: WebSearchConfig;
  /** Content scanning of tool output — always resolved (`scanOutput: true`, `mode: "warn"`,
   * `pii: false` when unset). `extraPatterns` are already compiled; ones that didn't compile
   * are named in `invalidPatterns` for the frontend to warn about. */
  redaction: {
    scanOutput: boolean;
    mode: "warn" | "redact";
    pii: boolean;
    extraPatterns: SecretPattern[];
    invalidPatterns: string[];
  };
  /** `AGENTS.md` / `POLYGLOT.md` contents (project + global), spliced into the system prompt.
   * Always resolved (empty when no file exists or `POLYGLOT_NO_INSTRUCTIONS` is set). */
  projectInstructions: ProjectInstructions;
  /** Agent definitions from `~/.polyglot/agents/` + `<cwd>/.polyglot/agents/` - invoked via
   * `@<name>`. Always resolved (`[]` when none or `POLYGLOT_NO_AGENTS` is set). */
  agents: AgentDefinition[];
  /** Skills from `~/.polyglot/skills/` + `<cwd>/.polyglot/skills/` - activated for a session via
   * `@<name>`. Always resolved (`[]` when none or `POLYGLOT_NO_SKILLS` is set). */
  skills: Skill[];
  /** Lifecycle hooks - always resolved (all `[]` when none, `POLYGLOT_NO_HOOKS` is set, or a
   * project file defines them without the global opt-in). */
  hooks: ResolvedHooks;
  /** Model routing - see SettingsSchema.routing. Always resolved (`failover` defaults to `[]`).
   * Entries are model ids/labels the frontend resolves against `models[]`. */
  routing: { failover: string[]; summaryModel?: string; planModel?: string };
}

/** Resolves the API key for `provider`: the provider-specific env var wins over an explicit
 * value (matching how every other env override in this file takes precedence over settings
 * files), falling back to `explicit` when the env var isn't set. Shared by applyEnvOverrides()
 * (for the top-level engine) and config/model-options.ts (for a single `/model` entry, whose own
 * provider may differ from whichever one was active at startup). */
export function resolveApiKey(
  provider: "anthropic" | "openai-compatible",
  explicit: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  return (provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.POLYGLOT_API_KEY) ?? explicit;
}

const DEFAULT_CONTEXT_TOKENS = 128_000;
export const DEFAULT_MAX_CONTEXT_TOKENS = DEFAULT_CONTEXT_TOKENS;

export function globalSettingsPath(): string {
  return join(homedir(), ".polyglot", "settings.json");
}

export function projectSettingsPath(cwd: string): string {
  return join(cwd, ".polyglot", "settings.json");
}

function loadSettingsFile(path: string): Settings {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return EMPTY_SETTINGS;
  }
  const parsed = JSON.parse(raw);
  // Silently drop `models` entries that don't match the current shape (e.g. left over from a
  // hand-edit or an earlier, incompatible attempt at this file) instead of letting one bad
  // entry make the whole settings file — and therefore the whole CLI — fail to load. Everything
  // else in the file is still validated strictly by the SettingsSchema.parse() below.
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.models)) {
    parsed.models = parsed.models.filter(
      (entry: unknown) => ModelEntrySchema.safeParse(entry).success,
    );
  }
  return SettingsSchema.parse(parsed);
}

function readRawSettingsFile(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** Undefined = the user has never been asked. This intentionally reads only
 * the global settings file (not project-local, not env vars) — whether to
 * self-update is a per-machine choice, not a per-project one. */
export function getAutoUpdatePreference(): boolean | undefined {
  const value = readRawSettingsFile(globalSettingsPath()).autoUpdate;
  return typeof value === "boolean" ? value : undefined;
}

/** Merges just the autoUpdate key into the global settings file, preserving
 * everything else in it untouched (including keys this schema doesn't know
 * about, in case the user hand-edited the file). */
export function setAutoUpdatePreference(value: boolean): void {
  writeGlobalSettings({ autoUpdate: value });
}

/** Shallow-merges `patch` into `~/.polyglot/settings.json`, creating the file (and its
 * directory) if needed and leaving every other key - including ones this schema doesn't know
 * about - untouched. Used by `polyglot init` and `setAutoUpdatePreference`. */
export function writeGlobalSettings(patch: Record<string, unknown>): void {
  const path = globalSettingsPath();
  const raw = { ...readRawSettingsFile(path), ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

/** Concatenates two `models` lists (project can add to the global list, not just replace it),
 * deduping entries that identify the same model by (provider, model, baseURL) — on a collision
 * the later (override/project) entry's data wins, but keeps the earlier entry's position, so
 * genuinely new entries still land at the end in the order they were added. */
function mergeModels(base: ModelEntry[], override: ModelEntry[]): ModelEntry[] {
  const byKey = new Map<string, ModelEntry>();
  for (const entry of [...base, ...override]) {
    byKey.set(`${entry.provider}\0${entry.model}\0${entry.baseURL ?? ""}`, entry);
  }
  return [...byKey.values()];
}

function mergeSettings(base: Settings, override: Settings): Settings {
  return {
    provider: override.provider ?? base.provider,
    model: override.model ?? base.model,
    baseURL: override.baseURL ?? base.baseURL,
    apiKey: override.apiKey ?? base.apiKey,
    structuredOutput: override.structuredOutput ?? base.structuredOutput,
    probeCapabilities: override.probeCapabilities ?? base.probeCapabilities,
    subAgents: override.subAgents ?? base.subAgents,
    subAgentModel: override.subAgentModel ?? base.subAgentModel,
    pricing: { ...base.pricing, ...override.pricing },
    audit:
      base.audit || override.audit
        ? {
            enabled: override.audit?.enabled ?? base.audit?.enabled,
            hashArgs: override.audit?.hashArgs ?? base.audit?.hashArgs,
            path: override.audit?.path ?? base.audit?.path,
          }
        : undefined,
    persistTranscripts: override.persistTranscripts ?? base.persistTranscripts,
    retentionDays: override.retentionDays ?? base.retentionDays,
    webSearch:
      base.webSearch || override.webSearch
        ? {
            provider: override.webSearch?.provider ?? base.webSearch?.provider,
            apiKey: override.webSearch?.apiKey ?? base.webSearch?.apiKey,
            baseURL: override.webSearch?.baseURL ?? base.webSearch?.baseURL,
          }
        : undefined,
    redaction:
      base.redaction || override.redaction
        ? {
            scanOutput: override.redaction?.scanOutput ?? base.redaction?.scanOutput,
            mode: override.redaction?.mode ?? base.redaction?.mode,
            pii: override.redaction?.pii ?? base.redaction?.pii,
            // Project patterns extend the global set rather than replacing it.
            extraPatterns:
              base.redaction?.extraPatterns || override.redaction?.extraPatterns
                ? [
                    ...(base.redaction?.extraPatterns ?? []),
                    ...(override.redaction?.extraPatterns ?? []),
                  ]
                : undefined,
          }
        : undefined,
    routing:
      base.routing || override.routing
        ? {
            failover: override.routing?.failover ?? base.routing?.failover,
            summaryModel: override.routing?.summaryModel ?? base.routing?.summaryModel,
            planModel: override.routing?.planModel ?? base.routing?.planModel,
          }
        : undefined,
    models: mergeModels(base.models, override.models),
    permissions: {
      mode:
        override.permissions.mode !== "manual" ? override.permissions.mode : base.permissions.mode,
      allow: [...base.permissions.allow, ...override.permissions.allow],
      deny: [...base.permissions.deny, ...override.permissions.deny],
    },
    mcpServers: { ...base.mcpServers, ...override.mcpServers },
  };
}

function applyEnvOverrides(settings: Settings, env: NodeJS.ProcessEnv): Settings {
  const provider =
    env.POLYGLOT_PROVIDER === "anthropic" || env.POLYGLOT_PROVIDER === "openai-compatible"
      ? env.POLYGLOT_PROVIDER
      : settings.provider;
  const mode =
    env.POLYGLOT_PERMISSION_MODE === "manual" ||
    env.POLYGLOT_PERMISSION_MODE === "auto" ||
    env.POLYGLOT_PERMISSION_MODE === "plan"
      ? env.POLYGLOT_PERMISSION_MODE
      : settings.permissions.mode;
  const structuredOutput =
    env.POLYGLOT_STRUCTURED_OUTPUT === "true" || env.POLYGLOT_STRUCTURED_OUTPUT === "1"
      ? true
      : env.POLYGLOT_STRUCTURED_OUTPUT === "false" || env.POLYGLOT_STRUCTURED_OUTPUT === "0"
        ? false
        : settings.structuredOutput;
  const probeCapabilities =
    env.POLYGLOT_PROBE === "true" || env.POLYGLOT_PROBE === "1"
      ? true
      : env.POLYGLOT_PROBE === "false" || env.POLYGLOT_PROBE === "0"
        ? false
        : settings.probeCapabilities;
  const auditEnabled =
    env.POLYGLOT_AUDIT === "true" || env.POLYGLOT_AUDIT === "1"
      ? true
      : env.POLYGLOT_AUDIT === "false" || env.POLYGLOT_AUDIT === "0"
        ? false
        : settings.audit?.enabled;
  const persistTranscripts =
    env.POLYGLOT_NO_PERSIST === "true" || env.POLYGLOT_NO_PERSIST === "1"
      ? false
      : settings.persistTranscripts;

  const noOutputScan =
    env.POLYGLOT_NO_OUTPUT_SCAN === "true" || env.POLYGLOT_NO_OUTPUT_SCAN === "1";
  const redactOutput = env.POLYGLOT_REDACT_OUTPUT === "true" || env.POLYGLOT_REDACT_OUTPUT === "1";
  const redaction =
    settings.redaction || noOutputScan || redactOutput
      ? {
          scanOutput: noOutputScan ? false : settings.redaction?.scanOutput,
          mode: redactOutput ? ("redact" as const) : settings.redaction?.mode,
          pii: settings.redaction?.pii,
          extraPatterns: settings.redaction?.extraPatterns,
        }
      : undefined;
  const parsedRetention = Number.parseInt(env.POLYGLOT_RETENTION_DAYS ?? "", 10);
  const retentionDays =
    Number.isInteger(parsedRetention) && parsedRetention > 0
      ? parsedRetention
      : settings.retentionDays;

  const wsProviderEnv = env.POLYGLOT_WEBSEARCH_PROVIDER;
  const wsProvider =
    wsProviderEnv === "duckduckgo" ||
    wsProviderEnv === "searxng" ||
    wsProviderEnv === "tavily" ||
    wsProviderEnv === "brave"
      ? wsProviderEnv
      : settings.webSearch?.provider;
  const webSearch = {
    provider: wsProvider,
    apiKey: env.POLYGLOT_WEBSEARCH_API_KEY ?? settings.webSearch?.apiKey,
    baseURL: env.POLYGLOT_WEBSEARCH_BASE_URL ?? settings.webSearch?.baseURL,
  };

  const failoverEnv = env.POLYGLOT_ROUTING_FAILOVER?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const routing =
    settings.routing || failoverEnv || env.POLYGLOT_SUMMARY_MODEL || env.POLYGLOT_PLAN_MODEL
      ? {
          failover: failoverEnv ?? settings.routing?.failover,
          summaryModel: env.POLYGLOT_SUMMARY_MODEL ?? settings.routing?.summaryModel,
          planModel: env.POLYGLOT_PLAN_MODEL ?? settings.routing?.planModel,
        }
      : undefined;

  return {
    provider,
    model: env.POLYGLOT_MODEL ?? settings.model,
    baseURL: env.POLYGLOT_BASE_URL ?? settings.baseURL,
    apiKey: resolveApiKey(provider ?? "openai-compatible", settings.apiKey, env),
    structuredOutput,
    probeCapabilities,
    subAgents:
      env.POLYGLOT_SUB_AGENTS === "true" || env.POLYGLOT_SUB_AGENTS === "1"
        ? true
        : env.POLYGLOT_SUB_AGENTS === "false" || env.POLYGLOT_SUB_AGENTS === "0"
          ? false
          : settings.subAgents,
    subAgentModel: env.POLYGLOT_SUB_AGENT_MODEL ?? settings.subAgentModel,
    pricing: settings.pricing,
    audit: {
      enabled: auditEnabled,
      hashArgs: settings.audit?.hashArgs,
      path: settings.audit?.path,
    },
    persistTranscripts,
    retentionDays,
    webSearch,
    redaction,
    routing,
    models: settings.models,
    permissions: { ...settings.permissions, mode },
    mcpServers: settings.mcpServers,
  };
}

/** Resolves the `redaction` block to effective values and compiles `extraPatterns` (dropping
 * any whose regex doesn't compile - their labels come back in `invalidPatterns`). */
function resolveRedaction(r: Settings["redaction"]): ResolvedConfig["redaction"] {
  const extraPatterns: SecretPattern[] = [];
  const invalidPatterns: string[] = [];
  for (const p of r?.extraPatterns ?? []) {
    try {
      extraPatterns.push({ label: p.label, re: new RegExp(p.regex, "g") });
    } catch {
      invalidPatterns.push(p.label);
    }
  }
  return {
    scanOutput: r?.scanOutput ?? true,
    mode: r?.mode ?? "warn",
    pii: r?.pii ?? false,
    extraPatterns,
    invalidPatterns,
  };
}

/** Resolves lifecycle hooks. Project hooks are folded in only when the global config sets
 * `allowProjectHooks: true`; `POLYGLOT_NO_HOOKS` clears everything. */
function resolveHooks(
  globalHooks: Settings["hooks"],
  projectHooks: Settings["hooks"],
  env: NodeJS.ProcessEnv,
): ResolvedHooks {
  const empty: ResolvedHooks = { preToolUse: [], postToolUse: [], userPromptSubmit: [] };
  if (env.POLYGLOT_NO_HOOKS === "1" || env.POLYGLOT_NO_HOOKS === "true") return empty;

  const project = globalHooks?.allowProjectHooks ? projectHooks : undefined;
  return {
    preToolUse: [...(globalHooks?.preToolUse ?? []), ...(project?.preToolUse ?? [])],
    postToolUse: [...(globalHooks?.postToolUse ?? []), ...(project?.postToolUse ?? [])],
    userPromptSubmit: [
      ...(globalHooks?.userPromptSubmit ?? []),
      ...(project?.userPromptSubmit ?? []),
    ],
  };
}

/**
 * Merges global (~/.polyglot/settings.json), project (.polyglot/settings.json),
 * and environment variables — later layers win — into a fully resolved config.
 */
export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const globalSettings = loadSettingsFile(globalSettingsPath());
  const projectSettings = loadSettingsFile(projectSettingsPath(cwd));
  const merged = applyEnvOverrides(mergeSettings(globalSettings, projectSettings), env);

  if (merged.provider !== "anthropic" && merged.provider !== "openai-compatible") {
    throw new Error(
      'Provider not set. Set POLYGLOT_PROVIDER=anthropic|openai-compatible, or "provider" in .polyglot/settings.json.',
    );
  }
  if (!merged.model) {
    throw new Error('Model not set. Set POLYGLOT_MODEL, or "model" in .polyglot/settings.json.');
  }
  if (merged.provider === "anthropic" && !merged.apiKey) {
    throw new Error("ANTHROPIC_API_KEY must be set when provider is anthropic.");
  }

  return {
    engine: {
      provider: merged.provider,
      model: merged.model,
      baseURL:
        merged.provider === "openai-compatible"
          ? (merged.baseURL ?? "http://localhost:11434/v1")
          : undefined,
      apiKey: merged.apiKey,
      structuredOutput:
        merged.provider === "openai-compatible" ? merged.structuredOutput : undefined,
    },
    permissions: merged.permissions,
    mcpServers: merged.mcpServers,
    probeCapabilities: merged.probeCapabilities,
    subAgents: merged.subAgents,
    subAgentModel: merged.subAgentModel,
    pricing: merged.pricing,
    audit: {
      enabled: merged.audit?.enabled ?? false,
      hashArgs: merged.audit?.hashArgs ?? true,
      path: merged.audit?.path,
    },
    models: merged.models,
    persistTranscripts: merged.persistTranscripts ?? true,
    retentionDays: merged.retentionDays,
    webSearch: {
      provider: merged.webSearch?.provider ?? "duckduckgo",
      apiKey: merged.webSearch?.apiKey,
      baseURL: merged.webSearch?.baseURL,
    },
    redaction: resolveRedaction(merged.redaction),
    routing: {
      failover: merged.routing?.failover ?? [],
      summaryModel: merged.routing?.summaryModel,
      planModel: merged.routing?.planModel,
    },
    projectInstructions: loadProjectInstructions(cwd, env),
    agents: loadAgentDefinitions(cwd, env),
    skills: loadSkills(cwd, env),
    hooks: resolveHooks(globalSettings.hooks, projectSettings.hooks, env),
  };
}
