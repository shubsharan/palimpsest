import type { ToolDefinition } from "./tools.js";

export const AGENT_IDS = ["agent-1", "agent-2", "agent-3"] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Readonly<Record<string, unknown>>;
}

export interface ModelToolResult {
  callId: string;
  output: unknown;
}

export interface ModelTurn {
  toolCalls: readonly ModelToolCall[];
  finalResponse?: string;
  usage: TokenUsage;
}

export interface ModelRequest {
  prompt?: string;
  toolResults: readonly ModelToolResult[];
  signal: AbortSignal;
}

export interface ModelSessionContext {
  agentId: AgentId;
  tools: readonly ToolDefinition[];
}

export interface ModelSession {
  respond(request: ModelRequest): Promise<ModelTurn>;
  cancel?(reason: string): Promise<void> | void;
}

export interface ModelAdapter {
  openSession(context: ModelSessionContext): Promise<ModelSession> | ModelSession;
}
