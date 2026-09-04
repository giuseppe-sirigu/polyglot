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

export interface DiffPreview {
  /** Shown above the diff - typically the file path being changed. */
  label: string;
  oldText: string;
  newText: string;
}

export interface ToolDefinition<Input = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  permission: PermissionCategory;
  execute(input: Input, ctx: ToolExecutionContext): Promise<ToolResult>;
  /** Optional, read-only: lets the approval prompt show a diff before the tool actually runs.
   * Must not mutate anything. Returning null (or throwing) just falls back to the plain
   * approval view - this is a nice-to-have preview, not something execution depends on. */
  previewDiff?(input: Input, ctx: ToolExecutionContext): Promise<DiffPreview | null>;
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

  /** A fresh registry containing only the named tools that exist here (unknown names are
   * silently dropped). For an agent definition's tool allowlist. */
  subset(names: string[]): ToolRegistry {
    const out = new ToolRegistry();
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool) out.register(tool);
    }
    return out;
  }
}
