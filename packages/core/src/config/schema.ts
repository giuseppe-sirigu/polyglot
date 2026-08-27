import { z } from "zod";

export const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
});

/** One selectable entry for the `/model` command — a full engine config (its own
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
  /** Opt-in grammar/schema-constrained decoding for the openai-compatible provider — see
   * ChatRequest.responseSchema. Inert (ignored) when provider is "anthropic". */
  structuredOutput: z.boolean().optional(),
  /** Selectable via the `/model` command at runtime — session-local only, never rewritten to
   * disk. See config/model-options.ts. */
  models: z.array(ModelEntrySchema).default([]),
  permissions: z
    .object({
      mode: z.enum(["manual", "auto", "plan"]).default("manual"),
      allow: z.array(z.string()).default([]),
      deny: z.array(z.string()).default([]),
    })
    .default({}),
  mcpServers: z.record(McpServerConfigSchema).default({}),
  /** Undefined means "never asked" — the CLI shows a one-time consent prompt
   * in that case. true/false is the user's stored answer, applied silently
   * on every future run. Lives only in the global settings file, never
   * merged from project-local settings (this is a per-machine choice). */
  autoUpdate: z.boolean().optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const EMPTY_SETTINGS: Settings = SettingsSchema.parse({});
