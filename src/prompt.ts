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

export type PromptAgentId = "agent-1" | "agent-2" | "agent-3";

export interface AgentPromptTemplateOptions {
  agentId: AgentId;
  condition: ConditionId;
}

export type AgentPromptTemplateSnapshot = Readonly<
  Record<PromptAgentId, Readonly<Record<ConditionId, string>>>
>;

export const TOKEN_BUDGET_PLACEHOLDER = "{{tokenBudgetPerAgent}}";

function formatMinuteOffsets(): string {
  const minutes = RELEASE_OFFSETS_MS.map((offset) => String(offset / 60_000));
  return `${minutes.slice(0, -1).join(", ")}, and ${minutes.at(-1)!}`;
}

function validatePromptAgentId(agentId: AgentId): asserts agentId is PromptAgentId {
  if (!/^agent-[123]$/.test(agentId)) {
    throw new Error("Agent prompt requires exactly agent-1, agent-2, or agent-3.");
  }
}

export function buildAgentPromptTemplate(options: AgentPromptTemplateOptions): string {
  validatePromptAgentId(options.agentId);
  const condition = resolveCondition(options.condition);
  const identity = options.agentId.slice("agent-".length);
  const channel =
    condition.communicationMode === "shared"
      ? "Collaborate through the team's shared Git repository: inspect peer commits, share useful discoveries and code, and integrate improvements. A local commit is visible to peers only after you push it to origin; fetch or pull origin to see their work. Git does not count against your model-token budget."
      : "Peer communication is unavailable. Work in your private Git repository; no peer can see it. Git does not count against your model-token budget.";
  return [
    `You are Agent ${identity}, one of 3 agents working concurrently as one team. Each agent receives different private evidence.`,
    "",
    channel,
    "",
    "Recover the plaintext of the complete ciphertext as accurately as you can.",
    "Your team is graded on runnable solver code committed to Git, not on final prose.",
    "A reviewer will run selected code from one frozen workspace against the complete ciphertext. It must read $PALIMPSEST_CIPHERTEXT, write the complete plaintext to $PALIMPSEST_OUTPUT, and work without /evidence or /reference.",
    "",
    `Private evidence is released at ${formatMinuteOffsets()} minutes. The attempt ends at ${String(ATTEMPT_CUTOFF_MS / 60_000)} minutes.`,
    `Your cumulative model-token limit is ${TOKEN_BUDGET_PLACEHOLDER}.`,
    "",
    "You can inspect your private evidence, use the target-excluded reference corpus, run local commands, check a reconstruction against your currently visible private evidence and receive aggregate metrics, use ordinary Git, or wait for visible activity.",
    "After waiting, recheck your evidence and Git for new information.",
    "Do not finish early: keep improving the committed solver and rechecking available evidence and Git until the complete ciphertext is solved or the attempt ends.",
    "",
    `Workspace: ${SANDBOX_PATHS.workspace}`,
    `Private evidence: ${SANDBOX_PATHS.evidence}`,
    `Reference corpus: ${SANDBOX_PATHS.reference}`,
    "",
    "Return a final response when you are done.",
  ].join("\n");
}

function templatesForAgent(agentId: PromptAgentId): Readonly<Record<ConditionId, string>> {
  return Object.freeze({
    CS: buildAgentPromptTemplate({ agentId, condition: "CS" }),
    CR: buildAgentPromptTemplate({ agentId, condition: "CR" }),
    IS: buildAgentPromptTemplate({ agentId, condition: "IS" }),
    IR: buildAgentPromptTemplate({ agentId, condition: "IR" }),
  });
}

export function snapshotAgentPromptTemplates(): AgentPromptTemplateSnapshot {
  return Object.freeze({
    "agent-1": templatesForAgent("agent-1"),
    "agent-2": templatesForAgent("agent-2"),
    "agent-3": templatesForAgent("agent-3"),
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
