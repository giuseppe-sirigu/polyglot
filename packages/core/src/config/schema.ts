import { z } from "zod";

/** One shell command wired to an agent lifecycle point - see hooks/dispatcher.ts for the
 * stdin payload / exit-code contract. */
export const HookSpecSchema = z.object({
  command: z.string(),
  /** Glob-matched tool names this hook fires for (pre/postToolUse only). Unset = every tool. */
  tools: z.array(z.string()).optional(),
  /** Kill the hook after this many ms (default 5000). */
  timeoutMs: z.number().int().positive().optional(),
});

export const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

/** One selectable entry for the `/model` command - a full engine config (its own
 * provider/baseURL/apiKey/structuredOutput, independent of the top-level settings) plus a
 * friendly display label. `model` doubles as both the literal model id sent to the provider and
 * the identifier `/model <query>` matches against. */
export const ModelEntrySchema = z.object({
  provider: z.enum(["anthropic", "openai-compatible"]),
  model: z.string(),
  label: z.string().optional(),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  structuredOutput: z.boolean().optional(),
});

export const SettingsSchema = z.object({
  provider: z.enum(["anthropic", "openai-compatible"]).optional(),
  model: z.string().optional(),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  /** Opt-in grammar/schema-constrained decoding for the openai-compatible provider - see
   * ChatRequest.responseSchema. Inert (ignored) when provider is "anthropic". */
  structuredOutput: z.boolean().optional(),
  /** Opt-in: on startup, ping the openai-compatible endpoint once to learn its real context
   * window and whether it actually honors structured output, caching the result in
   * ~/.polyglot/capabilities.json. `--probe` forces a fresh probe. Off by default. */
  probeCapabilities: z.boolean().optional(),
  /** Whether the `task` sub-agent tool is available. Unset → on for models with reliable
   * native tool-calling (anthropic), off otherwise: a weak model that delegates to itself
   * mostly just burns turns. */
  subAgents: z.boolean().optional(),
  /** Model id or `/model`-style label for `task` sub-agents to run on. Unset = the same model
   * as the parent. Points at a `models[]` entry (or the startup model); a cheaper/smaller
   * model here is an easy cost win for delegated grunt work. */
  subAgentModel: z.string().optional(),
  /** Per-model price overrides for cost estimates (USD per 1M tokens), keyed by model id.
   * Wins over the built-in Anthropic table for any provider - the way to put a nominal rate
   * on a local model, or to correct a stale built-in. */
  pricing: z
    .record(
      z.string(),
      z.object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cachedInput: z.number().nonnegative().optional(),
      }),
    )
    .default({}),
  /** Selectable via the `/model` command at runtime - session-local only, never rewritten to
   * disk. See config/model-options.ts. */
  models: z.array(ModelEntrySchema).default([]),
  permissions: z
    .object({
      mode: z.enum(["manual", "auto", "plan"]).default("manual"),
      allow: z.array(z.string()).default([]),
      deny: z.array(z.string()).default([]),
    })
    .prefault({}),
  mcpServers: z.record(z.string(), McpServerConfigSchema).default({}),
  /** When false, nothing about a conversation is written to `~/.polyglot/` - no session
   * transcript, no usage line, no saved plan. `--resume` within the same process still works;
   * once it exits there is nothing to resume. Default true (see loader.ts). */
  persistTranscripts: z.boolean().optional(),
  /** When set, session transcripts and saved plans older than this many days are deleted on
   * startup. Unset = kept indefinitely (the historical behavior). */
  retentionDays: z.number().int().positive().optional(),
  /** Backend for the `web_search` tool. `provider` is left without a schema default so
   * layered configs can distinguish "unset" from "set"; the `duckduckgo` default is applied in
   * loader.ts. `baseURL` is the SearXNG instance URL; `apiKey` is for tavily/brave. */
  webSearch: z
    .object({
      provider: z.enum(["duckduckgo", "searxng", "tavily", "brave"]).optional(),
      apiKey: z.string().optional(),
      baseURL: z.string().optional(),
    })
    .optional(),
  /** Undefined means "never asked" - the CLI shows a one-time consent prompt
   * in that case. true/false is the user's stored answer, applied silently
   * on every future run. Lives only in the global settings file, never
   * merged from project-local settings (this is a per-machine choice). */
  autoUpdate: z.boolean().optional(),
  /** Opt-in tamper-evident-ish record of every tool call / result / permission decision /
   * usage / stop, one JSONL file per session under ~/.polyglot/audit. Sub-fields are left
   * without schema defaults so layered configs can tell "unset" from "set" - the effective
   * defaults (enabled: false, hashArgs: true) are applied in loader.ts. */
  audit: z
    .object({
      enabled: z.boolean().optional(),
      /** When false, raw tool-call arguments are recorded alongside their hash. */
      hashArgs: z.boolean().optional(),
      /** Override the audit directory (default ~/.polyglot/audit). */
      path: z.string().optional(),
    })
    .optional(),
  /** Content scanning of tool output for secret- / PII-looking values before it reaches the
   * model. Sub-fields left without schema defaults so layered configs can tell "unset" from
   * "set" - effective defaults (scanOutput: true, mode: "warn", pii: false) applied in
   * loader.ts. */
  redaction: z
    .object({
      /** Scan every tool result. Default true. */
      scanOutput: z.boolean().optional(),
      /** "warn" flags findings but leaves the text the model sees unchanged; "redact" replaces
       * matches with `[redacted:<label>]`. Default "warn". */
      mode: z.enum(["warn", "redact"]).optional(),
      /** Also scan for the noisier PII formats (email, US SSN, card, phone). Default false. */
      pii: z.boolean().optional(),
      /** Extra patterns, each a `label` and a JS `regex` source string (compiled with the `g`
       * flag; an invalid one is dropped with a warning, never fatal). */
      extraPatterns: z.array(z.object({ label: z.string(), regex: z.string() })).optional(),
    })
    .optional(),
  /** Shell commands run at agent lifecycle points. Project-local hooks (`.polyglot/settings.json`)
   * are ignored unless the global settings set `allowProjectHooks: true` - running polyglot in an
   * untrusted repo must not execute its shell. `POLYGLOT_NO_HOOKS=1` disables all. */
  hooks: z
    .object({
      preToolUse: z.array(HookSpecSchema).optional(),
      postToolUse: z.array(HookSpecSchema).optional(),
      userPromptSubmit: z.array(HookSpecSchema).optional(),
      /** Global-file only: whether hooks defined in a project settings file run at all. */
      allowProjectHooks: z.boolean().optional(),
    })
    .optional(),
  /** Model routing. All entries are model ids/labels resolved against `models[]` (or the
   * startup model), the same way `/model <query>` matches. Left without schema defaults so
   * layered configs can tell "unset" from "set" - `failover` defaults to `[]` in loader.ts. */
  routing: z
    .object({
      /** Ordered fallback models. If the active model errors or stops producing valid tool
       * calls mid-turn, the turn continues on the next one (sticky for the session). */
      failover: z.array(z.string()).optional(),
      /** Model to run `/compact` and automatic compaction on, instead of the session's. */
      summaryModel: z.string().optional(),
      /** Model to run plan-mode turns on. Disabled for the session after a manual `/model`. */
      planModel: z.string().optional(),
    })
    .optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type HookSpecConfig = z.infer<typeof HookSpecSchema>;

export const EMPTY_SETTINGS: Settings = SettingsSchema.parse({});
