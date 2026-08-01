import type { AgentId } from "../model/contracts.js";

export const TEAM_MESSAGE_MAX_CHARACTERS = 4_000;
export const TEAM_MESSAGE_PAGE_SIZE = 20;

export interface TeamMessage {
  sequence: number;
  author: AgentId;
  message: string;
  occurredAtMs: number;
}

export interface TeamMessagePage {
  messages: readonly TeamMessage[];
  latestSequence: number;
  nextSequence: number;
  hasMore: boolean;
}
