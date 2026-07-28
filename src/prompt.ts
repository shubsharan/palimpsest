import type { AgentId } from "./model.js";
import { SANDBOX_PATHS } from "./sandbox/contracts.js";

export interface AgentPromptPaths {
  agentId: AgentId;
  agentCount: number;
}

export function buildAgentPrompt(paths: AgentPromptPaths): string {
  const identity = paths.agentId.slice("agent-".length);
  return [
    `You are Agent ${identity}, one of ${String(paths.agentCount)} agents working concurrently to solve Palimpsest. Each agent receives different private evidence. Your team shares a Git repository; use it to coordinate, exchange code and compact findings, review one another's work, and assemble the best solver you can. The other agents are working at the same time. Choose your own roles, strategy, branches, files, and collaboration cadence. Avoid committing raw ciphertext or reconstructed prose.`,
    "",
    "Recover the plaintext of the complete ciphertext as accurately as you can. New private evidence may appear while you work. You can inspect your private evidence directory, use the target-excluded reference corpus, run local commands, check a reconstruction against your currently visible private evidence, use ordinary Git, or wait for new activity. Return a final response when you are done.",
    "",
    `Workspace: ${SANDBOX_PATHS.workspace}`,
    `Private evidence: ${SANDBOX_PATHS.evidence}`,
    `Reference corpus: ${SANDBOX_PATHS.reference}`,
  ].join("\n");
}
