import {
  buildLogicalTransaction,
  encodeGitAccountingFrame,
  isZeroOid,
  refOperations,
  validateRefName,
  VisibilityJournal,
  type GitAccountingFrameV1,
} from "@palimpsest/git-accounting";

import type { AuthenticatedAgent } from "./types.js";

export function assertAuthorizedRef(agent: AuthenticatedAgent, refName: string): void {
  validateRefName(refName);
  const prefix = `${agent.refNamespace}/`;
  if (!refName.startsWith(prefix)) {
    throw new Error(`Agent ${agent.agentId} cannot update ref ${refName}.`);
  }
}

export function assertSafeCapability(name: string): void {
  const safe =
    ["report-status", "side-band-64k", "object-format=sha256"].includes(name) ||
    /^agent=[A-Za-z0-9._/+-]{1,128}$/.test(name);
  if (!safe) {
    throw new Error(`Git capability is not permitted: ${name}`);
  }
}

export function assertSafeRepositoryPath(path: string): void {
  const normalized = path.normalize("NFC");
  const parts = path.split("/");
  if (
    path !== normalized ||
    path.startsWith("/") ||
    path.includes("\\") ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    parts.some((part) => [".git", ".gitmodules", ".gitattributes"].includes(part.toLowerCase()))
  ) {
    throw new Error(`Git repository path is not permitted: ${path}`);
  }
}

export function assertFramePolicy(options: {
  agent: AuthenticatedAgent;
  frame: GitAccountingFrameV1;
  currentRefs: Readonly<Record<string, string>>;
}): void {
  const { agent, frame, currentRefs } = options;
  assertAuthorizedRef(agent, frame.refName);
  encodeGitAccountingFrame(frame);
  if (
    agent.authenticatedAgent !== undefined &&
    frame.authenticatedAgent !== agent.authenticatedAgent
  ) {
    throw new Error("Git accounting sender attribution does not match authentication.");
  }
  const current = currentRefs[frame.refName];
  const oldOid = frame.oldOid.toString("hex");
  if (frame.operation === refOperations.create) {
    if (current !== undefined || !isZeroOid(frame.oldOid)) {
      throw new Error("Git ref create is stale.");
    }
  } else if (frame.operation === refOperations.update) {
    if (current !== oldOid) {
      throw new Error("Git ref update is stale relative to the current tip.");
    }
  }
}

export async function validateQuarantinedFrame(options: {
  agent: AuthenticatedAgent;
  frame: GitAccountingFrameV1;
  quarantineRepository: string;
  slotStartVisibleOids: Iterable<string>;
}): Promise<void> {
  const frame = options.frame;
  assertAuthorizedRef(options.agent, frame.refName);
  const rebuilt = await buildLogicalTransaction({
    authenticatedAgent: frame.authenticatedAgent,
    newOid: frame.newOid.toString("hex"),
    oldOid: frame.oldOid.toString("hex"),
    operation: frame.operation,
    publicationSlot: frame.publicationSlot,
    receivedOids: frame.objects.map((object) => object.oid.toString("hex")),
    refName: frame.refName,
    repository: options.quarantineRepository,
    slotStartJournal: new VisibilityJournal(options.slotStartVisibleOids),
  });
  if (!encodeGitAccountingFrame(rebuilt).equals(encodeGitAccountingFrame(frame))) {
    throw new Error("Quarantined Git transaction does not match its accounting frame.");
  }
}
