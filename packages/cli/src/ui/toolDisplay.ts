function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\n/g, " ⏎ ");
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

/** Renders a short, tool-specific one-line description of a call's arguments - e.g.
 * `Read(src/app.ts)` instead of a raw JSON dump - so the transcript reads like a log of what
 * happened rather than an API trace. Falls back to name + truncated JSON for unknown tools
 * (MCP tools, anything added later) so nothing goes undescribed. */
export function describeToolCall(name: string, input: unknown): string {
  const args = isPlainObject(input) ? input : {};
  switch (name) {
    case "bash":
      return `Bash(${truncate(str(args.command), 100)})`;
    case "read_file":
      return `Read(${str(args.path)})`;
    case "write_file":
      return `Write(${str(args.path)})`;
    case "edit_file":
      return `Edit(${str(args.path)})`;
    case "grep": {
      const path = str(args.path);
      return `Grep(${str(args.pattern)}${path ? ` in ${path}` : ""})`;
    }
    case "glob":
      return `Glob(${str(args.pattern)})`;
    case "web_fetch":
      return `Fetch(${str(args.url)})`;
    case "task":
      return `Task(${truncate(str(args.description) || str(args.prompt), 80)})`;
    case "exit_plan_mode":
      return "Present plan for approval";
    case "ask_user_question":
      return `Ask(${truncate(str(args.question), 80)})`;
    default:
      return `${name}(${truncate(JSON.stringify(args), 90)})`;
  }
}
