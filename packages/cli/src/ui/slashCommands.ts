export interface SlashCommand {
  command: string;
  description: string;
  /** True for commands that need more typed after the name (e.g. "/rename <name>") — selecting
   * one of these from the popup (Tab or Enter) fills it into the input instead of running it
   * immediately, so there's a chance to type the argument first. */
  takesArgument?: boolean;
}

// Aliases (/quit, /newsession) still work when typed in full — they're just not advertised
// here, so the popup has one canonical entry per action instead of near-duplicates.
export const SLASH_COMMANDS: SlashCommand[] = [
  { command: "/status", description: "Show model, data-handling & permission posture" },
  { command: "/model", description: "List or switch between configured models" },
  { command: "/rename", description: "Give this session a name", takesArgument: true },
  { command: "/resume", description: "Pick a previous session to resume" },
  { command: "/compact", description: "Summarize older history to free up context" },
  { command: "/reset", description: "Start a new session" },
  { command: "/exit", description: "Exit polyglot" },
];

/** Suggestions for a `/`-prefixed command currently being typed. Only while the command name
 * itself is still being written — as soon as a space or newline appears (the user has moved on
 * to an argument, e.g. "/model qw...") the list goes empty, matching how the popup disappears
 * in Claude Code's own CLI. */
export function matchSlashCommands(value: string): SlashCommand[] {
  if (!value.startsWith("/") || /\s/.test(value)) return [];
  const query = value.slice(1).toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.command.slice(1).toLowerCase().startsWith(query));
}
