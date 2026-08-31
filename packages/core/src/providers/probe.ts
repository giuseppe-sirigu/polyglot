import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { EngineConfig } from "../config/loader.js";
import {
  buildEnvelopeSchema,
  parseStructuredEnvelope,
} from "../tool-protocol/structured-schema.js";
import type { ProviderAdapter, ProviderCapabilities } from "./types.js";

export interface ProbeResult {
  /** Context window from the backend's model metadata, when it exposes any. */
  maxContextTokens?: number;
  /** Whether a schema-constrained request actually came back as a parseable envelope. */
  structuredOutput?: boolean;
  /** Whether the backend reported prompt-token counts in the stream. */
  reportsTokenUsage?: boolean;
  /** ISO timestamp of the probe. */
  probedAt: string;
}

const PROBE_PROMPT =
  'Reply with exactly this JSON object and nothing else: {"message": "ok", "tool_calls": []}';

function probeSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function trimTrailingSlash(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return url.slice(0, end);
}

/**
 * Pings the configured endpoint once to learn what it can actually do: whether it honors
 * structured output (a schema-constrained completion that comes back parseable), whether it
 * reports token usage, and - for openai-compatible backends that expose it - its real context
 * window. Best-effort: any failure or timeout just leaves that field undefined; never throws.
 */
export async function probeCapabilities(
  adapter: ProviderAdapter,
  config: EngineConfig,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const result: ProbeResult = { probedAt: new Date().toISOString() };
  const timeoutMs = opts.timeoutMs ?? 15_000;

  try {
    let text = "";
    for await (const event of adapter.chat(
      {
        model: config.model,
        messages: [{ role: "user", content: PROBE_PROMPT }],
        maxOutputTokens: 64,
        responseSchema: buildEnvelopeSchema([]),
      },
      { signal: probeSignal(opts.signal, timeoutMs) },
    )) {
      if (event.type === "text_delta") text += event.delta;
      if (event.type === "usage" && event.inputTokens > 0) result.reportsTokenUsage = true;
    }
    result.structuredOutput = parseStructuredEnvelope(text).ok;
  } catch {
    // Couldn't complete the probe turn - leave structuredOutput / reportsTokenUsage undefined.
  }

  if (config.provider === "openai-compatible" && config.baseURL) {
    try {
      const res = await fetch(`${trimTrailingSlash(config.baseURL)}/models`, {
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
        signal: probeSignal(opts.signal, timeoutMs),
      });
      if (res.ok) {
        const ctx = parseModelsContextLength(await res.json(), config.model);
        if (ctx) result.maxContextTokens = ctx;
      }
    } catch {
      // /models is optional and its shape varies - a miss here is fine.
    }
  }

  return result;
}

/**
 * Best-effort extraction of a model's context window from a `GET /v1/models` (or
 * `/v1/models/{id}`) response. vLLM includes `max_model_len`; some servers use `context_length`
 * / `max_context_length`. Returns undefined when nothing recognizable is present (Ollama's
 * `/v1/models`, for one, omits it entirely).
 */
export function parseModelsContextLength(body: unknown, model: string): number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const obj = body as Record<string, unknown>;
  const candidates: Record<string, unknown>[] = [];
  if (Array.isArray(obj.data)) {
    for (const entry of obj.data) {
      if (entry && typeof entry === "object") candidates.push(entry as Record<string, unknown>);
    }
  } else {
    candidates.push(obj);
  }
  const match = candidates.find((c) => c.id === model || c.name === model) ?? candidates[0];
  if (!match) return undefined;
  for (const key of ["max_model_len", "context_length", "max_context_length", "context_window"]) {
    const value = match[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

/** Maps a probe result onto the subset of `ProviderCapabilities` it can speak to. */
export function probeResultToCapabilities(result: ProbeResult): Partial<ProviderCapabilities> {
  const caps: Partial<ProviderCapabilities> = {};
  if (typeof result.maxContextTokens === "number") caps.maxContextTokens = result.maxContextTokens;
  if (typeof result.structuredOutput === "boolean") caps.structuredOutput = result.structuredOutput;
  return caps;
}

export function capabilityCacheKey(config: Pick<EngineConfig, "baseURL" | "model">): string {
  return `${config.baseURL ?? ""}|${config.model}`;
}

function cachePath(dir?: string): string {
  return join(dir ?? join(homedir(), ".polyglot"), "capabilities.json");
}

function readCache(dir?: string): Record<string, ProbeResult> {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(dir), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ProbeResult>) : {};
  } catch {
    return {};
  }
}

export function loadCachedCapabilities(key: string, dir?: string): ProbeResult | null {
  return readCache(dir)[key] ?? null;
}

export function saveCachedCapabilities(key: string, result: ProbeResult, dir?: string): void {
  const path = cachePath(dir);
  const cache = readCache(dir);
  cache[key] = result;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}
