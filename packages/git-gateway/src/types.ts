export interface GatewayAttemptIdentity {
  declarationDigest: string;
  runId: string;
}

export interface AuthenticatedAgent {
  agentId: string;
  refNamespace: `refs/heads/agents/${string}`;
}

export interface PublicationSnapshotRef {
  snapshotId: string;
  ordinal: number;
  refMapDigest: string;
  visibilityJournalDigest: string;
}

export interface LedgerEntry {
  schemaVersion: 1;
  contractId: "push-ledger-entry";
  runId: string;
  agentId: string;
  transactionId: string;
  frameDigest: string;
  chargeBytes: number;
  budgetBefore: number;
  budgetAfter: number;
  result: "accepted" | "rejected";
}

export interface RefMap {
  [refName: string]: string;
}

export interface PublishedSnapshot {
  schemaVersion: 1;
  contractId: "published-snapshot";
  runId: string;
  snapshotId: string;
  ordinal: number;
  refMapDigest: string;
  visibilityJournalDigest: string;
  eventSequence: number;
}
