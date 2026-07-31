import type { ToolDefinition } from "./tools.js";

const AGENT_ID = /^agent-[1-9][0-9]*$/;

export type AgentId = `agent-${number}`;

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && AGENT_ID.test(value);
}

export function generateAgentIds(count: number): readonly AgentId[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("Agent count must be a positive safe integer.");
  }
  return Array.from({ length: count }, (_, index) => `agent-${String(index + 1)}` as AgentId);
}

// Retained only as the deterministic provider-free fixture scenario.
export const AGENT_IDS: readonly AgentId[] = generateAgentIds(3);

export type ProviderDriver = "openai" | "anthropic" | "google" | "openai-compatible";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ModelSettings {
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly seed?: number;
}

export interface ModelBinding {
  readonly profile: string;
  readonly provider: string;
  readonly driver: ProviderDriver;
  readonly requestedModel: string;
  readonly settings: ModelSettings;
  readonly providerOptions: JsonObject;
  readonly actualProvider?: string;
  readonly actualModel?: string;
}

export interface ModelResponseIdentity {
  readonly actualProvider?: string;
  readonly actualModel?: string;
}

export interface InputTokenDetails {
  readonly noCacheTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export interface OutputTokenDetails {
  readonly textTokens?: number;
  readonly reasoningTokens?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  inputTokenDetails?: InputTokenDetails;
  outputTokenDetails?: OutputTokenDetails;
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

export interface ReturnedReasoningSummaryEntry {
  readonly type: "summary_text";
  readonly text: string;
}

export interface ReturnedReasoningSummaryItem {
  readonly id: string;
  readonly summary: readonly ReturnedReasoningSummaryEntry[];
}

export type ReturnedReasoningSummary =
  | {
      readonly status: "captured";
      readonly items: readonly ReturnedReasoningSummaryItem[];
    }
  | {
      readonly status: "response-body-unavailable";
    };

export interface ModelTurn {
  toolCalls: readonly ModelToolCall[];
  reasoningSummary?: string;
  returnedReasoningSummary?: ReturnedReasoningSummary;
  finalResponse?: string;
  usage: TokenUsage;
  responseIdentity?: ModelResponseIdentity;
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
