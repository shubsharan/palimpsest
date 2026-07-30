import { ATTEMPT_CUTOFF_MS, resolveCondition, type ConditionId } from "./condition.js";
import type { AgentId } from "./model.js";
import { SANDBOX_PATHS } from "./sandbox/contracts.js";
import type { TeamChannelMode } from "./team-channel.js";

export interface AgentPromptOptions {
  agentId: AgentId;
  condition: ConditionId;
  tokenBudgetPerAgent: number;
  teamChannel?: TeamChannelMode;
}

export type PromptAgentId = "agent-1" | "agent-2" | "agent-3";

export interface AgentPromptTemplateOptions {
  agentId: AgentId;
  condition: ConditionId;
  teamChannel?: TeamChannelMode;
}

export type AgentPromptTemplateSnapshot = Readonly<
  Record<PromptAgentId, Readonly<Record<ConditionId, string>>>
>;

export const TOKEN_BUDGET_PLACEHOLDER = "{{tokenBudgetPerAgent}}";

function validatePromptAgentId(agentId: AgentId): asserts agentId is PromptAgentId {
  if (!/^agent-[123]$/.test(agentId)) {
    throw new Error("Agent prompt requires exactly agent-1, agent-2, or agent-3.");
  }
}

export function buildAgentPromptTemplate(options: AgentPromptTemplateOptions): string {
  validatePromptAgentId(options.agentId);
  const condition = resolveCondition(options.condition);
  const identity = options.agentId.slice("agent-".length);
  const teamChannel = options.teamChannel ?? "disabled";
  const channel =
    condition.communicationMode === "shared"
      ? teamChannel === "enabled"
        ? "Three agents, one team submission: origin/main:solver.py. There are no individual submissions or scores. Direct team discussion is available: use post_team_message and read_team_messages to exchange strategy and ideas. Use the shared Git repository to publish useful solver changes, inspect peer commits, compare approaches, and integrate the strongest work. A local commit is visible to peers only after you push it, and only origin/main:solver.py is graded. Git does not count against your model-token budget."
        : "Three agents, one team submission: origin/main:solver.py. There are no individual submissions or scores. Collaborate through the team's shared Git repository: publish useful solver changes, inspect peer commits, compare approaches, and integrate the strongest work. A local commit is visible to peers only after you push it. Git does not count against your model-token budget."
      : "Peer communication is unavailable. Your assigned origin is private and no peer can see its commits or score. Publish your strongest solver to origin/main:solver.py so it remains part of the team record. Git does not count against your model-token budget.";
  return [
    `You are Agent ${identity}, one of 3 agents working concurrently as one team. Each agent receives different private evidence.`,
    "",
    channel,
    "",
    "Recover the plaintext of the complete word-substitution cipher as accurately as you can.",
    "A runnable solver.py scaffold is already committed. Only origin/main:solver.py can be checked or graded; final prose, uncommitted files, other branches, and unpushed commits do not count.",
    "The checker and final grader run python3 solver.py from a Git-free snapshot of the published main commit. It must read $PALIMPSEST_CIPHERTEXT, write the complete plaintext to $PALIMPSEST_OUTPUT, and work without /evidence, /reference, or Git metadata.",
    "",
    `Additional private evidence may appear during the attempt. The attempt ends at ${String(ATTEMPT_CUTOFF_MS / 60_000)} minutes.`,
    `Your cumulative model-token limit is ${TOKEN_BUDGET_PLACEHOLDER}.`,
    "",
    "You can inspect your private evidence, use the target-excluded reference corpus, run local commands, check the pushed origin/main:solver.py against your currently visible private evidence with check_published_solver, use Git, or wait for visible activity. The checker reports the exact commit and aggregate metrics; it covers only your visible evidence, so a perfect score does not prove the complete ciphertext is solved.",
    "Keep improving and pushing solver.py until you have verified that it produces a complete plaintext you believe solves the full ciphertext.",
    "Do not return a final response before then. If progress stalls, revisit assumptions, test a different approach, and use new evidence or Git activity to improve the solver. Wait only when no useful work remains, then resume when activity appears.",
    "",
    `Workspace: ${SANDBOX_PATHS.workspace}`,
    `Private evidence: ${SANDBOX_PATHS.evidence}`,
    `Reference corpus: ${SANDBOX_PATHS.reference}`,
  ].join("\n");
}

function templatesForAgent(
  agentId: PromptAgentId,
  teamChannel: TeamChannelMode,
): Readonly<Record<ConditionId, string>> {
  return Object.freeze({
    CS: buildAgentPromptTemplate({ agentId, condition: "CS", teamChannel }),
    CR: buildAgentPromptTemplate({ agentId, condition: "CR", teamChannel }),
    IS: buildAgentPromptTemplate({ agentId, condition: "IS", teamChannel }),
    IR: buildAgentPromptTemplate({ agentId, condition: "IR", teamChannel }),
  });
}

export function snapshotAgentPromptTemplates(
  teamChannel: TeamChannelMode = "disabled",
): AgentPromptTemplateSnapshot {
  return Object.freeze({
    "agent-1": templatesForAgent("agent-1", teamChannel),
    "agent-2": templatesForAgent("agent-2", teamChannel),
    "agent-3": templatesForAgent("agent-3", teamChannel),
  });
}

export function buildAgentPrompt(options: AgentPromptOptions): string {
  validatePromptAgentId(options.agentId);
  if (!Number.isSafeInteger(options.tokenBudgetPerAgent) || options.tokenBudgetPerAgent <= 0) {
    throw new Error("Agent prompt token budget must be a positive safe integer.");
  }
  return buildAgentPromptTemplate(options).replace(
    TOKEN_BUDGET_PLACEHOLDER,
    String(options.tokenBudgetPerAgent),
  );
}
