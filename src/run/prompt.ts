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
    return "Peer communication is unavailable; your Git origin and activity are private.";
  }
  if (options.capabilities.teamRoom === "enabled") {
    return "The team shares one Git origin and a public discussion room. You can inspect peer commits and use post_team_message and read_team_messages.";
  }
  return "The team shares one Git origin, so you can inspect and build on peer commits.";
}

function checkerText(options: AgentPromptOptions): string {
  return options.capabilities.checker
    ? "You can run commands, use ordinary Git, check the published solver for aggregate metrics on released evidence, and wait for new evidence or activity. Git operations have no separate quota."
    : "You can run commands, use ordinary Git, and wait for new evidence or activity. No checker is available during the run. Git operations have no separate quota.";
}

function formatDuration(milliseconds: number): string {
  if (milliseconds % 60_000 === 0) {
    const minutes = milliseconds / 60_000;
    return `${String(minutes)} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  if (milliseconds % 1_000 === 0) {
    const seconds = milliseconds / 1_000;
    return `${String(seconds)} ${seconds === 1 ? "second" : "seconds"}`;
  }
  return `${String(milliseconds)} milliseconds`;
}

export function buildAgentPrompt(options: AgentPromptOptions): string {
  validateOptions(options);
  const tokenPolicy =
    options.limits.tokenLimitPerAgent === null
      ? "Model tokens: no cumulative cutoff; provider-reported usage is still recorded."
      : `Model-token limit: ${String(options.limits.tokenLimitPerAgent)} cumulative tokens.`;
  const releaseSchedule = options.schedule.releaseOffsetsMs
    .map((offset) => (offset === 0 ? "at start" : formatDuration(offset)))
    .join(", ");
  return [
    `You are ${options.agentId}, one of ${String(options.agentIds.length)} agents working concurrently on the same puzzle. Team: ${options.agentIds.join(", ")}. Each agent receives different private evidence.`,
    "",
    "OBJECTIVE",
    "Recover as much of the complete plaintext as accurately as possible.",
    "",
    "PUZZLE AND INPUTS",
    "Plaintext word types are replaced with ciphertext word types through hidden one-to-one substitutions. Punctuation, capitalization patterns, digits, and paragraph structure remain visible.",
    `Released ciphertext evidence appears in ${SANDBOX_PATHS.evidence}.`,
    `Evidence releases after the run starts: ${releaseSchedule}.`,
    "",
    "DELIVERABLE",
    "Edit the committed solver.py scaffold to reconstruct any ciphertext supplied in $PALIMPSEST_CIPHERTEXT and write only its complete plaintext to $PALIMPSEST_OUTPUT.",
    options.capabilities.checker
      ? "Checking and grading run python3 solver.py without evidence or Git metadata. Checks use your released evidence; final grading uses the complete ciphertext."
      : "Final grading runs python3 solver.py without evidence or Git metadata against the complete ciphertext.",
    options.capabilities.checker
      ? "Only origin/main:solver.py is checked or graded. Final prose, uncommitted files, other branches, and unpushed commits do not count."
      : "Only origin/main:solver.py is graded. Final prose, uncommitted files, other branches, and unpushed commits do not count.",
    "",
    "ENVIRONMENT",
    communicationText(options),
    checkerText(options),
    "Choose your own solving and coordination process; no roles, turns, checkpoints, reports, or consensus are required.",
    "",
    "LIMITS",
    `Run cutoff: ${formatDuration(options.schedule.cutoffMs)} after the run starts.`,
    tokenPolicy,
    `Workspace: ${SANDBOX_PATHS.workspace}`,
  ].join("\n");
}
