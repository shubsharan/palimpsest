import type { AgentId } from "../model/contracts.js";
import type { ResolvedRun } from "../experiment/contracts.js";
import { SANDBOX_PATHS } from "../sandbox/contracts.js";

export interface AgentPromptOptions extends Pick<
  ResolvedRun,
  "capabilities" | "limits" | "schedule"
> {
  agentId: AgentId;
  agentIds: readonly AgentId[];
}

function validateOptions(options: AgentPromptOptions): void {
  if (
    !options.agentIds.includes(options.agentId) ||
    new Set(options.agentIds).size !== options.agentIds.length
  ) {
    throw new Error("Agent prompt identity must belong to a unique declared team.");
  }
  if (!Number.isSafeInteger(options.schedule.cutoffMs) || options.schedule.cutoffMs <= 0) {
    throw new Error("Agent prompt cutoff must be a positive safe integer.");
  }
  if (
    options.limits.tokenLimitPerAgent !== null &&
    (!Number.isSafeInteger(options.limits.tokenLimitPerAgent) ||
      options.limits.tokenLimitPerAgent <= 0)
  ) {
    throw new Error("Agent prompt token budget must be a positive safe integer or null.");
  }
  if (options.capabilities.git === "isolated" && options.capabilities.teamRoom === "enabled") {
    throw new Error("An isolated run cannot expose a shared team room.");
  }
}

function communicationText(options: AgentPromptOptions): string {
  if (options.capabilities.git === "isolated") {
    return "Peer communication is unavailable. Your assigned origin and activity are private. Publish your strongest solver to origin/main:solver.py so it remains in the complete team record.";
  }
  if (options.capabilities.teamRoom === "enabled") {
    return "The team shares one Git origin and a public discussion room. You may use post_team_message and read_team_messages, inspect peer commits, and integrate work through ordinary Git. Only origin/main:solver.py is checked and graded.";
  }
  return "The team shares one Git origin. You may inspect peer commits and integrate work through ordinary Git. Only origin/main:solver.py is checked and graded.";
}

export function buildAgentPrompt(options: AgentPromptOptions): string {
  validateOptions(options);
  const tokenPolicy =
    options.limits.tokenLimitPerAgent === null
      ? "There is no cumulative model-token cutoff; provider-reported usage is still recorded."
      : `Your cumulative model-token limit is ${String(options.limits.tokenLimitPerAgent)}.`;
  return [
    `You are ${options.agentId}, one of ${String(options.agentIds.length)} agents working concurrently on one puzzle. Each agent receives different private evidence.`,
    "",
    communicationText(options),
    "Git commands do not count against your model-token limit.",
    "",
    "Recover the plaintext of the complete word-substitution cipher as accurately as you can.",
    "A runnable solver.py scaffold is already committed. Only a solver pushed to origin/main can be checked or graded; final prose, uncommitted files, other branches, and unpushed commits do not count.",
    "The checker and grader run python3 solver.py from a Git-free snapshot. It must read $PALIMPSEST_CIPHERTEXT, write the complete plaintext to $PALIMPSEST_OUTPUT, and work without evidence, references, or Git metadata.",
    "",
    `Additional private evidence may appear during the run. The run ends after ${String(options.schedule.cutoffMs)} milliseconds.`,
    tokenPolicy,
    "",
    "You may inspect private evidence, use the target-excluded reference corpus, run commands, check the published solver against currently visible evidence, use Git, and wait for visible activity. The checker returns only aggregate metrics for visible evidence.",
    "The runner does not assign roles, turns, checkpoints, files, branches, or a coordination process.",
    "",
    `Workspace: ${SANDBOX_PATHS.workspace}`,
    `Private evidence: ${SANDBOX_PATHS.evidence}`,
    `Reference corpus: ${SANDBOX_PATHS.reference}`,
  ].join("\n");
}
