export interface GatewayAttemptIdentity {
  declarationDigest: string;
  runId: string;
}

export interface AuthenticatedAgent {
  agentId: string;
  refNamespace: `refs/heads/agents/${string}`;
  authenticatedAgent?: number;
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

export type ReservationStatus = "RESERVED" | "FINALIZED" | "ABORTED";

export interface LedgerReservation {
  transactionId: string;
  frameDigest: string;
  chargeBytes: number;
  budgetBefore: number;
  budgetAfter: number;
  accepted: boolean;
  status: ReservationStatus;
}

export interface SnapshotView {
  refs: RefMap;
  allowedOids: readonly string[];
  repository?: string;
}

export interface CanonicalFetchTuple {
  snapshotId: string;
  wants: readonly string[];
  haves: readonly string[];
  capabilityProfile: readonly string[];
  digest: string;
}

export interface RefTransactionStore {
  snapshot(): Promise<RefMap>;
  commit(refName: string, expectedOldOid: string | null, newOid: string): Promise<boolean>;
}

export interface AdmissionResult {
  entry: LedgerEntry;
  refCommitted: boolean;
  reservationStatus: ReservationStatus;
}
