import { type ToolDefinition, textResult } from "./types.js";

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestionRequest {
  question: string;
  options: UserQuestionOption[];
  multiSelect: boolean;
}

interface AskUserQuestionInput {
  question: string;
  options: UserQuestionOption[];
  multiSelect?: boolean;
}

/**
 * Lets the model pause and ask the user a multiple-choice clarifying question — for a decision
 * genuinely theirs to make, not something the model could reasonably decide on its own. Only
 * registered in plan mode, alongside exit_plan_mode: this is for resolving ambiguity in the
 * plan being drafted, not a general-purpose prompt tool.
 */
export function createAskUserQuestionTool(
  onAsk: (request: UserQuestionRequest) => Promise<string[]>,
): ToolDefinition<AskUserQuestionInput> {
  return {
    name: "ask_user_question",
    description:
      "Ask the user a multiple-choice clarifying question when the plan depends on a decision " +
      "only they can make. Use sparingly — prefer a reasonable default when the answer wouldn't " +
      "materially change the plan.",
    permission: "read",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask, ending in '?'." },
        options: {
          type: "array",
          description: "2-4 mutually exclusive choices (or independent ones, if multiSelect).",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short label for this choice." },
              description: {
                type: "string",
                description: "Optional one-sentence detail about this choice.",
              },
            },
            required: ["label"],
            additionalProperties: false,
          },
        },
        multiSelect: {
          type: "boolean",
          description: "Set true if more than one option may be selected at once.",
        },
      },
      required: ["question", "options"],
      additionalProperties: false,
    },
    async execute(input) {
      if (!Array.isArray(input.options) || input.options.length < 2) {
        return textResult("options must contain at least 2 choices.", false);
      }
      const answers = await onAsk({
        question: input.question,
        options: input.options,
        multiSelect: Boolean(input.multiSelect),
      });
      return textResult(`User selected: ${answers.join(", ")}`);
    },
  };
}
