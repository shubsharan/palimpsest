import type {
  AgentId,
  JsonObject,
  ModelProfile,
  ProviderConnection,
  ProviderDriver,
} from "../model/contracts.js";

export type GitVisibility = "shared" | "isolated";
export type TeamRoomAvailability = "enabled" | "disabled";
export type Communication = "shared" | "isolated";

export interface AuthoredModel {
  provider: Exclude<ProviderDriver, "openai-compatible">;
  model: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

export interface AuthoredRun {
  source: string;
  agents: number;
  model: string;
  communication: Communication;
  releases: string[];
  cutoff: string;
  spendCeilingCents: number;
  rekeyAtStage?: number;
  tokenLimitPerAgent?: number;
}

export interface ExperimentManifest {
  schemaVersion: 2;
  name: string;
  models: Record<string, AuthoredModel>;
  runs: Record<string, AuthoredRun>;
}

/** Internal, fully resolved contracts frozen in run records. */
export interface FixtureReference {
  packagePath: string;
  variant: string;
}

export interface ExperimentCapabilities {
  git: GitVisibility;
  teamRoom: TeamRoomAvailability;
}

export interface ExperimentSchedule {
  releaseOffsetsMs: number[];
  cutoffMs: number;
}

export interface ExperimentLimits {
  tokenLimitPerAgent: number | null;
  spendCeilingCents: number;
}

export type AgentAssignment = Record<AgentId, string>;

export interface RunDeclaration {
  id: string;
  fixture: FixtureReference;
  assignment: AgentAssignment;
  capabilities: ExperimentCapabilities;
  schedule: ExperimentSchedule;
  limits: ExperimentLimits;
  labels: JsonObject;
}

export interface ResolvedFixtureReference extends FixtureReference {
  fixtureId?: string;
  packageRoot: string;
  source?: string;
  rekeyAtStage?: number | null;
}

export interface ResolvedRun extends Omit<RunDeclaration, "fixture"> {
  readonly fixture: ResolvedFixtureReference;
}

export interface ResolvedExperiment {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly providers: Readonly<Record<string, ProviderConnection>>;
  readonly models: Readonly<Record<string, ModelProfile>>;
  readonly totalSpendCeilingCents: number;
  readonly runs: readonly ResolvedRun[];
  readonly manifestDigest: string;
}

export interface FixturePackageMetadata {
  readonly agentIds: readonly AgentId[];
  readonly stageCount: number;
  readonly variants: Readonly<Record<string, unknown>>;
}
