export type JsonSchema = Record<string, unknown>;

export type PermissionCategory = "read" | "write" | "execute" | "network";

export interface ToolExecutionContext {
  cwd: string;
  sessionId: string;
  signal: AbortSignal;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  content: T;
  isError?: boolean;
  toModelText(): string;
}

export function textResult(text: string, ok = true): ToolResult<string> {
  return { ok, content: text, isError: !ok, toModelText: () => text };
}

export interface ToolDefinition<Input = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  permission: PermissionCategory;
  execute(input: Input, ctx: ToolExecutionContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }
}
