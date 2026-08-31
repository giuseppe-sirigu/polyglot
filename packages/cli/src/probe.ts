import {
  type ProbeResult,
  type ProviderAdapter,
  type ResolvedConfig,
  capabilityCacheKey,
  createProviderAdapter,
  loadCachedCapabilities,
  probeCapabilities,
  probeResultToCapabilities,
  saveCachedCapabilities,
} from "@usepolyglot/core";

function describeProbe(result: ProbeResult): string {
  const parts: string[] = [];
  if (typeof result.maxContextTokens === "number") {
    parts.push(`context window ${result.maxContextTokens.toLocaleString()}`);
  }
  if (typeof result.structuredOutput === "boolean") {
    parts.push(`structured output ${result.structuredOutput ? "honored" : "not honored"}`);
  }
  return `Probed ${parts.length > 0 ? parts.join(", ") : "endpoint - no capabilities detected"}.`;
}

/**
 * When capability probing is enabled (`--probe` or `probeCapabilities` in settings), pings the
 * openai-compatible endpoint once and returns an adapter rebuilt with the detected capabilities.
 * `force` (from `--probe`) always re-probes; otherwise a cached result from a previous probe is
 * reused when present. Best-effort - any failure leaves the original adapter untouched.
 */
export async function applyCapabilityProbe(
  adapter: ProviderAdapter,
  resolved: ResolvedConfig,
  opts: { force: boolean },
): Promise<{ adapter: ProviderAdapter; note?: string }> {
  const enabled = opts.force || resolved.probeCapabilities === true;
  if (!enabled || resolved.engine.provider !== "openai-compatible") {
    return { adapter };
  }

  const key = capabilityCacheKey(resolved.engine);
  let result = opts.force ? null : loadCachedCapabilities(key);
  if (!result) {
    result = await probeCapabilities(adapter, resolved.engine, { timeoutMs: 15_000 });
    saveCachedCapabilities(key, result);
  }

  const overrides = probeResultToCapabilities(result);
  if (Object.keys(overrides).length === 0) {
    return { adapter };
  }
  return {
    adapter: createProviderAdapter(resolved.engine, overrides),
    note: describeProbe(result),
  };
}
