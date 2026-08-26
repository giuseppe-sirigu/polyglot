import { z } from "zod";

export const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
});

export const SettingsSchema = z.object({
  provider: z.enum(["anthropic", "openai-compatible"]).optional(),
  model: z.string().optional(),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
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

export const EMPTY_SETTINGS: Settings = SettingsSchema.parse({});
