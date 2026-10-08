/**
 * Context-window checks. A local server that receives more prompt than its context window holds
 * usually doesn't fail: it quietly drops the start of the prompt (Ollama keeps the last `num_ctx`
 * tokens) and answers from what's left, so an agent loses its instructions and tool docs with no
 * error. Two ways to catch it: ask the server what its window is, and compare what was sent with
 * what the server says it read.
 */

/** Below this, a short prompt's estimate is too rough to judge. */
const MIN_TOKENS_TO_JUDGE = 1500;
/** The estimate (characters / 4) undercounts real tokens for code, JSON and most prose, so a
 * server reporting under 70% of it read clearly less than it was sent. The usual case it catches:
 * ~7,500 tokens sent to Ollama at its default 4,096-token window. */
const TRUNCATED_BELOW = 0.7;

export interface TruncationCheck {
  truncated: boolean;
  /** Tokens sent, estimated from the prompt's length. */
  estimatedTokens: number;
  /** Prompt tokens the server says it read. */
  reportedTokens: number;
}

/** Whether a server read much less of a prompt than it was sent: the sign of silent truncation. */
export function checkTruncation(sentChars: number, reportedTokens: number): TruncationCheck {
  const estimatedTokens = Math.ceil(sentChars / 4);
  return {
    truncated:
      estimatedTokens >= MIN_TOKENS_TO_JUDGE &&
      reportedTokens > 0 &&
      reportedTokens < estimatedTokens * TRUNCATED_BELOW,
    estimatedTokens,
    reportedTokens,
  };
}

export interface OllamaContext {
  /** The window of the model as loaded right now (`/api/ps`): what actually applies. */
  loaded?: number;
  /** `num_ctx` set in the model's Modelfile parameters (`/api/show`). */
  configured?: number;
  /** The model's trained maximum (`/api/show` model_info `<arch>.context_length`). */
  trained?: number;
}

/** The context window as Ollama reports it, from its own API next to the OpenAI-compatible one
 * (`http://host:11434/v1` -> `http://host:11434/api/...`). Best effort: anything it can't read is
 * left out; a server that isn't Ollama returns {}. Never throws. */
export async function probeOllamaContext(
  baseURL: string,
  model: string,
  signal?: AbortSignal,
): Promise<OllamaContext> {
  const root = ollamaRoot(baseURL);
  const result: OllamaContext = {};
  try {
    const res = await fetch(`${root}/api/ps`, { signal });
    if (res.ok) {
      const loaded = parseOllamaPs(await res.json(), model);
      if (loaded) result.loaded = loaded;
    }
  } catch {
    // not Ollama, or unreachable
  }
  try {
    const res = await fetch(`${root}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal,
    });
    if (res.ok) Object.assign(result, parseOllamaShow(await res.json()));
  } catch {
    // not Ollama, or unreachable
  }
  return result;
}

/** `http://host:11434/v1/` -> `http://host:11434`. Plain string operations rather than a regular
 * expression, so a URL with a long run of slashes can't make it slow. */
export function ollamaRoot(baseURL: string): string {
  let end = baseURL.length;
  while (end > 0 && baseURL.charCodeAt(end - 1) === 47 /* "/" */) end--;
  const trimmed = baseURL.slice(0, end);
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

/** `/api/ps`: `{ models: [{ name, model, context_length }] }`, the loaded models. */
export function parseOllamaPs(body: unknown, model: string): number | undefined {
  const models = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return undefined;
  const entry = models.find(
    (m) =>
      m &&
      typeof m === "object" &&
      ((m as { name?: unknown }).name === model || (m as { model?: unknown }).model === model),
  ) as { context_length?: unknown } | undefined;
  const value = entry?.context_length;
  return typeof value === "number" && value > 0 ? value : undefined;
}

/** `/api/show`: `parameters` is Modelfile text ("num_ctx 8192\n..."); `model_info` holds the
 * trained window under `<architecture>.context_length`. */
export function parseOllamaShow(body: unknown): Pick<OllamaContext, "configured" | "trained"> {
  const out: Pick<OllamaContext, "configured" | "trained"> = {};
  if (!body || typeof body !== "object") return out;
  const { parameters, model_info } = body as { parameters?: unknown; model_info?: unknown };
  if (typeof parameters === "string") {
    // One parameter per line ("num_ctx 8192"); parsed line by line, without a multiline regex.
    for (const line of parameters.split("\n")) {
      const [key, value, ...rest] = line.trim().split(/\s+/);
      if (key === "num_ctx" && rest.length === 0 && value !== undefined && /^\d+$/.test(value))
        out.configured = Number(value);
    }
  }
  if (model_info && typeof model_info === "object") {
    for (const [key, value] of Object.entries(model_info as Record<string, unknown>)) {
      if (key.endsWith(".context_length") && typeof value === "number" && value > 0)
        out.trained = value;
    }
  }
  return out;
}

/** The window that applies: as loaded, else as configured. The trained maximum isn't it: Ollama
 * runs a model at its own default unless told otherwise. */
export const effectiveOllamaContext = (c: OllamaContext): number | undefined =>
  c.loaded ?? c.configured;
