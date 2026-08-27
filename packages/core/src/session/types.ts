export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface Session {
  id: string;
  cwd: string;
  provider: string;
  model: string;
  messages: Message[];
  /** Set via /rename — undefined until the user gives the session a name. */
  name?: string;
}

export function createSession(params: { cwd: string; provider: string; model: string }): Session {
  return {
    id: crypto.randomUUID(),
    cwd: params.cwd,
    provider: params.provider,
    model: params.model,
    messages: [],
  };
}
