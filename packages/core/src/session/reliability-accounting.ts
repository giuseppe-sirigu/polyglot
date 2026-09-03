/**
 * Per-model, per-session tally of how well a model produces tool calls. Fed from the agent
 * event stream (`tool_call` carries `repaired` / `correctedFromName`; `tool_parse_error` is a
 * failed parse; `agent_stop{unreliable_model}` is a give-up). Surfaced in `/status`,
 * `/reliability`, and the `/model` picker so a user can see which model actually holds the
 * format - and so a repair layer can't quietly mask a model getting worse.
 *
 * Pure folds, same shape as session/usage-accounting.ts. Memory-only for now (not persisted
 * to the session transcript).
 */

export interface ModelReliabilityTotals {
  model: string;
  /** Tool calls that parsed and dispatched (whether or not they needed repair). */
  toolCalls: number;
  /** Of `toolCalls`, how many needed repair to resolve (superset of `nameCorrected`). */
  repaired: number;
  /** Of `toolCalls`, how many had a fuzzy-matched tool name. */
  nameCorrected: number;
  /** Emissions that never resolved into a call at all. */
  parseErrors: number;
  /** Times the turn ended early because the model wasn't reliably producing valid calls. */
  gaveUp: number;
}

export interface SessionReliabilityTotals {
  toolCalls: number;
  repaired: number;
  nameCorrected: number;
  parseErrors: number;
  gaveUp: number;
  /** Keyed by model id - a session that switched models has several. */
  byModel: Record<string, ModelReliabilityTotals>;
}

export function emptyReliabilityTotals(): SessionReliabilityTotals {
  return { toolCalls: 0, repaired: 0, nameCorrected: 0, parseErrors: 0, gaveUp: 0, byModel: {} };
}

function emptyModel(model: string): ModelReliabilityTotals {
  return { model, toolCalls: 0, repaired: 0, nameCorrected: 0, parseErrors: 0, gaveUp: 0 };
}

function fold(
  acc: SessionReliabilityTotals,
  model: string,
  delta: Partial<Omit<ModelReliabilityTotals, "model">>,
): SessionReliabilityTotals {
  const prior = acc.byModel[model] ?? emptyModel(model);
  const bump = <K extends keyof typeof delta>(k: K) => (delta[k] ?? 0) as number;
  return {
    toolCalls: acc.toolCalls + bump("toolCalls"),
    repaired: acc.repaired + bump("repaired"),
    nameCorrected: acc.nameCorrected + bump("nameCorrected"),
    parseErrors: acc.parseErrors + bump("parseErrors"),
    gaveUp: acc.gaveUp + bump("gaveUp"),
    byModel: {
      ...acc.byModel,
      [model]: {
        model,
        toolCalls: prior.toolCalls + bump("toolCalls"),
        repaired: prior.repaired + bump("repaired"),
        nameCorrected: prior.nameCorrected + bump("nameCorrected"),
        parseErrors: prior.parseErrors + bump("parseErrors"),
        gaveUp: prior.gaveUp + bump("gaveUp"),
      },
    },
  };
}

/** Records one tool call that parsed. Pure - returns a new object. */
export function addToolCall(
  acc: SessionReliabilityTotals,
  info: { model: string; repaired: boolean; nameCorrected: boolean },
): SessionReliabilityTotals {
  return fold(acc, info.model, {
    toolCalls: 1,
    repaired: info.repaired ? 1 : 0,
    nameCorrected: info.nameCorrected ? 1 : 0,
  });
}

/** Records one emission that failed to parse into a tool call. Pure. */
export function addParseError(
  acc: SessionReliabilityTotals,
  model: string,
): SessionReliabilityTotals {
  return fold(acc, model, { parseErrors: 1 });
}

/** Records a turn that ended with `agent_stop{unreliable_model}`. Pure. */
export function addGiveUp(acc: SessionReliabilityTotals, model: string): SessionReliabilityTotals {
  return fold(acc, model, { gaveUp: 1 });
}
