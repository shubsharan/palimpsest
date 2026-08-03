import type { AgentId, JsonValue } from "../model/contracts.js";

export type ViewerEventCategory =
  | "model"
  | "tool"
  | "team"
  | "stage"
  | "git"
  | "session"
  | "run"
  | "evaluation"
  | "infrastructure"
  | "other";

export interface ViewerModelResponse {
  type: "model-response";
  finalResponse?: string;
  reasoningSummary?: string;
  providerSummary?: string;
  outputTokens?: number;
}

export interface ViewerMilestone {
  type: "milestone";
  label: string;
}

export interface ViewerEvent {
  sequence: number;
  atMs: number;
  kind: string;
  category: ViewerEventCategory;
  agentId?: AgentId;
  display?: ViewerModelResponse | ViewerMilestone;
}

export interface ViewerToolCall {
  id: string;
  agentId: AgentId;
  name: string;
  startedSequence: number;
  startedAtMs: number;
  completedSequence?: number;
  completedAtMs?: number;
  status: "running" | "completed" | "error";
}

export interface ViewerToolDetail {
  arguments: JsonValue;
  output?: JsonValue;
  error?: string;
}

export interface ViewerTeamMessage {
  sequence: number;
  traceSequence: number;
  atMs: number;
  author: AgentId;
  message: string;
}

export interface ViewerOrigin {
  originId: string;
  agentIds: readonly AgentId[];
  finalCommit: string | null;
}

export interface ViewerScore {
  originId: string;
  matchedWords: number;
  totalWords: number;
  coverage: number;
  accuracy: number;
}

export interface ViewerRun {
  runId: string;
  status: "completed" | "infrastructure-error";
  startedAt: string;
  frozenAt: string;
  durationMs: number;
  communicationMode: "shared" | "isolated";
  fixtureId: string;
  variantId: string;
  rekeyAtStage: number | null;
  agents: readonly {
    agentId: AgentId;
    profile: string;
    requestedModel: string;
    actualModel?: string;
  }[];
  origins: readonly ViewerOrigin[];
  finalScores: readonly ViewerScore[];
  ciphertext: string;
  events: readonly ViewerEvent[];
  toolCalls: readonly ViewerToolCall[];
  teamMessages: readonly ViewerTeamMessage[];
}

export type DecodeTiming = "exact" | "approximate";

export type DecodeWordState =
  | "newly-correct"
  | "previously-correct"
  | "regressed"
  | "changed-incorrect"
  | "unchanged";

export interface DecodeWordDelta {
  index: number;
  candidate: string | null;
  state: DecodeWordState;
}

export interface DecodeCheckpoint {
  checkpointId: string;
  originId: string;
  commit: string;
  atMs: number;
  timing: DecodeTiming;
  authorAgentId?: AgentId;
  author: string;
  subject: string;
  status: "ready" | "failed";
  matchedWords?: number;
  totalWords?: number;
  coverage?: number;
  accuracy?: number;
  predictedWordCount?: number;
  deltas?: readonly DecodeWordDelta[];
  newlyCorrectRanges?: readonly { start: number; end: number }[];
  error?: string;
}

export type DecodeStreamEvent =
  | {
      type: "started";
      origins: readonly { originId: string; checkpointCount: number }[];
    }
  | { type: "checkpoint"; checkpoint: DecodeCheckpoint }
  | { type: "complete" }
  | { type: "failed"; error: string };
