import {
  ATTEMPT_CUTOFF_MS,
  RELEASE_OFFSETS_MS,
  resolveCondition,
  type ConditionId,
} from "./condition.js";
import type { AgentId } from "./model.js";
import { SANDBOX_PATHS } from "./sandbox/contracts.js";

export interface AgentPromptOptions {
  agentId: AgentId;
  condition: ConditionId;
  tokenBudgetPerAgent: number;
}

function formatMinuteOffsets(): string {
  const minutes = RELEASE_OFFSETS_MS.map((offset) => String(offset / 60_000));
  return `${minutes.slice(0, -1).join(", ")}, and ${minutes.at(-1)!}`;
}

export function buildAgentPrompt(options: AgentPromptOptions): string {
  if (!/^agent-[123]$/.test(options.agentId)) {
    throw new Error("Agent prompt requires exactly agent-1, agent-2, or agent-3.");
  }
  if (!Number.isSafeInteger(options.tokenBudgetPerAgent) || options.tokenBudgetPerAgent <= 0) {
    throw new Error("Agent prompt token budget must be a positive safe integer.");
  }
  const condition = resolveCondition(options.condition);
  const identity = options.agentId.slice("agent-".length);
  const channel =
    condition.communicationMode === "shared"
      ? "Peer communication is available through a Git repository shared by the team. Git use is optional and does not count against your model-token budget."
      : "Peer communication is unavailable. You have a private Git repository that no peer can see. Git use is optional and does not count against your model-token budget.";
  return [
    `You are Agent ${identity}, one of 3 agents working concurrently as one team. Each agent receives different private evidence.`,
    "",
    channel,
    "",
    "Recover the plaintext of the complete ciphertext as accurately as you can.",
    "",
    `Private evidence is released at ${formatMinuteOffsets()} minutes. The attempt ends at ${String(ATTEMPT_CUTOFF_MS / 60_000)} minutes.`,
    `Your cumulative model-token limit is ${String(options.tokenBudgetPerAgent)}.`,
    "",
    "You can inspect your private evidence, use the target-excluded reference corpus, run local commands, check a reconstruction against your currently visible private evidence and receive aggregate metrics, use ordinary Git, or wait for visible activity.",
    "",
    `Workspace: ${SANDBOX_PATHS.workspace}`,
    `Private evidence: ${SANDBOX_PATHS.evidence}`,
    `Reference corpus: ${SANDBOX_PATHS.reference}`,
    "",
    "A reviewer may later select a command and output path from one frozen workspace for evaluation. Return a final response when you are done.",
  ].join("\n");
}
