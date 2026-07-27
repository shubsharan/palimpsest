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

export interface LifecycleService {
  readonly state: HarnessState;
  transition(next: HarnessState): HarnessState;
}

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

export const agentBridgeEventTypes = [
  "response.output",
  "tool.started",
  "tool.output",
  "tool.completed",
  "file.read",
  "file.written",
  "file.declared",
  "git.clone",
  "git.fetch",
  "git.pull",
  "git.commit",
  "git.push",
  "git.result",
  "checkpoint",
  "resource.usage",
  "worker.error",
  "worker.completed",
] as const;

export type AgentBridgeEventType = (typeof agentBridgeEventTypes)[number];

export interface AgentBridgeEvent {
  schemaVersion: 1;
  runId: string;
  agentId: string;
  invocationId: string;
  ordinal: number;
  type: AgentBridgeEventType;
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

export interface RunEventAppendService {
  readonly events: readonly RunEvent[];
  readonly head: string | null;
  append(input: {
    producer: string;
    effectId: string;
    eventType: string;
    monotonicElapsedNs: string;
    payload: Record<string, unknown>;
  }): Promise<RunEvent>;
}

export interface MonotonicClockService {
  nowMs(): number;
  waitUntil(targetMs: number): Promise<void>;
}

export interface HarnessSchedule {
  revealOffsetsMs: readonly number[];
  publicationOffsetsMs: readonly number[];
  pushCloseOffsetMs: number;
  freezeOffsetMs: number;
  finalizationOffsetMs: number;
  toleranceMs: number;
  stabilizationIntervalMs: number;
}

export type ScheduleBoundary =
  | { kind: "reveal"; ordinal: number }
  | { kind: "publication"; ordinal: number }
  | { kind: "push-close" | "freeze" | "finalization" };

export interface ScheduleObservation {
  boundary: ScheduleBoundary;
  scheduledOffsetMs: number;
  actualOffsetMs: number;
  driftMs: number;
}

export interface BridgeResourceUsage {
  cpuMs: number;
  memoryBytes: number;
  diskBytes: number;
}

export interface BridgeMeasuredUsage {
  wallTimeMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  eventCount: number;
}

export interface BridgeLimits {
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxEvents: number;
  maxCpuMs: number;
  maxMemoryBytes: number;
  maxDiskBytes: number;
}

export interface HostModelBridgeService {
  run(request: AgentInvocationRequest): Promise<{
    events: readonly AgentBridgeEvent[];
    measuredUsage: BridgeMeasuredUsage;
    reportedResourceUsage: BridgeResourceUsage;
  }>;
}

export interface PrivateSubmission {
  agentId: string;
  freezeId: string;
  releasedShardDigest: string;
  outputs: Array<{ path: string; byteLength: number; sha256: string }>;
}

export interface CommonBarrierService {
  readonly launchEpochMs: number | null;
  readonly observedStates: readonly HarnessState[];
  arriveAtLaunch(agentId: string): Promise<number>;
  advance(next: HarnessState): HarnessState;
}

export interface SubmissionService {
  seal(options: {
    root: string;
    agentId: string;
    runId: string;
    freezeId: string;
    releasedShardDigest: string;
  }): Promise<PrivateSubmission>;
}

export interface GraderService {
  grade(identity: { declarationDigest: string; runId: string }, root: string): Promise<unknown>;
}

export interface ReplayService {
  replay(identity: { declarationDigest: string; runId: string }, root: string): Promise<unknown>;
}
