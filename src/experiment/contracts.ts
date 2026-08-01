import type {
  AgentId,
  JsonObject,
  ModelDeclaration,
  ModelProfile,
  ProviderConnection,
} from "../model/contracts.js";

export type GitVisibility = "shared" | "isolated";
export type TeamRoomAvailability = "enabled" | "disabled";

export type AgentAssignment = Record<AgentId, string>;

export interface FixtureReference {
  /** Research-authored path, relative to the repository root. */
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

export interface RunDeclaration {
  id: string;
  fixture: FixtureReference;
  assignment: AgentAssignment;
  capabilities: ExperimentCapabilities;
  schedule: ExperimentSchedule;
  limits: ExperimentLimits;
  labels: JsonObject;
}

export interface ExperimentManifest {
  schemaVersion: 1;
  /** Human-readable name recorded with every resolved experiment. */
  experimentName?: string;
  /** Fixture definitions consumed by this experiment. Their file paths are repository-relative. */
  fixtures?: readonly Record<string, unknown>[];
  providers: Record<string, ProviderConnection>;
  models: Record<string, ModelDeclaration>;
  totalSpendCeilingCents: number;
  runs: RunDeclaration[];
}

export interface ResolvedFixtureReference extends FixtureReference {
  /** Runtime-only absolute root. Never serialize this field as the authored fixture path. */
  readonly packageRoot: string;
}

export interface ResolvedRun extends Omit<RunDeclaration, "fixture"> {
  readonly fixture: ResolvedFixtureReference;
}

export interface ResolvedExperiment extends Omit<ExperimentManifest, "models" | "runs"> {
  readonly models: Readonly<Record<string, ModelProfile>>;
  readonly runs: readonly ResolvedRun[];
  readonly manifestDigest: string;
}

/** The fixture fields needed for experiment validation without owning package contracts. */
export interface FixturePackageMetadata {
  readonly agentIds: readonly AgentId[];
  readonly stageCount: number;
  readonly variants: Readonly<Record<string, unknown>>;
}
