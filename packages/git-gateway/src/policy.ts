import { validateRefName } from "@palimpsest/git-accounting";

import type { AuthenticatedAgent } from "./types.js";

export function assertAuthorizedRef(agent: AuthenticatedAgent, refName: string): void {
  validateRefName(refName);
  const prefix = `${agent.refNamespace}/`;
  if (!refName.startsWith(prefix)) {
    throw new Error(`Agent ${agent.agentId} cannot update ref ${refName}.`);
  }
}

export function assertSafeCapability(name: string): void {
  if (!["report-status", "side-band-64k", "agent", "object-format=sha256"].includes(name)) {
    throw new Error(`Git capability is not permitted: ${name}`);
  }
}
