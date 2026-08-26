import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { EMPTY_SETTINGS, type Settings, SettingsSchema } from "./schema.js";

export interface EngineConfig {
  provider: "anthropic" | "openai-compatible";
  model: string;
  baseURL?: string;
  apiKey?: string;
}

export interface ResolvedConfig {
  engine: EngineConfig;
  permissions: Settings["permissions"];
  mcpServers: Settings["mcpServers"];
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
  const path = globalSettingsPath();
  const raw = readRawSettingsFile(path);
  raw.autoUpdate = value;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

function mergeSettings(base: Settings, override: Settings): Settings {
  return {
    provider: override.provider ?? base.provider,
    model: override.model ?? base.model,
    baseURL: override.baseURL ?? base.baseURL,
    apiKey: override.apiKey ?? base.apiKey,
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

  return {
    provider,
    model: env.POLYGLOT_MODEL ?? settings.model,
    baseURL: env.POLYGLOT_BASE_URL ?? settings.baseURL,
    apiKey:
      (provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.POLYGLOT_API_KEY) ?? settings.apiKey,
    permissions: { ...settings.permissions, mode },
    mcpServers: settings.mcpServers,
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
    },
    permissions: merged.permissions,
    mcpServers: merged.mcpServers,
  };
}
