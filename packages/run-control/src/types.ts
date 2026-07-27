export const harnessStates = [
  "PREPARED",
  "STARTING",
  "RUNNING",
  "PUSH_CLOSED",
  "DRAINING",
  "FROZEN",
  "FINALIZING",
  "SUBMITTED",
  "REPLAYED",
  "SCORED",
  "INVALID",
] as const;

export type HarnessState = (typeof harnessStates)[number];

export interface AgentInvocationRequest {
  schemaVersion: 1;
  runId: string;
  agentId: string;
  invocationId: string;
  adapterId: string;
  lifecycleState: HarnessState;
  monotonicDeadlineMs: number;
  releasedInputManifestPath: string;
  publishedSnapshotId: string;
  gitEndpoint: string;
  gitRefNamespace: string;
  workspacePath: string;
  privateOutputPath: string;
}

export interface AgentBridgeEvent {
  schemaVersion: 1;
  runId: string;
  agentId: string;
  invocationId: string;
  ordinal: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface RunEvent {
  schemaVersion: 1;
  contractId: "run-event";
  runId: string;
  sequence: number;
  producer: string;
  effectId: string;
  eventType: string;
  monotonicElapsedNs: string;
  payload: Record<string, unknown>;
  previousDigest: string | null;
  digest: string;
}

export interface HarnessSchedule {
  revealOffsetsMs: readonly number[];
  publicationOffsetsMs: readonly number[];
  pushCloseOffsetMs: number;
  freezeOffsetMs: number;
  finalizationOffsetMs: number;
}

export interface PrivateSubmission {
  agentId: string;
  freezeId: string;
  releasedShardDigest: string;
  outputs: Array<{ path: string; byteLength: number; sha256: string }>;
}
