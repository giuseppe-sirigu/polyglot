import { createInterface } from "node:readline/promises";
import { globalSettingsPath, writeGlobalSettings } from "@usepolyglot/core";

export interface InitAnswers {
  provider: "anthropic" | "openai-compatible";
  model: string;
  baseURL?: string;
}

const DEFAULTS = {
  anthropic: { model: "claude-sonnet-4-5" },
  local: { model: "qwen3-coder", baseURL: "http://localhost:11434/v1" },
} as const;

/** Pure: turns the wizard's answers into the settings object written to disk. */
export function settingsFromAnswers(a: InitAnswers): Record<string, unknown> {
  const settings: Record<string, unknown> = { provider: a.provider, model: a.model };
  if (a.provider === "openai-compatible") {
    settings.baseURL = a.baseURL || DEFAULTS.local.baseURL;
  }
  return settings;
}

/**
 * Interactive first-run setup: asks for a provider + model and writes
 * `~/.polyglot/settings.json`. Run explicitly via `polyglot init`, or automatically the first
 * time `polyglot` starts with no config in an interactive terminal.
 */
export async function runInit(): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "polyglot init needs an interactive terminal. Set POLYGLOT_PROVIDER / POLYGLOT_MODEL " +
        "(and POLYGLOT_BASE_URL for a local model), or write ~/.polyglot/settings.json by hand:\n" +
        '  { "provider": "openai-compatible", "model": "qwen3-coder", "baseURL": "http://localhost:11434/v1" }\n',
    );
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write("\npolyglot setup — this writes ~/.polyglot/settings.json.\n\n");

    const choice = (
      await rl.question(
        "Which model provider?\n" +
          "  1) A local model (Ollama, llama.cpp, LM Studio, vLLM …)\n" +
          "  2) Anthropic (Claude)\n" +
          "Choose [1]: ",
      )
    ).trim();

    let answers: InitAnswers;
    if (choice === "2") {
      const model =
        (await rl.question(`Model [${DEFAULTS.anthropic.model}]: `)).trim() ||
        DEFAULTS.anthropic.model;
      answers = { provider: "anthropic", model };
      process.stdout.write(
        "\nRemember to export ANTHROPIC_API_KEY in your shell before running polyglot.\n",
      );
    } else {
      const model =
        (await rl.question(`Model name [${DEFAULTS.local.model}]: `)).trim() ||
        DEFAULTS.local.model;
      const baseURL =
        (await rl.question(`Base URL [${DEFAULTS.local.baseURL}]: `)).trim() ||
        DEFAULTS.local.baseURL;
      answers = { provider: "openai-compatible", model, baseURL };
    }

    writeGlobalSettings(settingsFromAnswers(answers));
    process.stdout.write(`\nWrote ${globalSettingsPath()}.\n`);
  } finally {
    rl.close();
  }
}
