import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, sep, win32 } from "node:path";

import { hashProtocolSnapshot, resolveCondition } from "./condition.js";
import { validateRunSchedule } from "./config.js";
import {
  generateAgentIds,
  isAgentId,
  type AgentId,
  type JsonObject,
  type JsonValue,
  type ModelBinding,
  type ModelSettings,
  type ProviderDriver,
} from "./model.js";
import type { EvaluationResult, EvaluationSelection, EvaluationStatus } from "./evaluate.js";
import {
  SANDBOX_IMAGE_TAG,
  SANDBOX_POLICY,
  type SandboxCommandResult,
  type SandboxIdentity,
} from "./sandbox/contracts.js";
import type { TreeSeal } from "./seal.js";
import type { AgentSessionResult, SessionState } from "./session.js";
import type { TeamChannelMode } from "./team-channel.js";

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const BUILD_ID = /^build-[0-9a-f]{64}$/;
const PAIRED_BUILD_ID = /^paired-[0-9a-f]{64}$/;
const ALLOCATION_ID = /^allocation-[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REGISTERED_BLOCK_IDS = [
  "calibration-odd-women",
  "validation-pointed-firs",
  "validation-custom-country",
  "validation-woodlanders",
  "validation-silas-lapham",
] as const;
const CALIBRATION_ORDER = ["CS", "CR", "IR", "IS"] as const;
const VALIDATION_ORDERS = [
  ["CS", "CR", "IR", "IS"],
  ["CR", "IS", "CS", "IR"],
  ["IS", "IR", "CR", "CS"],
  ["IR", "CS", "IS", "CR"],
] as const;

export interface BuildPuzzleResult {
  pairedBuildId: string;
  blockId: string;
  buildPath: string;
  agentIds: readonly AgentId[];
  stageCount: 6;
  variants: {
    stationary: string;
    rekey: string;
  };
}

export interface BuildSource {
  sourceId: string;
  sha256: string;
}

export interface BuildReference {
  sourceId: string;
  sha256: string;
}

export interface BuildWindow {
  paragraphStart: number;
  paragraphEnd: number;
  wordCount: number;
  sha256: string;
}

export type AllocationTier = "strict" | "balanced" | "fallback";

export interface TierRejection {
  tier: AllocationTier;
  reasons: readonly string[];
}

export interface AllocationMetrics {
  regionDeviation: number;
  stageDeviation: number;
  soloChangedSetCoverage: number;
  minOwnerShare: number;
  anchorCount: number;
  sentinelCount: number;
  specialistCounts: Record<AgentId, number>;
  minOwnerOccurrencesPerRegion: number;
  minSentinelOccurrencesPerAgentRegion: number;
  unmatchedControlCount: number;
  maxControlDistance: number;
}

export interface AllocationSummary {
  allocationId: string;
  evidenceTier: AllocationTier;
  controlTier: AllocationTier;
  metrics: AllocationMetrics;
  rejectedTiers: readonly TierRejection[];
  path: string;
  sha256: string;
}

export interface OracleDesign {
  path: string;
  sha256: string;
  anchorsSha256: string;
  sentinelsSha256: string;
  specialistsSha256: string;
  controlsSha256: string;
}

export interface BuildKeyTransition {
  atStage: number;
  keyVersion: number;
  keyPath: string;
  changedSymbolsSha256: string;
}

export interface BuildStage {
  agentId: AgentId;
  ordinal: number;
  keyVersion: number;
  sourcePath: string;
  tokenCount: number;
  sha256: string;
}

export interface BuildVariant {
  variantId: "stationary" | "rekey";
  buildId: string;
  publicCiphertextPath: string;
  referenceCorpusPath: string;
  privateStageRoots: Record<AgentId, string>;
  stages: readonly BuildStage[];
  keyTransitions: readonly BuildKeyTransition[];
}

export interface ManipulationCheck {
  path: string;
  sha256: string;
  preBoundaryIdentical: true;
  stationaryOldKeyLoss: 0;
  rekeyOldKeyLoss: number;
  changedTokenMassByAgent: Record<AgentId, number>;
}

export interface BuildManifest {
  schemaVersion: 4;
  pairedBuildId: string;
  blockId: string;
  source: BuildSource;
  references: readonly BuildReference[];
  seed: number;
  window: BuildWindow;
  agentIds: readonly AgentId[];
  stageCount: 6;
  boundaryStage: 4;
  allocation: AllocationSummary;
  oracleDesign: OracleDesign;
  baseKeyPath: string;
  manipulationCheck: ManipulationCheck;
  variants: {
    stationary: BuildVariant;
    rekey: BuildVariant;
  };
}

export function selectBuildVariant(
  manifest: BuildManifest,
  variantId: "stationary" | "rekey",
): BuildVariant {
  return manifest.variants[variantId];
}

export interface SandboxPolicy {
  network: "none";
  cpus: 2;
  memoryBytes: 2_147_483_648;
  pids: 256;
  tmpfsBytes: 268_435_456;
  solverOutputBytes: 16_777_216;
  maxOutputBytes: 4_194_304;
}

export interface AttemptSession extends AgentSessionResult {
  model: ModelBinding;
}

type ResolvedCondition = ReturnType<typeof resolveCondition>;

export interface AttemptProtocolModel {
  agentId: AgentId;
  model: ModelBinding;
}

export interface AttemptProtocolPrompt {
  agentId: AgentId;
  prompt: string;
}

export interface AttemptProtocolSnapshot {
  schemaVersion: 3;
  blockId: string;
  condition: ResolvedCondition["id"];
  communicationMode: ResolvedCondition["communicationMode"];
  keyRegime: ResolvedCondition["keyRegime"];
  variantId: ResolvedCondition["variantId"];
  buildId: string;
  releaseOffsetsMs: readonly number[];
  cutoffMs: number;
  tokenBudgetPerAgent: number | null;
  teamChannel: TeamChannelMode;
  models: readonly AttemptProtocolModel[];
  prompts: readonly AttemptProtocolPrompt[];
  sandbox: SandboxIdentity & SandboxPolicy;
}

export interface FrozenGitRepository {
  repositoryId: "shared" | AgentId;
  path: string;
  agentIds: readonly AgentId[];
}

export interface FrozenGitWorkspace {
  agentId: AgentId;
  path: string;
  repositoryId: "shared" | AgentId;
}

export interface FrozenGitInventory {
  root: string;
  communicationMode: ResolvedCondition["communicationMode"];
  repositories: readonly FrozenGitRepository[];
  workspaces: readonly FrozenGitWorkspace[];
  treeSeal: TreeSeal;
}

export type StudyPhase = "calibration" | "validation";
export type AttemptStudyPhase = "standalone" | StudyPhase;
export type InfrastructureClassification = "none" | "session-infrastructure-error";

interface AttemptSummaryBase {
  schemaVersion: 5;
  attemptId: string;
  blockId: string;
  condition: ResolvedCondition["id"];
  communicationMode: ResolvedCondition["communicationMode"];
  keyRegime: ResolvedCondition["keyRegime"];
  variantId: ResolvedCondition["variantId"];
  buildId: string;
  buildRoot: string;
  buildTreeSeal: TreeSeal;
  agentIds: readonly AgentId[];
  releaseOffsetsMs: readonly number[];
  cutoffMs: number;
  tokenBudgetPerAgent: number | null;
  protocolDigest: string;
  protocol: AttemptProtocolSnapshot;
  tracePath: string;
  traceMetadataPath: string;
  frozen: FrozenGitInventory;
  sandbox: SandboxIdentity & SandboxPolicy;
  sessions: readonly AttemptSession[];
  monetaryAuthorizationCeilingCents: number;
  infrastructureClassification: InfrastructureClassification;
}

export interface StandaloneAttemptSummary extends AttemptSummaryBase {
  studyPhase: "standalone";
  studyRootId?: never;
  conditionOrderPosition?: never;
  designDigest?: never;
  replacementOfAttemptId?: never;
}

export interface StudyAttemptSummary extends AttemptSummaryBase {
  studyPhase: StudyPhase;
  studyRootId: string;
  conditionOrderPosition: number;
  designDigest: string;
  replacementOfAttemptId?: string;
}

export type AttemptSummary = StandaloneAttemptSummary | StudyAttemptSummary;

export interface DesignBuildBinding {
  blockId: string;
  buildRoot: string;
  buildManifestDigest: string;
  treeSeal: TreeSeal;
  manifest: BuildManifest;
}

export interface DesignAgentAssignment {
  agentId: AgentId;
  modelProfileId: string;
}

export interface DesignOrders {
  calibration: readonly ResolvedCondition["id"][];
  validation: readonly (readonly ResolvedCondition["id"][])[];
}

export interface DesignRubric {
  id: string;
  path: string;
  sha256: string;
}

export interface DesignScoring {
  primaryMetricId: "normalized-positional-word-v1";
  diagnosticMetricId: "palimpsest-diagnostics-v1";
  evaluationPolicyId: "all-canonical-main-snapshots-v1";
}

export interface DesignChecking {
  feedbackId: "published-runnability-coverage-v1";
}

export interface DesignPromptTemplate {
  agentId: AgentId;
  communicationMode: ResolvedCondition["communicationMode"];
  template: string;
  sha256: string;
}

export interface DesignPromptSnapshot {
  condition: ResolvedCondition["id"];
  agentId: AgentId;
  prompt: string;
  sha256: string;
}

export interface DesignFailurePolicy {
  stopOn: "session-infrastructure-error";
  automaticRetry: false;
  replacement: "explicit-appended";
}

export interface DesignTotalCeilings {
  tokens: number | null;
  monetaryAuthorizationCents: number;
}

export interface DesignBaselineBudgets {
  tokenBudgetPerAgent: number | null;
  perAttemptMonetaryCeilingCents: number;
}

export interface DesignReceipt {
  schemaVersion: 3;
  createdAt: string;
  sourceRevision: string;
  sandbox: SandboxIdentity & SandboxPolicy;
  manifestDigest: string;
  immutableManifestDigest: string;
  designDigest: string;
  immutableManifest: JsonObject;
  builds: readonly DesignBuildBinding[];
  assignment: readonly DesignAgentAssignment[];
  orders: DesignOrders;
  rubric: DesignRubric;
  checking: DesignChecking;
  scoring: DesignScoring;
  promptTemplates: readonly DesignPromptTemplate[];
  baselinePrompts: readonly DesignPromptSnapshot[];
  failurePolicy: DesignFailurePolicy;
  baselineBudgets: DesignBaselineBudgets;
  totalCeilings: DesignTotalCeilings;
}

export interface PlannedCell {
  cellId: string;
  phase: StudyPhase;
  blockId: string;
  condition: ResolvedCondition["id"];
  conditionOrderPosition: number;
  phasePosition: number;
  buildRoot: string;
  pairedBuildId: string;
  buildId: string;
}

export type LaunchKind = "primary" | "replacement";
export type LaunchReservationState = "reserved" | "resolved";

export interface LaunchReservation {
  reservationId: string;
  cellId: string;
  reservedAt: string;
  kind: LaunchKind;
  replacementOfAttemptId?: string;
  authorizedTokens: number | null;
  monetaryAuthorizationCeilingCents: number;
  state: LaunchReservationState;
  attemptId?: string;
}

export interface PhaseAdjustment {
  fieldPath: "budgets.tokenBudgetPerAgent" | "budgets.perAttemptMonetaryCeilingCents";
  priorValue: number | null;
  resolvedValue: number | null;
  priorManifestDigest: string;
  currentManifestDigest: string;
}

export interface PhaseAttemptReference {
  attemptId: string;
  attemptRoot: string;
  cellId: string;
  reservationId: string;
  infrastructureClassification: InfrastructureClassification;
  actualTokenUsage: number;
  replacementOfAttemptId?: string;
}

export interface PhaseFailure {
  kind: "unresolved-reservation" | "session-infrastructure-error";
  reservationId: string;
  attemptId?: string;
  detail: string;
}

export type PhaseState = "ready" | "running" | "blocked" | "complete";

export interface PhaseSummary {
  schemaVersion: 2;
  phase: StudyPhase;
  state: PhaseState;
  manifestDigest: string;
  immutableManifestDigest: string;
  designDigest: string;
  plannedCells: readonly PlannedCell[];
  adjustments: readonly PhaseAdjustment[];
  reservations: readonly LaunchReservation[];
  attempts: readonly PhaseAttemptReference[];
  cumulativeAuthorizedTokens: number | null;
  cumulativeAuthorizedMonetaryCents: number;
  cumulativeActualTokens: number;
  failure?: PhaseFailure;
}

export interface GitOverlapScan {
  reachableObjectCount: number;
  reachableBlobReferenceCount: number;
  uniqueReachableBlobCount: number;
  uniqueTextBlobCount: number;
  repeatedTreeReferenceCount: number;
  skippedNonTextBlobCount: number;
}

export interface OverlapFinding {
  committedPath: string;
  committedBlobId: string;
  sourceKind: "private-ciphertext" | "plaintext";
  sourceId: string;
  matchKind: "exact" | "normalized";
  wordCount: number;
  sha256: string;
}

export interface OverlapResult {
  findings: readonly OverlapFinding[];
  scan: GitOverlapScan;
}

export interface AggregateScore {
  matchedWords: number;
  totalWords: number;
  coverage: number;
  accuracy: number;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return Object.fromEntries(Object.entries(value));
}

function strictObject(
  value: unknown,
  name: string,
  fields: readonly string[],
): Record<string, unknown> {
  const record = object(value, name);
  const allowed = new Set(fields);
  const missing = fields.find((field) => !(field in record));
  if (missing !== undefined) throw new Error(`${name}.${missing} is required.`);
  const unknown = Object.keys(record).find((field) => !allowed.has(field));
  if (unknown !== undefined) throw new Error(`${name}.${unknown} is unsupported.`);
  return record;
}

function strictObjectWithOptional(
  value: unknown,
  name: string,
  requiredFields: readonly string[],
  optionalFields: readonly string[],
): Record<string, unknown> {
  const record = object(value, name);
  const allowed = new Set([...requiredFields, ...optionalFields]);
  const missing = requiredFields.find((field) => !(field in record));
  if (missing !== undefined) throw new Error(`${name}.${missing} is required.`);
  const unknown = Object.keys(record).find((field) => !allowed.has(field));
  if (unknown !== undefined) throw new Error(`${name}.${unknown} is unsupported.`);
  return record;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function integer(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer of at least ${String(minimum)}.`);
  }
  return value;
}

function nullableInteger(value: unknown, name: string, minimum = 0): number | null {
  return value === null ? null : integer(value, name, minimum);
}

function safeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer.`);
  }
  return value;
}

function finiteNumber(value: unknown, name: string, minimum = 0, maximum?: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new Error(
      `${name} must be a finite number between ${String(minimum)} and ${maximum === undefined ? "infinity" : String(maximum)}.`,
    );
  }
  return value;
}

function digest(value: unknown, name: string): string {
  const result = nonEmptyString(value, name);
  if (!SHA256.test(result)) throw new Error(`${name} must be a lowercase SHA-256 digest.`);
  return result;
}

function gitObjectId(value: unknown, name: string): string {
  const result = nonEmptyString(value, name);
  if (!GIT_OBJECT_ID.test(result)) {
    throw new Error(`${name} must be a lowercase SHA-1 or SHA-256 Git object ID.`);
  }
  return result;
}

function safeRelativePath(value: unknown, name: string): string {
  const path = nonEmptyString(value, name);
  const parts = path.split(/[\\/]/);
  if (
    posix.isAbsolute(path) ||
    win32.isAbsolute(path) ||
    path.includes("\0") ||
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new Error(`${name} must be a safe relative path.`);
  }
  return path;
}

function absolutePath(value: unknown, name: string): string {
  const path = nonEmptyString(value, name);
  if (!isAbsolute(path) || path.includes("\0")) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return path;
}

function identifier(value: unknown, name: string): string {
  const result = nonEmptyString(value, name);
  if (!IDENTIFIER.test(result)) {
    throw new Error(`${name} must be a lowercase hyphenated identifier.`);
  }
  return result;
}

function literal<const T extends string>(value: unknown, expected: T, name: string): T {
  if (value !== expected) throw new Error(`${name} must be ${expected}.`);
  return expected;
}

function agentId(value: unknown, name: string): AgentId {
  if (isAgentId(value)) return value;
  throw new Error(`${name} must identify one declared agent.`);
}

function decodeAgentIds(value: unknown, name: string): readonly AgentId[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${name} must contain at least two canonical agent IDs.`);
  }
  const decoded = value.map((item, index) => agentId(item, `${name}[${String(index)}]`));
  const expected = generateAgentIds(decoded.length);
  if (decoded.some((item, index) => item !== expected[index])) {
    throw new Error(`${name} must contain exactly agent-1 through agent-N in order.`);
  }
  return decoded;
}

const ATTEMPT_AGENT_IDS = generateAgentIds(3);

function decodeAttemptAgentIds(value: unknown, name: string): readonly AgentId[] {
  const decoded = decodeAgentIds(value, name);
  if (
    decoded.length !== ATTEMPT_AGENT_IDS.length ||
    decoded.some((item, index) => item !== ATTEMPT_AGENT_IDS[index])
  ) {
    throw new Error(`${name} must contain exactly agent-1, agent-2, and agent-3 in order.`);
  }
  return decoded;
}

function decodeReleaseOffsets(value: unknown, name: string): readonly number[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array.`);
  }
  const offsets = value.map((offset, index) => integer(offset, `${name}[${String(index)}]`));
  return offsets;
}

function assertNestedPath(root: string, path: string, name: string): void {
  const difference = relative(root, path);
  if (
    difference.length === 0 ||
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  ) {
    throw new Error(`${name} must remain inside the frozen root.`);
  }
}

function providerDriver(value: unknown, name: string): ProviderDriver {
  switch (value) {
    case "openai":
    case "anthropic":
    case "google":
    case "openai-compatible":
      return value;
    default:
      throw new Error(`${name} contains an unsupported provider driver.`);
  }
}

function decodeJsonValue(value: unknown, name: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${name} must contain only finite JSON numbers.`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => decodeJsonValue(item, `${name}[${String(index)}]`));
  }
  const record = object(value, name);
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, decodeJsonValue(item, `${name}.${key}`)]),
  );
}

function decodeJsonObject(value: unknown, name: string): JsonObject {
  const record = object(value, name);
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, decodeJsonValue(item, `${name}.${key}`)]),
  );
}

function assertSecretFreeJson(value: JsonValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSecretFreeJson(child, `${path}[${String(index)}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    const environmentReference = normalized.endsWith("env");
    const secretBearing =
      !environmentReference &&
      (normalized.includes("apikey") ||
        normalized === "authorization" ||
        normalized.endsWith("credential") ||
        normalized.endsWith("credentials") ||
        normalized.endsWith("password") ||
        normalized.endsWith("secret") ||
        normalized === "token" ||
        normalized.endsWith("accesstoken") ||
        normalized.endsWith("authtoken") ||
        normalized.endsWith("bearertoken"));
    if (secretBearing) {
      throw new Error(`${path}.${key} is secret-bearing.`);
    }
    assertSecretFreeJson(child, `${path}.${key}`);
  }
}

function decodeModelSettings(value: unknown, name: string): ModelSettings {
  const record = object(value, name);
  const allowed = new Set(["maxOutputTokens", "temperature", "topP", "seed"]);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown !== undefined) throw new Error(`${name}.${unknown} is unsupported.`);
  const maxOutputTokens =
    record.maxOutputTokens === undefined
      ? undefined
      : integer(record.maxOutputTokens, `${name}.maxOutputTokens`, 1);
  const temperature =
    record.temperature === undefined
      ? undefined
      : finiteNumber(record.temperature, `${name}.temperature`);
  const topP =
    record.topP === undefined ? undefined : finiteNumber(record.topP, `${name}.topP`, 0, 1);
  if (topP !== undefined && topP === 0) throw new Error(`${name}.topP must be greater than zero.`);
  const seed = record.seed === undefined ? undefined : safeInteger(record.seed, `${name}.seed`);
  return {
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(topP === undefined ? {} : { topP }),
    ...(seed === undefined ? {} : { seed }),
  };
}

export function decodeModelBinding(value: unknown, name = "Model binding"): ModelBinding {
  const record = object(value, name);
  const actualProvider =
    record.actualProvider === undefined
      ? undefined
      : nonEmptyString(record.actualProvider, `${name}.actualProvider`);
  const actualModel =
    record.actualModel === undefined
      ? undefined
      : nonEmptyString(record.actualModel, `${name}.actualModel`);
  return {
    profile: identifier(record.profile, `${name}.profile`),
    provider: identifier(record.provider, `${name}.provider`),
    driver: providerDriver(record.driver, `${name}.driver`),
    requestedModel: nonEmptyString(record.requestedModel, `${name}.requestedModel`),
    settings: decodeModelSettings(record.settings, `${name}.settings`),
    providerOptions: decodeJsonObject(record.providerOptions, `${name}.providerOptions`),
    ...(actualProvider === undefined ? {} : { actualProvider }),
    ...(actualModel === undefined ? {} : { actualModel }),
  };
}

function sessionState(value: unknown, name: string): SessionState {
  switch (value) {
    case "finished":
    case "token-exhausted":
    case "time-exhausted":
    case "infrastructure-error":
      return value;
    default:
      throw new Error(`${name} contains an unsupported session state.`);
  }
}

function evaluationStatus(value: unknown): EvaluationStatus {
  switch (value) {
    case "scored":
    case "not-runnable":
    case "no-output":
    case "execution-error":
      return value;
    default:
      throw new Error("Evaluation status is unsupported.");
  }
}

function decodeBuildId(value: unknown, name: string): string {
  const result = nonEmptyString(value, name);
  if (!BUILD_ID.test(result)) {
    throw new Error(`${name} must contain a lowercase SHA-256 digest.`);
  }
  return result;
}

export function decodeBuildResult(value: unknown): BuildPuzzleResult {
  const record = strictObject(value, "Puzzle build result", [
    "pairedBuildId",
    "blockId",
    "buildPath",
    "agentIds",
    "stageCount",
    "variants",
  ]);
  const stageCount = integer(record.stageCount, "Puzzle build result stageCount", 1);
  if (stageCount !== 6) throw new Error("Puzzle build result stageCount must be exactly 6.");
  const variants = strictObject(record.variants, "Puzzle build result variants", [
    "stationary",
    "rekey",
  ]);
  return {
    pairedBuildId: decodePrefixedDigest(
      record.pairedBuildId,
      PAIRED_BUILD_ID,
      "Puzzle build result pairedBuildId",
    ),
    blockId: identifier(record.blockId, "Puzzle build result blockId"),
    buildPath: absolutePath(record.buildPath, "Puzzle build result buildPath"),
    agentIds: decodeAgentIds(record.agentIds, "Puzzle build result agentIds"),
    stageCount: 6,
    variants: {
      stationary: decodeBuildId(variants.stationary, "Puzzle build result variants.stationary"),
      rekey: decodeBuildId(variants.rekey, "Puzzle build result variants.rekey"),
    },
  };
}

const BUILD_AGENT_IDS = ["agent-1", "agent-2", "agent-3"] as const;
const BUILD_STAGE_COUNT = 6;
const BUILD_BOUNDARY_STAGE = 4;
const ALLOCATION_TIERS = ["strict", "balanced", "fallback"] as const;
const TIER_LIMITS = {
  strict: {
    minOwnerShare: 0.67,
    maxSoloCoverage: 0.6,
    maxRegionDeviation: 0.04,
    maxStageDeviation: 0.12,
    maxControlDistance: 0.15,
    minOwnerOccurrencesPerRegion: 3,
    minSentinelOccurrencesPerAgentRegion: 3,
  },
  balanced: {
    minOwnerShare: 0.6,
    maxSoloCoverage: 0.67,
    maxRegionDeviation: 0.07,
    maxStageDeviation: 0.18,
    maxControlDistance: 0.25,
    minOwnerOccurrencesPerRegion: 2,
    minSentinelOccurrencesPerAgentRegion: 2,
  },
  fallback: {
    minOwnerShare: 0.55,
    maxSoloCoverage: 0.75,
    maxRegionDeviation: 0.1,
    maxStageDeviation: 0.25,
    maxControlDistance: 0.4,
    minOwnerOccurrencesPerRegion: 2,
    minSentinelOccurrencesPerAgentRegion: 1,
  },
} satisfies Record<AllocationTier, Record<string, number>>;

function decodeRatio(value: unknown, name: string, minimum = 0): number {
  const result = finiteNumber(value, name, minimum, 1);
  return result;
}

function decodePrefixedDigest(value: unknown, pattern: RegExp, name: string): string {
  const result = nonEmptyString(value, name);
  if (!pattern.test(result)) {
    throw new Error(`${name} must contain a lowercase SHA-256 digest.`);
  }
  return result;
}

function decodeBuildAgentIds(value: unknown): readonly AgentId[] {
  const decoded = decodeAgentIds(value, "Puzzle build agentIds");
  if (
    decoded.length !== BUILD_AGENT_IDS.length ||
    decoded.some((item, index) => item !== BUILD_AGENT_IDS[index])
  ) {
    throw new Error("Puzzle build agentIds must contain exactly three canonical agents.");
  }
  return decoded;
}

function decodeBuildSource(value: unknown): BuildSource {
  const record = strictObject(value, "Puzzle build source", ["sourceId", "sha256"]);
  return {
    sourceId: identifier(record.sourceId, "Puzzle build source sourceId"),
    sha256: digest(record.sha256, "Puzzle build source sha256"),
  };
}

function decodeBuildReferences(value: unknown, sourceId: string): readonly BuildReference[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Puzzle build references must be a non-empty array.");
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const name = `Puzzle build reference ${String(index + 1)}`;
    const record = strictObject(item, name, ["sourceId", "sha256"]);
    const referenceId = identifier(record.sourceId, `${name} sourceId`);
    if (referenceId === sourceId) {
      throw new Error("Puzzle build target source cannot also be a reference.");
    }
    if (seen.has(referenceId)) throw new Error("Puzzle build reference source IDs must be unique.");
    seen.add(referenceId);
    return {
      sourceId: referenceId,
      sha256: digest(record.sha256, `${name} sha256`),
    };
  });
}

function decodeBuildWindow(value: unknown): BuildWindow {
  const name = "Puzzle build window";
  const record = strictObject(value, name, [
    "paragraphStart",
    "paragraphEnd",
    "wordCount",
    "sha256",
  ]);
  const paragraphStart = integer(record.paragraphStart, `${name} paragraphStart`, 1);
  const paragraphEnd = integer(record.paragraphEnd, `${name} paragraphEnd`, 1);
  if (paragraphEnd < paragraphStart) {
    throw new Error("Puzzle build window paragraph range must be ordered.");
  }
  const wordCount = integer(record.wordCount, `${name} wordCount`, 16_000);
  if (wordCount > 20_000) {
    throw new Error("Puzzle build window wordCount must not exceed 20000.");
  }
  return {
    paragraphStart,
    paragraphEnd,
    wordCount,
    sha256: digest(record.sha256, `${name} sha256`),
  };
}

function decodeAgentNumberMap(
  value: unknown,
  name: string,
  minimum: number,
): Record<AgentId, number> {
  const record = strictObject(value, name, BUILD_AGENT_IDS);
  return Object.fromEntries(
    BUILD_AGENT_IDS.map((id) => [id, decodeRatio(record[id], `${name}.${id}`, minimum)]),
  ) as Record<AgentId, number>;
}

function decodeAgentCountMap(value: unknown, name: string): Record<AgentId, number> {
  const record = strictObject(value, name, BUILD_AGENT_IDS);
  return Object.fromEntries(
    BUILD_AGENT_IDS.map((id) => [id, integer(record[id], `${name}.${id}`, 3)]),
  ) as Record<AgentId, number>;
}

function allocationTier(value: unknown, name: string): AllocationTier {
  switch (value) {
    case "strict":
    case "balanced":
    case "fallback":
      return value;
    default:
      throw new Error(`${name} contains an unsupported allocation tier.`);
  }
}

function decodeAllocationMetrics(value: unknown): AllocationMetrics {
  const name = "Puzzle build allocation metrics";
  const record = strictObject(value, name, [
    "regionDeviation",
    "stageDeviation",
    "soloChangedSetCoverage",
    "minOwnerShare",
    "anchorCount",
    "sentinelCount",
    "specialistCounts",
    "minOwnerOccurrencesPerRegion",
    "minSentinelOccurrencesPerAgentRegion",
    "unmatchedControlCount",
    "maxControlDistance",
  ]);
  const unmatchedControlCount = integer(
    record.unmatchedControlCount,
    `${name} unmatchedControlCount`,
  );
  if (unmatchedControlCount !== 0) {
    throw new Error("Puzzle build allocation unmatchedControlCount must be zero.");
  }
  return {
    regionDeviation: decodeRatio(record.regionDeviation, `${name} regionDeviation`),
    stageDeviation: decodeRatio(record.stageDeviation, `${name} stageDeviation`),
    soloChangedSetCoverage: decodeRatio(
      record.soloChangedSetCoverage,
      `${name} soloChangedSetCoverage`,
    ),
    minOwnerShare: decodeRatio(record.minOwnerShare, `${name} minOwnerShare`),
    anchorCount: integer(record.anchorCount, `${name} anchorCount`, 12),
    sentinelCount: integer(record.sentinelCount, `${name} sentinelCount`, 6),
    specialistCounts: decodeAgentCountMap(record.specialistCounts, `${name} specialistCounts`),
    minOwnerOccurrencesPerRegion: integer(
      record.minOwnerOccurrencesPerRegion,
      `${name} minOwnerOccurrencesPerRegion`,
      1,
    ),
    minSentinelOccurrencesPerAgentRegion: integer(
      record.minSentinelOccurrencesPerAgentRegion,
      `${name} minSentinelOccurrencesPerAgentRegion`,
      1,
    ),
    unmatchedControlCount,
    maxControlDistance: decodeRatio(record.maxControlDistance, `${name} maxControlDistance`),
  };
}

function decodeAllocationSummary(value: unknown): AllocationSummary {
  const name = "Puzzle build allocation";
  const record = strictObject(value, name, [
    "allocationId",
    "evidenceTier",
    "controlTier",
    "metrics",
    "rejectedTiers",
    "path",
    "sha256",
  ]);
  const evidenceTier = allocationTier(record.evidenceTier, `${name} evidenceTier`);
  const controlTier = allocationTier(record.controlTier, `${name} controlTier`);
  const metrics = decodeAllocationMetrics(record.metrics);
  if (!Array.isArray(record.rejectedTiers)) {
    throw new Error(`${name} rejectedTiers must be an array.`);
  }
  const rejectedTiers = record.rejectedTiers.map((item, index): TierRejection => {
    const rejectionName = `${name} rejected tier ${String(index + 1)}`;
    const rejection = strictObject(item, rejectionName, ["tier", "reasons"]);
    if (!Array.isArray(rejection.reasons) || rejection.reasons.length === 0) {
      throw new Error(`${rejectionName} reasons must be a non-empty array.`);
    }
    const reasons = rejection.reasons.map((reason, reasonIndex) =>
      identifier(reason, `${rejectionName} reasons[${String(reasonIndex)}]`),
    );
    if (new Set(reasons).size !== reasons.length) {
      throw new Error(`${rejectionName} reasons must be unique.`);
    }
    return { tier: allocationTier(rejection.tier, `${rejectionName} tier`), reasons };
  });
  const expectedRejected = ALLOCATION_TIERS.slice(0, ALLOCATION_TIERS.indexOf(evidenceTier));
  if (
    rejectedTiers.length !== expectedRejected.length ||
    rejectedTiers.some((rejection, index) => rejection.tier !== expectedRejected[index])
  ) {
    throw new Error("Puzzle build rejected tiers must contain all earlier tiers in order.");
  }
  const evidenceLimits = TIER_LIMITS[evidenceTier];
  if (
    metrics.minOwnerShare < evidenceLimits.minOwnerShare ||
    metrics.soloChangedSetCoverage > evidenceLimits.maxSoloCoverage ||
    metrics.regionDeviation > evidenceLimits.maxRegionDeviation ||
    metrics.stageDeviation > evidenceLimits.maxStageDeviation ||
    metrics.minOwnerOccurrencesPerRegion < evidenceLimits.minOwnerOccurrencesPerRegion ||
    metrics.minSentinelOccurrencesPerAgentRegion < evidenceLimits.minSentinelOccurrencesPerAgentRegion
  ) {
    throw new Error(
      `Puzzle build allocation metrics do not satisfy the ${evidenceTier} evidence tier.`,
    );
  }
  const controlLimit = TIER_LIMITS[controlTier].maxControlDistance;
  if (
    controlTier !== "fallback" &&
    (metrics.unmatchedControlCount !== 0 || metrics.maxControlDistance > controlLimit)
  ) {
    throw new Error(`Puzzle build allocation controls do not satisfy the ${controlTier} tier.`);
  }
  const path = safeRelativePath(record.path, `${name} path`);
  if (path !== "oracle/allocation.json") {
    throw new Error("Puzzle build allocation path must be oracle/allocation.json.");
  }
  return {
    allocationId: decodePrefixedDigest(record.allocationId, ALLOCATION_ID, `${name} allocationId`),
    evidenceTier,
    controlTier,
    metrics,
    rejectedTiers,
    path,
    sha256: digest(record.sha256, `${name} sha256`),
  };
}

function decodeOracleDesign(value: unknown): OracleDesign {
  const name = "Puzzle build oracleDesign";
  const record = strictObject(value, name, [
    "path",
    "sha256",
    "anchorsSha256",
    "sentinelsSha256",
    "specialistsSha256",
    "controlsSha256",
  ]);
  const path = safeRelativePath(record.path, `${name} path`);
  if (path !== "oracle/design.json") {
    throw new Error("Puzzle build oracleDesign path must be oracle/design.json.");
  }
  return {
    path,
    sha256: digest(record.sha256, `${name} sha256`),
    anchorsSha256: digest(record.anchorsSha256, `${name} anchorsSha256`),
    sentinelsSha256: digest(record.sentinelsSha256, `${name} sentinelsSha256`),
    specialistsSha256: digest(record.specialistsSha256, `${name} specialistsSha256`),
    controlsSha256: digest(record.controlsSha256, `${name} controlsSha256`),
  };
}

function decodeManipulationCheck(value: unknown): ManipulationCheck {
  const name = "Puzzle build manipulationCheck";
  const record = strictObject(value, name, [
    "path",
    "sha256",
    "preBoundaryIdentical",
    "stationaryOldKeyLoss",
    "rekeyOldKeyLoss",
    "changedTokenMassByAgent",
  ]);
  const path = safeRelativePath(record.path, `${name} path`);
  if (path !== "oracle/manipulation-check.json") {
    throw new Error("Puzzle build manipulationCheck path must be oracle/manipulation-check.json.");
  }
  if (record.preBoundaryIdentical !== true) {
    throw new Error("Puzzle build manipulationCheck must confirm pre-boundary identity.");
  }
  const stationaryOldKeyLoss = decodeRatio(
    record.stationaryOldKeyLoss,
    `${name} stationaryOldKeyLoss`,
  );
  if (stationaryOldKeyLoss !== 0) {
    throw new Error("Puzzle build stationary old-key loss must be zero.");
  }
  return {
    path,
    sha256: digest(record.sha256, `${name} sha256`),
    preBoundaryIdentical: true,
    stationaryOldKeyLoss: 0,
    rekeyOldKeyLoss: decodeRatio(record.rekeyOldKeyLoss, `${name} rekeyOldKeyLoss`, 0.15),
    changedTokenMassByAgent: decodeAgentNumberMap(
      record.changedTokenMassByAgent,
      `${name} changedTokenMassByAgent`,
      0.15,
    ),
  };
}

function decodeAgentPathMap(
  value: unknown,
  variantId: "stationary" | "rekey",
): Record<AgentId, string> {
  const name = `Puzzle build ${variantId} privateStageRoots`;
  const record = strictObject(value, name, BUILD_AGENT_IDS);
  return Object.fromEntries(
    BUILD_AGENT_IDS.map((id) => {
      const path = safeRelativePath(record[id], `${name}.${id}`);
      const expected = `variants/${variantId}/private/${id}/stages`;
      if (path !== expected) {
        throw new Error(`Puzzle build ${variantId} private roots must use its variant tree.`);
      }
      return [id, path];
    }),
  ) as Record<AgentId, string>;
}

function decodeBuildKeyTransition(value: unknown, index: number): BuildKeyTransition {
  const name = `Puzzle build key transition ${String(index + 1)}`;
  const record = strictObject(value, name, [
    "atStage",
    "keyVersion",
    "keyPath",
    "changedSymbolsSha256",
  ]);
  const atStage = integer(record.atStage, `${name} atStage`, 1);
  const keyVersion = integer(record.keyVersion, `${name} keyVersion`, 1);
  const keyPath = safeRelativePath(record.keyPath, `${name} keyPath`);
  if (
    atStage !== BUILD_BOUNDARY_STAGE ||
    keyVersion !== 1 ||
    keyPath !== "oracle/keys/rekey-stage-04.json"
  ) {
    throw new Error("Puzzle build key transition must introduce version 1 at stage 4.");
  }
  return {
    atStage,
    keyVersion,
    keyPath,
    changedSymbolsSha256: digest(record.changedSymbolsSha256, `${name} changedSymbolsSha256`),
  };
}

function decodeBuildVariant(value: unknown, expectedVariant: "stationary" | "rekey"): BuildVariant {
  const name = `Puzzle build ${expectedVariant} variant`;
  const record = strictObject(value, name, [
    "variantId",
    "buildId",
    "publicCiphertextPath",
    "referenceCorpusPath",
    "privateStageRoots",
    "stages",
    "keyTransitions",
  ]);
  if (record.variantId !== expectedVariant) {
    throw new Error(`${name} variantId must be ${expectedVariant}.`);
  }
  const prefix = `variants/${expectedVariant}`;
  const publicCiphertextPath = safeRelativePath(
    record.publicCiphertextPath,
    `${name} publicCiphertextPath`,
  );
  if (publicCiphertextPath !== `${prefix}/complete/ciphertext.txt`) {
    throw new Error(`Puzzle build ${expectedVariant} public ciphertext path is invalid.`);
  }
  const referenceCorpusPath = safeRelativePath(
    record.referenceCorpusPath,
    `${name} referenceCorpusPath`,
  );
  if (referenceCorpusPath !== `${prefix}/references`) {
    throw new Error(`Puzzle build ${expectedVariant} reference corpus path is invalid.`);
  }
  if (!Array.isArray(record.stages) || record.stages.length !== 18) {
    throw new Error(`${name} must contain exactly 18 stages.`);
  }
  const stages = record.stages.map((item, index): BuildStage => {
    const stageName = `${name} stage ${String(index + 1)}`;
    const stage = strictObject(item, stageName, [
      "agentId",
      "ordinal",
      "keyVersion",
      "sourcePath",
      "tokenCount",
      "sha256",
    ]);
    const expectedAgent = BUILD_AGENT_IDS[Math.floor(index / BUILD_STAGE_COUNT)]!;
    const expectedOrdinal = (index % BUILD_STAGE_COUNT) + 1;
    const decodedAgent = agentId(stage.agentId, `${stageName} agentId`);
    const ordinal = integer(stage.ordinal, `${stageName} ordinal`, 1);
    if (decodedAgent !== expectedAgent || ordinal !== expectedOrdinal) {
      throw new Error(`${name} must contain 18 ordered stages.`);
    }
    const keyVersion = integer(stage.keyVersion, `${stageName} keyVersion`);
    const expectedKeyVersion =
      expectedVariant === "rekey" && ordinal >= BUILD_BOUNDARY_STAGE ? 1 : 0;
    if (keyVersion !== expectedKeyVersion) {
      throw new Error(`${name} stage key version is inconsistent.`);
    }
    const sourcePath = safeRelativePath(stage.sourcePath, `${stageName} sourcePath`);
    const expectedPath = `${prefix}/private/${decodedAgent}/stages/stage-${String(ordinal).padStart(2, "0")}.txt`;
    if (sourcePath !== expectedPath) {
      throw new Error(`${name} stage source paths must use its private tree.`);
    }
    return {
      agentId: decodedAgent,
      ordinal,
      keyVersion,
      sourcePath,
      tokenCount: integer(stage.tokenCount, `${stageName} tokenCount`, 1),
      sha256: digest(stage.sha256, `${stageName} sha256`),
    };
  });
  if (!Array.isArray(record.keyTransitions)) {
    throw new Error(`${name} keyTransitions must be an array.`);
  }
  const keyTransitions = record.keyTransitions.map(decodeBuildKeyTransition);
  if (expectedVariant === "stationary" && keyTransitions.length !== 0) {
    throw new Error("Puzzle build stationary keyTransitions must be empty.");
  }
  if (expectedVariant === "rekey" && keyTransitions.length !== 1) {
    throw new Error("Puzzle build rekey must contain one stage-four key transition.");
  }
  return {
    variantId: expectedVariant,
    buildId: decodeBuildId(record.buildId, `${name} buildId`),
    publicCiphertextPath,
    referenceCorpusPath,
    privateStageRoots: decodeAgentPathMap(record.privateStageRoots, expectedVariant),
    stages,
    keyTransitions,
  };
}

export function decodeBuildManifest(value: unknown): BuildManifest {
  const name = "Puzzle build manifest";
  const record = strictObject(value, name, [
    "schemaVersion",
    "pairedBuildId",
    "blockId",
    "source",
    "references",
    "seed",
    "window",
    "agentIds",
    "stageCount",
    "boundaryStage",
    "allocation",
    "oracleDesign",
    "baseKeyPath",
    "manipulationCheck",
    "variants",
  ]);
  if (record.schemaVersion !== 4) {
    throw new Error("Unsupported puzzle build schema version.");
  }
  const source = decodeBuildSource(record.source);
  const agentIds = decodeBuildAgentIds(record.agentIds);
  const stageCount = integer(record.stageCount, `${name} stageCount`, 1);
  if (stageCount !== BUILD_STAGE_COUNT) {
    throw new Error("Puzzle build stageCount must be exactly 6.");
  }
  const boundaryStage = integer(record.boundaryStage, `${name} boundaryStage`, 1);
  if (boundaryStage !== BUILD_BOUNDARY_STAGE) {
    throw new Error("Puzzle build boundaryStage must be exactly 4.");
  }
  const baseKeyPath = safeRelativePath(record.baseKeyPath, `${name} baseKeyPath`);
  if (baseKeyPath !== "oracle/keys/base.json") {
    throw new Error("Puzzle build baseKeyPath must be oracle/keys/base.json.");
  }
  const variants = strictObject(record.variants, `${name} variants`, ["stationary", "rekey"]);
  const stationary = decodeBuildVariant(variants.stationary, "stationary");
  const rekey = decodeBuildVariant(variants.rekey, "rekey");
  if (stationary.buildId === rekey.buildId) {
    throw new Error("Puzzle build variant build IDs must be distinct.");
  }
  stationary.stages.forEach((stage, index) => {
    if (stage.ordinal < boundaryStage && stage.sha256 !== rekey.stages[index]!.sha256) {
      throw new Error("Puzzle build pre-boundary stage digests must be identical.");
    }
  });
  return {
    schemaVersion: 4,
    pairedBuildId: decodePrefixedDigest(
      record.pairedBuildId,
      PAIRED_BUILD_ID,
      `${name} pairedBuildId`,
    ),
    blockId: identifier(record.blockId, `${name} blockId`),
    source,
    references: decodeBuildReferences(record.references, source.sourceId),
    seed: safeInteger(record.seed, `${name} seed`),
    window: decodeBuildWindow(record.window),
    agentIds,
    stageCount: 6,
    boundaryStage: 4,
    allocation: decodeAllocationSummary(record.allocation),
    oracleDesign: decodeOracleDesign(record.oracleDesign),
    baseKeyPath,
    manipulationCheck: decodeManipulationCheck(record.manipulationCheck),
    variants: { stationary, rekey },
  };
}

function decodeAttemptModelBinding(value: unknown, name: string): ModelBinding {
  const record = strictObjectWithOptional(
    value,
    name,
    ["profile", "provider", "driver", "requestedModel", "settings", "providerOptions"],
    ["actualProvider", "actualModel"],
  );
  return decodeModelBinding(record, name);
}

function declaredModelBinding(model: ModelBinding): ModelBinding {
  return {
    profile: model.profile,
    provider: model.provider,
    driver: model.driver,
    requestedModel: model.requestedModel,
    settings: model.settings,
    providerOptions: model.providerOptions,
  };
}

function sameProtocolValue(left: unknown, right: unknown): boolean {
  return hashProtocolSnapshot(left) === hashProtocolSnapshot(right);
}

function decodeSession(value: unknown, index: number, expectedAgentId: AgentId): AttemptSession {
  const name = `Attempt session ${String(index + 1)}`;
  const record = strictObjectWithOptional(
    value,
    name,
    [
      "agentId",
      "model",
      "state",
      "inputTokens",
      "outputTokens",
      "activityCursor",
      "terminationReason",
    ],
    ["finalResponse"],
  );
  const finalResponse =
    record.finalResponse === undefined
      ? undefined
      : nonEmptyString(record.finalResponse, `${name} finalResponse`);
  const decodedAgentId = agentId(record.agentId, `${name} agentId`);
  if (decodedAgentId !== expectedAgentId) {
    throw new Error("Attempt sessions must follow the declared agent order.");
  }
  const common = {
    agentId: decodedAgentId,
    model: decodeAttemptModelBinding(record.model, `${name} model`),
    state: sessionState(record.state, `${name} state`),
    inputTokens: integer(record.inputTokens, `${name} inputTokens`),
    outputTokens: integer(record.outputTokens, `${name} outputTokens`),
    activityCursor: integer(record.activityCursor, `${name} activityCursor`),
    terminationReason: nonEmptyString(record.terminationReason, `${name} terminationReason`),
  };
  return finalResponse === undefined ? common : { ...common, finalResponse };
}

function decodeSandbox(value: unknown): SandboxIdentity & SandboxPolicy {
  const record = strictObject(value, "Attempt sandbox", [
    "imageTag",
    "imageId",
    "sourceDigest",
    "profileVersion",
    ...Object.keys(SANDBOX_POLICY),
  ]);
  const imageTag = nonEmptyString(record.imageTag, "Attempt sandbox imageTag");
  if (imageTag !== SANDBOX_IMAGE_TAG) {
    throw new Error(`Attempt sandbox imageTag must be ${SANDBOX_IMAGE_TAG}.`);
  }
  const imageId = nonEmptyString(record.imageId, "Attempt sandbox imageId");
  if (!IMAGE_ID.test(imageId)) {
    throw new Error("Attempt sandbox imageId must be an immutable SHA-256 image ID.");
  }
  if (record.profileVersion !== 1) {
    throw new Error("Unsupported attempt sandbox profile version.");
  }
  for (const [key, expected] of Object.entries(SANDBOX_POLICY)) {
    if (record[key] !== expected) {
      throw new Error(`Attempt sandbox ${key} does not match the current policy.`);
    }
  }
  return {
    imageTag,
    imageId,
    sourceDigest: digest(record.sourceDigest, "Attempt sandbox sourceDigest"),
    profileVersion: 1,
    ...SANDBOX_POLICY,
  };
}

function repositoryId(value: unknown, name: string): "shared" | AgentId {
  if (value === "shared") return value;
  return agentId(value, name);
}

function decodeTreeSeal(value: unknown, name: string): TreeSeal {
  const record = strictObject(value, name, ["schemaVersion", "digest", "fileCount", "byteCount"]);
  if (record.schemaVersion !== 1) {
    throw new Error(`Unsupported ${name} schema version.`);
  }
  return {
    schemaVersion: 1,
    digest: digest(record.digest, `${name} digest`),
    fileCount: integer(record.fileCount, `${name} fileCount`),
    byteCount: integer(record.byteCount, `${name} byteCount`),
  };
}

function decodeFrozenGitInventory(
  value: unknown,
  communicationMode: ResolvedCondition["communicationMode"],
  agentIds: readonly AgentId[],
): FrozenGitInventory {
  const record = strictObject(value, "Attempt frozen Git", [
    "root",
    "communicationMode",
    "repositories",
    "workspaces",
    "treeSeal",
  ]);
  if (record.communicationMode !== communicationMode) {
    throw new Error("Attempt frozen Git communication mode must match its condition.");
  }
  const root = absolutePath(record.root, "Attempt frozen Git root");
  const expectedRepositoryIds = communicationMode === "shared" ? (["shared"] as const) : agentIds;
  if (
    !Array.isArray(record.repositories) ||
    record.repositories.length !== expectedRepositoryIds.length
  ) {
    throw new Error("Attempt frozen Git repository inventory does not match its condition.");
  }
  const repositories = record.repositories.map((item, index): FrozenGitRepository => {
    const name = `Attempt frozen Git repository ${String(index + 1)}`;
    const repository = strictObject(item, name, ["repositoryId", "path", "agentIds"]);
    const decodedRepositoryId = repositoryId(repository.repositoryId, `${name} repositoryId`);
    if (decodedRepositoryId !== expectedRepositoryIds[index]) {
      throw new Error("Attempt frozen Git repositories must follow the condition topology.");
    }
    const expectedAgents = communicationMode === "shared" ? agentIds : [agentIds[index]!];
    if (
      !Array.isArray(repository.agentIds) ||
      repository.agentIds.length !== expectedAgents.length
    ) {
      throw new Error(`${name} agentIds do not match the assigned workspace set.`);
    }
    const decodedAgents = repository.agentIds.map((itemAgent, agentIndex) =>
      agentId(itemAgent, `${name} agentIds[${String(agentIndex)}]`),
    );
    if (decodedAgents.some((itemAgent, agentIndex) => itemAgent !== expectedAgents[agentIndex])) {
      throw new Error(`${name} agentIds do not match the assigned workspace set.`);
    }
    const path = absolutePath(repository.path, `${name} path`);
    assertNestedPath(root, path, `${name} path`);
    return {
      repositoryId: decodedRepositoryId,
      path,
      agentIds: decodedAgents,
    };
  });

  if (!Array.isArray(record.workspaces) || record.workspaces.length !== agentIds.length) {
    throw new Error("Attempt frozen Git must contain one workspace per agent.");
  }
  const workspaces = record.workspaces.map((item, index): FrozenGitWorkspace => {
    const name = `Attempt frozen Git workspace ${String(index + 1)}`;
    const workspace = strictObject(item, name, ["agentId", "path", "repositoryId"]);
    const decodedAgentId = agentId(workspace.agentId, `${name} agentId`);
    if (decodedAgentId !== agentIds[index]) {
      throw new Error("Attempt frozen Git workspaces must follow the declared agent order.");
    }
    const decodedRepositoryId = repositoryId(workspace.repositoryId, `${name} repositoryId`);
    const expectedRepositoryId = communicationMode === "shared" ? "shared" : decodedAgentId;
    if (decodedRepositoryId !== expectedRepositoryId) {
      throw new Error(`${name} must reference its condition-assigned repository.`);
    }
    const path = absolutePath(workspace.path, `${name} path`);
    assertNestedPath(root, path, `${name} path`);
    return { agentId: decodedAgentId, path, repositoryId: decodedRepositoryId };
  });
  const paths = [...repositories.map(({ path }) => path), ...workspaces.map(({ path }) => path)];
  if (new Set(paths).size !== paths.length) {
    throw new Error("Attempt frozen Git repository and workspace paths must be unique.");
  }
  return {
    root,
    communicationMode,
    repositories,
    workspaces,
    treeSeal: decodeTreeSeal(record.treeSeal, "Attempt frozen Git tree seal"),
  };
}

interface AttemptProtocolExpectations {
  blockId: string;
  condition: ResolvedCondition;
  buildId: string;
  releaseOffsetsMs: readonly number[];
  cutoffMs: number;
  tokenBudgetPerAgent: number | null;
  agentIds: readonly AgentId[];
  sandbox: SandboxIdentity & SandboxPolicy;
  sessions: readonly AttemptSession[];
}

function decodeAttemptProtocol(
  value: unknown,
  expected: AttemptProtocolExpectations,
): AttemptProtocolSnapshot {
  const record = strictObject(value, "Attempt protocol", [
    "schemaVersion",
    "blockId",
    "condition",
    "communicationMode",
    "keyRegime",
    "variantId",
    "buildId",
    "releaseOffsetsMs",
    "cutoffMs",
    "tokenBudgetPerAgent",
    "teamChannel",
    "models",
    "prompts",
    "sandbox",
  ]);
  if (record.schemaVersion !== 3) {
    throw new Error("Unsupported attempt protocol schema version.");
  }
  const condition = resolveCondition(record.condition);
  const blockId = identifier(record.blockId, "Attempt protocol blockId");
  const buildId = decodeBuildId(record.buildId, "Attempt protocol buildId");
  const releaseOffsetsMs = decodeReleaseOffsets(
    record.releaseOffsetsMs,
    "Attempt protocol releaseOffsetsMs",
  );
  const cutoffMs = integer(record.cutoffMs, "Attempt protocol cutoffMs", 1);
  const tokenBudgetPerAgent = nullableInteger(
    record.tokenBudgetPerAgent,
    "Attempt protocol tokenBudgetPerAgent",
    1,
  );
  const teamChannel = record.teamChannel;
  if (teamChannel !== "enabled" && teamChannel !== "disabled") {
    throw new Error("Attempt protocol teamChannel must be enabled or disabled.");
  }
  if (
    blockId !== expected.blockId ||
    condition.id !== expected.condition.id ||
    record.communicationMode !== expected.condition.communicationMode ||
    record.keyRegime !== expected.condition.keyRegime ||
    record.variantId !== expected.condition.variantId ||
    buildId !== expected.buildId ||
    !sameProtocolValue(releaseOffsetsMs, expected.releaseOffsetsMs) ||
    cutoffMs !== expected.cutoffMs ||
    tokenBudgetPerAgent !== expected.tokenBudgetPerAgent
  ) {
    throw new Error("Attempt protocol fields must match the declared attempt.");
  }

  if (!Array.isArray(record.models) || record.models.length !== expected.agentIds.length) {
    throw new Error("Attempt protocol must contain one model binding per agent.");
  }
  const models = record.models.map((item, index): AttemptProtocolModel => {
    const name = `Attempt protocol model ${String(index + 1)}`;
    const entry = strictObject(item, name, ["agentId", "model"]);
    const decodedAgentId = agentId(entry.agentId, `${name} agentId`);
    if (decodedAgentId !== expected.agentIds[index]) {
      throw new Error("Attempt protocol models must follow the declared agent order.");
    }
    const modelRecord = strictObject(entry.model, `${name} binding`, [
      "profile",
      "provider",
      "driver",
      "requestedModel",
      "settings",
      "providerOptions",
    ]);
    const model = decodeModelBinding(modelRecord, `${name} binding`);
    if (!sameProtocolValue(model, declaredModelBinding(expected.sessions[index]!.model))) {
      throw new Error(`${name} binding must match its declared session model.`);
    }
    return { agentId: decodedAgentId, model };
  });

  if (!Array.isArray(record.prompts) || record.prompts.length !== expected.agentIds.length) {
    throw new Error("Attempt protocol must contain one prompt per agent.");
  }
  const prompts = record.prompts.map((item, index): AttemptProtocolPrompt => {
    const name = `Attempt protocol prompt ${String(index + 1)}`;
    const entry = strictObject(item, name, ["agentId", "prompt"]);
    const decodedAgentId = agentId(entry.agentId, `${name} agentId`);
    if (decodedAgentId !== expected.agentIds[index]) {
      throw new Error("Attempt protocol prompts must follow the declared agent order.");
    }
    return {
      agentId: decodedAgentId,
      prompt: nonEmptyString(entry.prompt, `${name} prompt`),
    };
  });
  const sandbox = decodeSandbox(record.sandbox);
  if (!sameProtocolValue(sandbox, expected.sandbox)) {
    throw new Error("Attempt protocol sandbox must match the declared attempt sandbox.");
  }
  return {
    schemaVersion: 3,
    blockId,
    condition: condition.id,
    communicationMode: condition.communicationMode,
    keyRegime: condition.keyRegime,
    variantId: condition.variantId,
    buildId,
    releaseOffsetsMs,
    cutoffMs,
    tokenBudgetPerAgent,
    teamChannel,
    models,
    prompts,
    sandbox,
  };
}

export function decodeAttemptSummary(value: unknown): AttemptSummary {
  const record = strictObjectWithOptional(
    value,
    "Attempt summary",
    [
      "schemaVersion",
      "attemptId",
      "studyPhase",
      "blockId",
      "condition",
      "communicationMode",
      "keyRegime",
      "variantId",
      "buildId",
      "buildRoot",
      "buildTreeSeal",
      "agentIds",
      "releaseOffsetsMs",
      "cutoffMs",
      "tokenBudgetPerAgent",
      "protocolDigest",
      "protocol",
      "tracePath",
      "traceMetadataPath",
      "frozen",
      "sandbox",
      "sessions",
      "monetaryAuthorizationCeilingCents",
      "infrastructureClassification",
    ],
    ["studyRootId", "conditionOrderPosition", "designDigest", "replacementOfAttemptId"],
  );
  if (record.schemaVersion !== 5) throw new Error("Unsupported attempt schema version.");
  const agentIds = decodeAttemptAgentIds(record.agentIds, "Attempt summary agentIds");
  if (!Array.isArray(record.sessions) || record.sessions.length !== agentIds.length) {
    throw new Error("Attempt summary must contain exactly one session per agent.");
  }
  const sessions = record.sessions.map((session, index) =>
    decodeSession(session, index, agentIds[index]!),
  );
  const condition = resolveCondition(record.condition);
  if (
    record.communicationMode !== condition.communicationMode ||
    record.keyRegime !== condition.keyRegime ||
    record.variantId !== condition.variantId
  ) {
    throw new Error("Attempt treatment fields must be derived from its canonical condition.");
  }
  const blockId = identifier(record.blockId, "Attempt summary blockId");
  const buildId = decodeBuildId(record.buildId, "Attempt summary buildId");
  const releaseOffsetsMs = decodeReleaseOffsets(
    record.releaseOffsetsMs,
    "Attempt summary releaseOffsetsMs",
  );
  const cutoffMs = integer(record.cutoffMs, "Attempt summary cutoffMs", 1);
  validateRunSchedule(releaseOffsetsMs, cutoffMs, 6, "Attempt summary");
  const tokenBudgetPerAgent = nullableInteger(
    record.tokenBudgetPerAgent,
    "Attempt summary tokenBudgetPerAgent",
    1,
  );
  const sandbox = decodeSandbox(record.sandbox);
  const protocol = decodeAttemptProtocol(record.protocol, {
    blockId,
    condition,
    buildId,
    releaseOffsetsMs,
    cutoffMs,
    tokenBudgetPerAgent,
    agentIds,
    sandbox,
    sessions,
  });
  const protocolDigest = digest(record.protocolDigest, "Attempt summary protocolDigest");
  if (hashProtocolSnapshot(protocol) !== protocolDigest) {
    throw new Error("Attempt summary protocolDigest does not match its protocol snapshot.");
  }
  const frozen = decodeFrozenGitInventory(record.frozen, condition.communicationMode, agentIds);
  const attemptId = nonEmptyString(record.attemptId, "Attempt summary attemptId");
  const infrastructureClassification = decodeInfrastructureClassification(
    record.infrastructureClassification,
    "Attempt summary infrastructureClassification",
  );
  const hasInfrastructureSession = sessions.some(
    (session) => session.state === "infrastructure-error",
  );
  if (
    (infrastructureClassification === "session-infrastructure-error") !==
    hasInfrastructureSession
  ) {
    throw new Error(
      "Attempt summary infrastructureClassification must match its frozen session states.",
    );
  }
  const common: AttemptSummaryBase = {
    schemaVersion: 5,
    attemptId,
    blockId,
    condition: condition.id,
    communicationMode: condition.communicationMode,
    keyRegime: condition.keyRegime,
    variantId: condition.variantId,
    buildId,
    buildRoot: absolutePath(record.buildRoot, "Attempt summary buildRoot"),
    buildTreeSeal: decodeTreeSeal(record.buildTreeSeal, "Attempt build tree seal"),
    agentIds,
    releaseOffsetsMs,
    cutoffMs,
    tokenBudgetPerAgent,
    protocolDigest,
    protocol,
    tracePath: absolutePath(record.tracePath, "Attempt summary tracePath"),
    traceMetadataPath: absolutePath(record.traceMetadataPath, "Attempt summary traceMetadataPath"),
    frozen,
    sandbox,
    sessions,
    monetaryAuthorizationCeilingCents: integer(
      record.monetaryAuthorizationCeilingCents,
      "Attempt summary monetaryAuthorizationCeilingCents",
    ),
    infrastructureClassification,
  };
  if (record.studyPhase === "standalone") {
    if (
      record.studyRootId !== undefined ||
      record.conditionOrderPosition !== undefined ||
      record.designDigest !== undefined ||
      record.replacementOfAttemptId !== undefined
    ) {
      throw new Error("Standalone attempt summary must not contain study provenance or lineage.");
    }
    return { ...common, studyPhase: "standalone" };
  }
  const studyPhase = decodeStudyPhase(record.studyPhase, "Attempt summary studyPhase");
  const replacementOfAttemptId =
    record.replacementOfAttemptId === undefined
      ? undefined
      : nonEmptyString(record.replacementOfAttemptId, "Attempt summary replacementOfAttemptId");
  if (replacementOfAttemptId === attemptId) {
    throw new Error("Attempt summary cannot replace itself.");
  }
  return {
    ...common,
    studyPhase,
    studyRootId: identifier(record.studyRootId, "Attempt summary studyRootId"),
    conditionOrderPosition: boundedInteger(
      record.conditionOrderPosition,
      "Attempt summary conditionOrderPosition",
      1,
      4,
    ),
    designDigest: digest(record.designDigest, "Attempt summary designDigest"),
    ...(replacementOfAttemptId === undefined ? {} : { replacementOfAttemptId }),
  };
}

export async function publishAttemptSummary(
  attemptRoot: string,
  summary: AttemptSummary,
): Promise<void> {
  await publishExclusiveJson(join(attemptRoot, "attempt.json"), decodeAttemptSummary(summary));
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  const decoded = integer(value, name, minimum);
  if (decoded > maximum) {
    throw new Error(`${name} must be at most ${String(maximum)}.`);
  }
  return decoded;
}

function timestamp(value: unknown, name: string): string {
  const decoded = nonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(decoded))) {
    throw new Error(`${name} must be an ISO 8601 timestamp.`);
  }
  return decoded;
}

function stringDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeStudyPhase(value: unknown, name: string): StudyPhase {
  if (value === "calibration" || value === "validation") return value;
  throw new Error(`${name} must be calibration or validation.`);
}

function decodeInfrastructureClassification(
  value: unknown,
  name: string,
): InfrastructureClassification {
  if (value === "none" || value === "session-infrastructure-error") return value;
  throw new Error(`${name} must be none or session-infrastructure-error.`);
}

function decodeConditionOrder(
  value: unknown,
  expected: readonly ResolvedCondition["id"][],
  name: string,
): readonly ResolvedCondition["id"][] {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((condition, index) => condition !== expected[index])
  ) {
    throw new Error(`${name} does not match the frozen condition order.`);
  }
  return expected.map((condition) => resolveCondition(condition).id);
}

function decodeDesignBuild(value: unknown, index: number): DesignBuildBinding {
  const name = `Design receipt build ${String(index + 1)}`;
  const record = strictObject(value, name, [
    "blockId",
    "buildRoot",
    "buildManifestDigest",
    "treeSeal",
    "manifest",
  ]);
  const blockId = identifier(record.blockId, `${name} blockId`);
  const expectedBlockId = REGISTERED_BLOCK_IDS[index];
  if (blockId !== expectedBlockId) {
    throw new Error("Design receipt builds must contain the five registered blocks in order.");
  }
  const manifest = decodeBuildManifest(record.manifest);
  if (manifest.blockId !== blockId) {
    throw new Error(`${name} manifest must match its blockId.`);
  }
  return {
    blockId,
    buildRoot: absolutePath(record.buildRoot, `${name} buildRoot`),
    buildManifestDigest: digest(record.buildManifestDigest, `${name} buildManifestDigest`),
    treeSeal: decodeTreeSeal(record.treeSeal, `${name} tree seal`),
    manifest,
  };
}

function decodeDesignAssignment(value: unknown, index: number): DesignAgentAssignment {
  const name = `Design receipt assignment ${String(index + 1)}`;
  const record = strictObject(value, name, ["agentId", "modelProfileId"]);
  const decodedAgentId = agentId(record.agentId, `${name} agentId`);
  if (decodedAgentId !== ATTEMPT_AGENT_IDS[index]) {
    throw new Error("Design receipt assignment must follow canonical agent order.");
  }
  return {
    agentId: decodedAgentId,
    modelProfileId: identifier(record.modelProfileId, `${name} modelProfileId`),
  };
}

function decodeDesignOrders(value: unknown): DesignOrders {
  const record = strictObject(value, "Design receipt orders", ["calibration", "validation"]);
  if (!Array.isArray(record.validation) || record.validation.length !== VALIDATION_ORDERS.length) {
    throw new Error("Design receipt validation orders must contain four block orders.");
  }
  return {
    calibration: decodeConditionOrder(
      record.calibration,
      CALIBRATION_ORDER,
      "Design receipt calibration order",
    ),
    validation: record.validation.map((order, index) =>
      decodeConditionOrder(
        order,
        VALIDATION_ORDERS[index]!,
        `Design receipt validation order ${String(index + 1)}`,
      ),
    ),
  };
}

function decodeDesignPromptTemplate(value: unknown, index: number): DesignPromptTemplate {
  const name = `Design receipt prompt template ${String(index + 1)}`;
  const record = strictObject(value, name, ["agentId", "communicationMode", "template", "sha256"]);
  const decodedAgentId = agentId(record.agentId, `${name} agentId`);
  if (decodedAgentId !== ATTEMPT_AGENT_IDS[Math.floor(index / 2)]) {
    throw new Error("Design receipt prompt templates must follow canonical agent order.");
  }
  const communicationMode = index % 2 === 0 ? "shared" : "isolated";
  if (record.communicationMode !== communicationMode) {
    throw new Error(
      "Design receipt prompt templates must contain shared then isolated for each agent.",
    );
  }
  const template = nonEmptyString(record.template, `${name} template`);
  const sha256 = digest(record.sha256, `${name} sha256`);
  if (stringDigest(template) !== sha256) {
    throw new Error(`${name} sha256 must match its template bytes.`);
  }
  return { agentId: decodedAgentId, communicationMode, template, sha256 };
}

function decodeDesignPromptSnapshot(value: unknown, index: number): DesignPromptSnapshot {
  const name = `Design receipt baseline prompt ${String(index + 1)}`;
  const record = strictObject(value, name, ["condition", "agentId", "prompt", "sha256"]);
  const condition = resolveCondition(record.condition).id;
  const decodedAgentId = agentId(record.agentId, `${name} agentId`);
  const prompt = nonEmptyString(record.prompt, `${name} prompt`);
  const sha256 = digest(record.sha256, `${name} sha256`);
  if (stringDigest(prompt) !== sha256) {
    throw new Error(`${name} sha256 must match its prompt bytes.`);
  }
  return { condition, agentId: decodedAgentId, prompt, sha256 };
}

export function decodeDesignReceipt(value: unknown): DesignReceipt {
  const record = strictObject(value, "Design receipt", [
    "schemaVersion",
    "createdAt",
    "sourceRevision",
    "sandbox",
    "manifestDigest",
    "immutableManifestDigest",
    "designDigest",
    "immutableManifest",
    "builds",
    "assignment",
    "orders",
    "rubric",
    "checking",
    "scoring",
    "promptTemplates",
    "baselinePrompts",
    "failurePolicy",
    "baselineBudgets",
    "totalCeilings",
  ]);
  if (record.schemaVersion !== 3) {
    throw new Error("Unsupported design receipt schema version.");
  }
  if (!Array.isArray(record.builds) || record.builds.length !== REGISTERED_BLOCK_IDS.length) {
    throw new Error("Design receipt must contain exactly five registered builds.");
  }
  const builds = record.builds.map(decodeDesignBuild);
  if (
    new Set(builds.map((build) => build.buildRoot)).size !== builds.length ||
    new Set(builds.map((build) => build.manifest.pairedBuildId)).size !== builds.length
  ) {
    throw new Error("Design receipt builds must have unique roots and paired identities.");
  }
  if (!Array.isArray(record.assignment) || record.assignment.length !== ATTEMPT_AGENT_IDS.length) {
    throw new Error("Design receipt assignment must contain exactly three agents.");
  }
  const assignment = record.assignment.map(decodeDesignAssignment);
  const rubric = strictObject(record.rubric, "Design receipt rubric", ["id", "path", "sha256"]);
  const checking = strictObject(record.checking, "Design receipt checking", ["feedbackId"]);
  const scoring = strictObject(record.scoring, "Design receipt scoring", [
    "primaryMetricId",
    "diagnosticMetricId",
    "evaluationPolicyId",
  ]);
  if (
    !Array.isArray(record.promptTemplates) ||
    record.promptTemplates.length !== ATTEMPT_AGENT_IDS.length * 2
  ) {
    throw new Error(
      "Design receipt must contain shared and isolated prompt templates for each agent.",
    );
  }
  const promptTemplates = record.promptTemplates.map(decodeDesignPromptTemplate);
  if (
    !Array.isArray(record.baselinePrompts) ||
    record.baselinePrompts.length !== ATTEMPT_AGENT_IDS.length * 4
  ) {
    throw new Error("Design receipt must contain twelve baseline prompt snapshots.");
  }
  const baselinePrompts = record.baselinePrompts.map(decodeDesignPromptSnapshot);
  const promptKeys = baselinePrompts.map((prompt) => `${prompt.condition}\0${prompt.agentId}`);
  if (new Set(promptKeys).size !== promptKeys.length) {
    throw new Error("Design receipt baseline prompts must contain each condition-agent pair once.");
  }
  const failurePolicy = strictObject(record.failurePolicy, "Design receipt failurePolicy", [
    "stopOn",
    "automaticRetry",
    "replacement",
  ]);
  if (
    failurePolicy.stopOn !== "session-infrastructure-error" ||
    failurePolicy.automaticRetry !== false ||
    failurePolicy.replacement !== "explicit-appended"
  ) {
    throw new Error("Design receipt failurePolicy must match the frozen replacement policy.");
  }
  const baselineBudgets = strictObject(record.baselineBudgets, "Design receipt baselineBudgets", [
    "tokenBudgetPerAgent",
    "perAttemptMonetaryCeilingCents",
  ]);
  const totalCeilings = strictObject(record.totalCeilings, "Design receipt totalCeilings", [
    "tokens",
    "monetaryAuthorizationCents",
  ]);
  const immutableManifest = decodeJsonObject(
    record.immutableManifest,
    "Design receipt immutableManifest",
  );
  assertSecretFreeJson(immutableManifest, "Design receipt immutableManifest");
  return {
    schemaVersion: 3,
    createdAt: timestamp(record.createdAt, "Design receipt createdAt"),
    sourceRevision: gitObjectId(record.sourceRevision, "Design receipt sourceRevision"),
    sandbox: decodeSandbox(record.sandbox),
    manifestDigest: digest(record.manifestDigest, "Design receipt manifestDigest"),
    immutableManifestDigest: digest(
      record.immutableManifestDigest,
      "Design receipt immutableManifestDigest",
    ),
    designDigest: digest(record.designDigest, "Design receipt designDigest"),
    immutableManifest,
    builds,
    assignment,
    orders: decodeDesignOrders(record.orders),
    rubric: {
      id: identifier(rubric.id, "Design receipt rubric id"),
      path: safeRelativePath(rubric.path, "Design receipt rubric path"),
      sha256: digest(rubric.sha256, "Design receipt rubric sha256"),
    },
    checking: {
      feedbackId: literal(
        checking.feedbackId,
        "published-runnability-coverage-v1",
        "Design receipt checking feedbackId",
      ),
    },
    scoring: {
      primaryMetricId: literal(
        scoring.primaryMetricId,
        "normalized-positional-word-v1",
        "Design receipt scoring primaryMetricId",
      ),
      diagnosticMetricId: literal(
        scoring.diagnosticMetricId,
        "palimpsest-diagnostics-v1",
        "Design receipt scoring diagnosticMetricId",
      ),
      evaluationPolicyId: literal(
        scoring.evaluationPolicyId,
        "all-canonical-main-snapshots-v1",
        "Design receipt scoring evaluationPolicyId",
      ),
    },
    promptTemplates,
    baselinePrompts,
    failurePolicy: {
      stopOn: "session-infrastructure-error",
      automaticRetry: false,
      replacement: "explicit-appended",
    },
    baselineBudgets: {
      tokenBudgetPerAgent: nullableInteger(
        baselineBudgets.tokenBudgetPerAgent,
        "Design receipt baseline token budget per agent",
        1,
      ),
      perAttemptMonetaryCeilingCents: integer(
        baselineBudgets.perAttemptMonetaryCeilingCents,
        "Design receipt baseline per-attempt monetary authorization ceiling",
      ),
    },
    totalCeilings: {
      tokens: nullableInteger(totalCeilings.tokens, "Design receipt total token ceiling", 1),
      monetaryAuthorizationCents: integer(
        totalCeilings.monetaryAuthorizationCents,
        "Design receipt total monetary authorization ceiling",
      ),
    },
  };
}

function decodePlannedCell(value: unknown, index: number, phase: StudyPhase): PlannedCell {
  const name = `Phase planned cell ${String(index + 1)}`;
  const record = strictObject(value, name, [
    "cellId",
    "phase",
    "blockId",
    "condition",
    "conditionOrderPosition",
    "phasePosition",
    "buildRoot",
    "pairedBuildId",
    "buildId",
  ]);
  if (record.phase !== phase) {
    throw new Error(`${name} phase must match its phase summary.`);
  }
  const phasePosition = integer(record.phasePosition, `${name} phasePosition`, 1);
  if (phasePosition !== index + 1) {
    throw new Error("Phase planned cells must be in contiguous phase-position order.");
  }
  return {
    cellId: nonEmptyString(record.cellId, `${name} cellId`),
    phase,
    blockId: identifier(record.blockId, `${name} blockId`),
    condition: resolveCondition(record.condition).id,
    conditionOrderPosition: boundedInteger(
      record.conditionOrderPosition,
      `${name} conditionOrderPosition`,
      1,
      4,
    ),
    phasePosition,
    buildRoot: absolutePath(record.buildRoot, `${name} buildRoot`),
    pairedBuildId: decodePrefixedDigest(
      record.pairedBuildId,
      PAIRED_BUILD_ID,
      `${name} pairedBuildId`,
    ),
    buildId: decodeBuildId(record.buildId, `${name} buildId`),
  };
}

export function decodeLaunchReservation(
  value: unknown,
  name = "Launch reservation",
): LaunchReservation {
  const record = strictObjectWithOptional(
    value,
    name,
    [
      "reservationId",
      "cellId",
      "reservedAt",
      "kind",
      "authorizedTokens",
      "monetaryAuthorizationCeilingCents",
      "state",
    ],
    ["replacementOfAttemptId", "attemptId"],
  );
  if (record.kind !== "primary" && record.kind !== "replacement") {
    throw new Error(`${name} kind must be primary or replacement.`);
  }
  if (record.state !== "reserved" && record.state !== "resolved") {
    throw new Error(`${name} state must be reserved or resolved.`);
  }
  const replacementOfAttemptId =
    record.replacementOfAttemptId === undefined
      ? undefined
      : nonEmptyString(record.replacementOfAttemptId, `${name} replacementOfAttemptId`);
  const attemptId =
    record.attemptId === undefined
      ? undefined
      : nonEmptyString(record.attemptId, `${name} attemptId`);
  if ((record.kind === "replacement") !== (replacementOfAttemptId !== undefined)) {
    throw new Error(`${name} replacement lineage must match its kind.`);
  }
  if ((record.state === "resolved") !== (attemptId !== undefined)) {
    throw new Error(`${name} attemptId must be present exactly when resolved.`);
  }
  if (attemptId !== undefined && attemptId === replacementOfAttemptId) {
    throw new Error(`${name} replacement attempt cannot replace itself.`);
  }
  return {
    reservationId: nonEmptyString(record.reservationId, `${name} reservationId`),
    cellId: nonEmptyString(record.cellId, `${name} cellId`),
    reservedAt: timestamp(record.reservedAt, `${name} reservedAt`),
    kind: record.kind,
    ...(replacementOfAttemptId === undefined ? {} : { replacementOfAttemptId }),
    authorizedTokens: nullableInteger(record.authorizedTokens, `${name} authorizedTokens`, 1),
    monetaryAuthorizationCeilingCents: integer(
      record.monetaryAuthorizationCeilingCents,
      `${name} monetaryAuthorizationCeilingCents`,
    ),
    state: record.state,
    ...(attemptId === undefined ? {} : { attemptId }),
  };
}

function decodePhaseAdjustment(value: unknown, index: number): PhaseAdjustment {
  const name = `Phase adjustment ${String(index + 1)}`;
  const record = strictObject(value, name, [
    "fieldPath",
    "priorValue",
    "resolvedValue",
    "priorManifestDigest",
    "currentManifestDigest",
  ]);
  if (
    record.fieldPath !== "budgets.tokenBudgetPerAgent" &&
    record.fieldPath !== "budgets.perAttemptMonetaryCeilingCents"
  ) {
    throw new Error(`${name} fieldPath is not calibration-adjustable.`);
  }
  const minimum = record.fieldPath === "budgets.tokenBudgetPerAgent" ? 1 : 0;
  return {
    fieldPath: record.fieldPath,
    priorValue:
      record.fieldPath === "budgets.tokenBudgetPerAgent"
        ? nullableInteger(record.priorValue, `${name} priorValue`, minimum)
        : integer(record.priorValue, `${name} priorValue`, minimum),
    resolvedValue:
      record.fieldPath === "budgets.tokenBudgetPerAgent"
        ? nullableInteger(record.resolvedValue, `${name} resolvedValue`, minimum)
        : integer(record.resolvedValue, `${name} resolvedValue`, minimum),
    priorManifestDigest: digest(record.priorManifestDigest, `${name} priorManifestDigest`),
    currentManifestDigest: digest(record.currentManifestDigest, `${name} currentManifestDigest`),
  };
}

function decodePhaseAttemptReference(value: unknown, index: number): PhaseAttemptReference {
  const name = `Phase attempt ${String(index + 1)}`;
  const record = strictObjectWithOptional(
    value,
    name,
    [
      "attemptId",
      "attemptRoot",
      "cellId",
      "reservationId",
      "infrastructureClassification",
      "actualTokenUsage",
    ],
    ["replacementOfAttemptId"],
  );
  const attemptId = nonEmptyString(record.attemptId, `${name} attemptId`);
  const replacementOfAttemptId =
    record.replacementOfAttemptId === undefined
      ? undefined
      : nonEmptyString(record.replacementOfAttemptId, `${name} replacementOfAttemptId`);
  if (replacementOfAttemptId === attemptId) {
    throw new Error(`${name} cannot replace itself.`);
  }
  return {
    attemptId,
    attemptRoot: absolutePath(record.attemptRoot, `${name} attemptRoot`),
    cellId: nonEmptyString(record.cellId, `${name} cellId`),
    reservationId: nonEmptyString(record.reservationId, `${name} reservationId`),
    infrastructureClassification: decodeInfrastructureClassification(
      record.infrastructureClassification,
      `${name} infrastructureClassification`,
    ),
    actualTokenUsage: integer(record.actualTokenUsage, `${name} actualTokenUsage`),
    ...(replacementOfAttemptId === undefined ? {} : { replacementOfAttemptId }),
  };
}

function decodePhaseFailure(value: unknown): PhaseFailure {
  const record = strictObjectWithOptional(
    value,
    "Phase failure",
    ["kind", "reservationId", "detail"],
    ["attemptId"],
  );
  if (record.kind !== "unresolved-reservation" && record.kind !== "session-infrastructure-error") {
    throw new Error("Phase failure kind is unsupported.");
  }
  const attemptId =
    record.attemptId === undefined
      ? undefined
      : nonEmptyString(record.attemptId, "Phase failure attemptId");
  if ((record.kind === "session-infrastructure-error") !== (attemptId !== undefined)) {
    throw new Error("Phase failure attemptId must be present only for a frozen session failure.");
  }
  return {
    kind: record.kind,
    reservationId: nonEmptyString(record.reservationId, "Phase failure reservationId"),
    ...(attemptId === undefined ? {} : { attemptId }),
    detail: nonEmptyString(record.detail, "Phase failure detail"),
  };
}

function assertPlannedMatrix(phase: StudyPhase, cells: readonly PlannedCell[]): void {
  const expectedCount = phase === "calibration" ? 4 : 16;
  if (cells.length !== expectedCount) {
    throw new Error(
      `Phase summary ${phase} plan must contain exactly ${String(expectedCount)} cells.`,
    );
  }
  const expectedBlocks =
    phase === "calibration" ? REGISTERED_BLOCK_IDS.slice(0, 1) : REGISTERED_BLOCK_IDS.slice(1);
  const expectedOrders = phase === "calibration" ? [CALIBRATION_ORDER] : VALIDATION_ORDERS;
  cells.forEach((cell, index) => {
    const blockIndex = Math.floor(index / 4);
    const conditionIndex = index % 4;
    if (
      cell.blockId !== expectedBlocks[blockIndex] ||
      cell.condition !== expectedOrders[blockIndex]![conditionIndex] ||
      cell.conditionOrderPosition !== conditionIndex + 1
    ) {
      throw new Error(
        "Phase summary planned cells do not match the frozen block-condition matrix.",
      );
    }
  });
}

export function decodePhaseSummary(value: unknown): PhaseSummary {
  const record = strictObjectWithOptional(
    value,
    "Phase summary",
    [
      "schemaVersion",
      "phase",
      "state",
      "manifestDigest",
      "immutableManifestDigest",
      "designDigest",
      "plannedCells",
      "adjustments",
      "reservations",
      "attempts",
      "cumulativeAuthorizedTokens",
      "cumulativeAuthorizedMonetaryCents",
      "cumulativeActualTokens",
    ],
    ["failure"],
  );
  if (record.schemaVersion !== 2) {
    throw new Error("Unsupported phase summary schema version.");
  }
  const phase = decodeStudyPhase(record.phase, "Phase summary phase");
  if (
    record.state !== "ready" &&
    record.state !== "running" &&
    record.state !== "blocked" &&
    record.state !== "complete"
  ) {
    throw new Error("Phase summary state is unsupported.");
  }
  if (!Array.isArray(record.plannedCells)) {
    throw new Error("Phase summary plannedCells must be an array.");
  }
  const plannedCells = record.plannedCells.map((cell, index) =>
    decodePlannedCell(cell, index, phase),
  );
  assertPlannedMatrix(phase, plannedCells);
  const cellIds = plannedCells.map((cell) => cell.cellId);
  if (new Set(cellIds).size !== cellIds.length) {
    throw new Error("Phase summary planned cell IDs must be unique.");
  }
  if (!Array.isArray(record.adjustments)) {
    throw new Error("Phase summary adjustments must be an array.");
  }
  const adjustments = record.adjustments.map(decodePhaseAdjustment);
  if (phase === "calibration" && adjustments.length !== 0) {
    throw new Error("Calibration phase summary must not contain adjustments.");
  }
  if (
    adjustments.length > 2 ||
    new Set(adjustments.map((adjustment) => adjustment.fieldPath)).size !== adjustments.length
  ) {
    throw new Error("Phase summary adjustments must contain each adjustable field at most once.");
  }
  const manifestDigest = digest(record.manifestDigest, "Phase summary manifestDigest");
  for (const adjustment of adjustments) {
    if (adjustment.currentManifestDigest !== manifestDigest) {
      throw new Error("Phase adjustment current manifest digest must match the phase summary.");
    }
  }
  if (!Array.isArray(record.reservations)) {
    throw new Error("Phase summary reservations must be an array.");
  }
  const reservations = record.reservations.map((reservation, index) =>
    decodeLaunchReservation(reservation, `Phase reservation ${String(index + 1)}`),
  );
  if (
    new Set(reservations.map((reservation) => reservation.reservationId)).size !==
    reservations.length
  ) {
    throw new Error("Phase summary reservation IDs must be unique.");
  }
  const cellIdSet = new Set(cellIds);
  if (reservations.some((reservation) => !cellIdSet.has(reservation.cellId))) {
    throw new Error("Phase summary reservations must reference planned cells.");
  }
  const primaryCells = reservations
    .filter((reservation) => reservation.kind === "primary")
    .map((reservation) => reservation.cellId);
  if (new Set(primaryCells).size !== primaryCells.length) {
    throw new Error("Phase summary cannot reserve a primary cell more than once.");
  }
  if (primaryCells.some((cellId, index) => plannedCells[index]?.cellId !== cellId)) {
    throw new Error("Phase summary primary reservations must follow planned cell order.");
  }
  const unresolved = reservations.filter((reservation) => reservation.state === "reserved");
  if (unresolved.length > 1 || (unresolved.length === 1 && reservations.at(-1) !== unresolved[0])) {
    throw new Error("Phase summary may contain only one final unresolved reservation.");
  }
  if (!Array.isArray(record.attempts)) {
    throw new Error("Phase summary attempts must be an array.");
  }
  const attempts = record.attempts.map(decodePhaseAttemptReference);
  if (
    new Set(attempts.map((attempt) => attempt.attemptId)).size !== attempts.length ||
    new Set(attempts.map((attempt) => attempt.attemptRoot)).size !== attempts.length ||
    new Set(attempts.map((attempt) => attempt.reservationId)).size !== attempts.length
  ) {
    throw new Error("Phase summary durable attempt identities must be unique.");
  }
  const attemptsById = new Map<string, PhaseAttemptReference>();
  const attemptsByReservation = new Map<string, PhaseAttemptReference>();
  for (const attempt of attempts) {
    const reservation = reservations.find(
      (candidate) => candidate.reservationId === attempt.reservationId,
    );
    if (
      reservation === undefined ||
      reservation.state !== "resolved" ||
      reservation.attemptId !== attempt.attemptId ||
      reservation.cellId !== attempt.cellId ||
      reservation.replacementOfAttemptId !== attempt.replacementOfAttemptId
    ) {
      throw new Error("Phase attempt must match one resolved launch reservation.");
    }
    attemptsById.set(attempt.attemptId, attempt);
    attemptsByReservation.set(attempt.reservationId, attempt);
  }
  if (
    reservations.some(
      (reservation) =>
        (reservation.state === "resolved") !== attemptsByReservation.has(reservation.reservationId),
    )
  ) {
    throw new Error("Phase resolved reservations and durable attempts must correspond exactly.");
  }
  const replacementSources = new Set<string>();
  for (const reservation of reservations) {
    if (reservation.kind !== "replacement") continue;
    const source = attemptsById.get(reservation.replacementOfAttemptId!);
    const replacementAttempt = attemptsByReservation.get(reservation.reservationId);
    if (
      source === undefined ||
      source.cellId !== reservation.cellId ||
      source.infrastructureClassification !== "session-infrastructure-error" ||
      replacementSources.has(source.attemptId) ||
      (replacementAttempt !== undefined &&
        attempts.indexOf(source) >= attempts.indexOf(replacementAttempt))
    ) {
      throw new Error("Phase replacement lineage must cite one earlier eligible attempt.");
    }
    replacementSources.add(source.attemptId);
  }
  const cumulativeAuthorizedTokens = nullableInteger(
    record.cumulativeAuthorizedTokens,
    "Phase summary cumulativeAuthorizedTokens",
  );
  const cumulativeAuthorizedMonetaryCents = integer(
    record.cumulativeAuthorizedMonetaryCents,
    "Phase summary cumulativeAuthorizedMonetaryCents",
  );
  const cumulativeActualTokens = integer(
    record.cumulativeActualTokens,
    "Phase summary cumulativeActualTokens",
  );
  const hasNullTokenAuthorization = reservations.some(
    (reservation) => reservation.authorizedTokens === null,
  );
  if (
    hasNullTokenAuthorization &&
    !reservations.every((reservation) => reservation.authorizedTokens === null)
  ) {
    throw new Error("Phase reservations cannot mix enabled and disabled token authorization.");
  }
  const expectedAuthorizedTokens =
    reservations.length === 0
      ? cumulativeAuthorizedTokens
      : hasNullTokenAuthorization
        ? null
        : reservations.reduce((sum, reservation) => sum + reservation.authorizedTokens!, 0);
  if (
    cumulativeAuthorizedTokens !== expectedAuthorizedTokens ||
    cumulativeAuthorizedMonetaryCents !==
      reservations.reduce(
        (sum, reservation) => sum + reservation.monetaryAuthorizationCeilingCents,
        0,
      ) ||
    cumulativeActualTokens !== attempts.reduce((sum, attempt) => sum + attempt.actualTokenUsage, 0)
  ) {
    throw new Error("Phase summary cumulative accounting must equal its launch records.");
  }
  const failure = record.failure === undefined ? undefined : decodePhaseFailure(record.failure);
  if ((record.state === "blocked") !== (failure !== undefined)) {
    throw new Error("Phase summary failure must be present exactly when blocked.");
  }
  if (failure?.kind === "unresolved-reservation") {
    const reservation = reservations.find(
      (candidate) => candidate.reservationId === failure.reservationId,
    );
    if (reservation?.state !== "reserved") {
      throw new Error("Phase unresolved failure must cite its unresolved reservation.");
    }
  }
  if (failure?.kind === "session-infrastructure-error") {
    const attempt = attemptsById.get(failure.attemptId!);
    if (
      attempt === undefined ||
      attempt.reservationId !== failure.reservationId ||
      attempt.infrastructureClassification !== "session-infrastructure-error" ||
      replacementSources.has(attempt.attemptId)
    ) {
      throw new Error("Phase session failure must cite one unresolved eligible attempt.");
    }
  }
  if (record.state === "ready" && (reservations.length !== 0 || attempts.length !== 0)) {
    throw new Error("Ready phase summary cannot contain launched work.");
  }
  if (record.state === "complete") {
    if (unresolved.length !== 0) {
      throw new Error("Complete phase summary cannot contain an unresolved reservation.");
    }
    for (const cellId of cellIds) {
      const cellAttempts = attempts.filter((attempt) => attempt.cellId === cellId);
      const finalAttempt = cellAttempts.find(
        (attempt) =>
          attempt.infrastructureClassification === "none" &&
          !replacementSources.has(attempt.attemptId),
      );
      if (finalAttempt === undefined) {
        throw new Error("Complete phase summary must resolve every planned cell successfully.");
      }
    }
  }
  return {
    schemaVersion: 2,
    phase,
    state: record.state,
    manifestDigest,
    immutableManifestDigest: digest(
      record.immutableManifestDigest,
      "Phase summary immutableManifestDigest",
    ),
    designDigest: digest(record.designDigest, "Phase summary designDigest"),
    plannedCells,
    adjustments,
    reservations,
    attempts,
    cumulativeAuthorizedTokens,
    cumulativeAuthorizedMonetaryCents,
    cumulativeActualTokens,
    ...(failure === undefined ? {} : { failure }),
  };
}

async function readStoredJson(path: string, name: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} is missing or unreadable: ${detail}`);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} is not valid JSON: ${detail}`);
  }
}

async function publishExclusiveJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await link(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function publishAtomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function designReceiptPath(studyRoot: string): string {
  return join(studyRoot, "design.json");
}

export async function readDesignReceipt(studyRoot: string): Promise<DesignReceipt> {
  const path = designReceiptPath(studyRoot);
  return decodeDesignReceipt(await readStoredJson(path, "Design receipt"));
}

export async function publishDesignReceipt(
  studyRoot: string,
  receipt: DesignReceipt | unknown,
): Promise<void> {
  await publishExclusiveJson(designReceiptPath(studyRoot), decodeDesignReceipt(receipt));
}

export function phaseSummaryPath(studyRoot: string, phase: StudyPhase): string {
  return join(studyRoot, phase, "phase.json");
}

export async function readPhaseSummary(
  studyRoot: string,
  phase: StudyPhase,
): Promise<PhaseSummary> {
  const path = phaseSummaryPath(studyRoot, phase);
  const summary = decodePhaseSummary(await readStoredJson(path, `${phase} phase summary`));
  if (summary.phase !== phase) {
    throw new Error(`${phase} phase summary contains phase ${summary.phase}.`);
  }
  return summary;
}

export async function publishPhaseSummary(
  studyRoot: string,
  summary: PhaseSummary | unknown,
): Promise<void> {
  const decoded = decodePhaseSummary(summary);
  await publishAtomicJson(phaseSummaryPath(studyRoot, decoded.phase), decoded);
}

const SCAN_FIELDS = [
  "reachableObjectCount",
  "reachableBlobReferenceCount",
  "uniqueReachableBlobCount",
  "uniqueTextBlobCount",
  "repeatedTreeReferenceCount",
  "skippedNonTextBlobCount",
] as const;

function decodeScan(value: unknown): GitOverlapScan {
  const record = object(value, "Overlap scan");
  const keys = Object.keys(record).sort();
  const expectedKeys = [...SCAN_FIELDS].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("Overlap scan must contain exactly the six declared counters.");
  }
  return {
    reachableObjectCount: integer(record.reachableObjectCount, "Overlap reachableObjectCount"),
    reachableBlobReferenceCount: integer(
      record.reachableBlobReferenceCount,
      "Overlap reachableBlobReferenceCount",
    ),
    uniqueReachableBlobCount: integer(
      record.uniqueReachableBlobCount,
      "Overlap uniqueReachableBlobCount",
    ),
    uniqueTextBlobCount: integer(record.uniqueTextBlobCount, "Overlap uniqueTextBlobCount"),
    repeatedTreeReferenceCount: integer(
      record.repeatedTreeReferenceCount,
      "Overlap repeatedTreeReferenceCount",
    ),
    skippedNonTextBlobCount: integer(
      record.skippedNonTextBlobCount,
      "Overlap skippedNonTextBlobCount",
    ),
  };
}

export function decodeOverlapResult(value: unknown): OverlapResult {
  const record = object(value, "Overlap result");
  if (!Array.isArray(record.findings)) throw new Error("Overlap findings must be an array.");
  const findings = record.findings.map((rawFinding, index): OverlapFinding => {
    const finding = object(rawFinding, `Overlap finding ${String(index + 1)}`);
    if (finding.sourceKind !== "private-ciphertext" && finding.sourceKind !== "plaintext") {
      throw new Error("Overlap finding sourceKind is unsupported.");
    }
    if (finding.matchKind !== "exact" && finding.matchKind !== "normalized") {
      throw new Error("Overlap finding matchKind is unsupported.");
    }
    return {
      committedPath: safeRelativePath(
        finding.committedPath,
        `Overlap finding ${String(index + 1)} committedPath`,
      ),
      committedBlobId: gitObjectId(
        finding.committedBlobId,
        `Overlap finding ${String(index + 1)} committedBlobId`,
      ),
      sourceKind: finding.sourceKind,
      sourceId: nonEmptyString(finding.sourceId, `Overlap finding ${String(index + 1)} sourceId`),
      matchKind: finding.matchKind,
      wordCount: integer(finding.wordCount, `Overlap finding ${String(index + 1)} wordCount`, 32),
      sha256: digest(finding.sha256, `Overlap finding ${String(index + 1)} sha256`),
    };
  });
  const keys = findings.map(
    (finding) =>
      `${finding.committedPath}\0${finding.committedBlobId}\0${finding.sourceKind}\0${finding.sourceId}\0${finding.matchKind}`,
  );
  if (keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) {
    throw new Error("Overlap findings must be unique and deterministically sorted.");
  }
  return { findings, scan: decodeScan(record.scan) };
}

function decodeSelection(value: unknown): EvaluationSelection {
  const record = object(value, "Evaluation selection");
  const notes =
    record.notes === undefined
      ? undefined
      : nonEmptyString(record.notes, "Evaluation selection notes");
  const repositoryId: EvaluationSelection["repositoryId"] =
    record.repositoryId === "shared"
      ? "shared"
      : agentId(record.repositoryId, "Evaluation selection repositoryId");
  const commit = gitObjectId(record.commit, "Evaluation selection commit");
  if (commit.length !== 40) {
    throw new Error("Evaluation selection commit must be a 40-character Git object ID.");
  }
  if (record.ref !== "refs/heads/main") {
    throw new Error("Evaluation selection ref must be refs/heads/main.");
  }
  const selection = {
    workspace: agentId(record.workspace, "Evaluation selection workspace"),
    repositoryId,
    ref: "refs/heads/main" as const,
    commit,
    command: nonEmptyString(record.command, "Evaluation selection command"),
    outputPath: safeRelativePath(record.outputPath, "Evaluation selection outputPath"),
  };
  return notes === undefined ? selection : { ...selection, notes };
}

function decodeExecution(value: unknown): SandboxCommandResult {
  const record = object(value, "Evaluation execution");
  const exitCode =
    record.exitCode === null ? null : integer(record.exitCode, "Evaluation execution exitCode");
  if (typeof record.timedOut !== "boolean" || typeof record.outputExceeded !== "boolean") {
    throw new Error("Evaluation execution flags must be booleans.");
  }
  const outputFailure =
    record.outputFailure === undefined
      ? undefined
      : nonEmptyString(record.outputFailure, "Evaluation execution outputFailure");
  return {
    exitCode,
    stdout:
      typeof record.stdout === "string"
        ? record.stdout
        : nonEmptyString(record.stdout, "Evaluation execution stdout"),
    stderr:
      typeof record.stderr === "string"
        ? record.stderr
        : nonEmptyString(record.stderr, "Evaluation execution stderr"),
    timedOut: record.timedOut,
    outputExceeded: record.outputExceeded,
    ...(outputFailure === undefined ? {} : { outputFailure }),
  };
}

export function decodeAggregateScore(value: unknown): AggregateScore {
  const record = object(value, "Evaluation score");
  const totalWords = integer(record.totalWords, "Evaluation score totalWords");
  const matchedWords = integer(record.matchedWords, "Evaluation score matchedWords");
  if (matchedWords > totalWords) {
    throw new Error("Evaluation score matchedWords cannot exceed totalWords.");
  }
  return {
    matchedWords,
    totalWords,
    coverage: finiteNumber(record.coverage, "Evaluation score coverage", 0, 1),
    accuracy: finiteNumber(record.accuracy, "Evaluation score accuracy", 0, 1),
  };
}

function executionSucceeded(execution: SandboxCommandResult): boolean {
  return (
    execution.exitCode === 0 &&
    !execution.timedOut &&
    !execution.outputExceeded &&
    execution.outputFailure === undefined
  );
}

export function decodeEvaluationRecord(value: unknown): EvaluationResult {
  const record = object(value, "Evaluation result");
  const status = evaluationStatus(record.status);
  const selection = record.selection === undefined ? undefined : decodeSelection(record.selection);
  const execution = record.execution === undefined ? undefined : decodeExecution(record.execution);
  const outputPath =
    record.outputPath === undefined
      ? undefined
      : absolutePath(record.outputPath, "Evaluation outputPath");
  const score = record.score === undefined ? undefined : decodeAggregateScore(record.score);
  const error =
    record.error === undefined ? undefined : nonEmptyString(record.error, "Evaluation error");

  if (
    status === "scored" &&
    (selection === undefined ||
      execution === undefined ||
      outputPath === undefined ||
      score === undefined ||
      error !== undefined ||
      !executionSucceeded(execution))
  ) {
    throw new Error(
      "Scored evaluation results require selection, successful execution, output, and score.",
    );
  }
  if (
    status === "not-runnable" &&
    (selection !== undefined ||
      execution !== undefined ||
      outputPath !== undefined ||
      score !== undefined ||
      error !== undefined)
  ) {
    throw new Error("Not-runnable evaluation results cannot contain evaluation context.");
  }
  if (
    status === "no-output" &&
    (selection === undefined ||
      execution === undefined ||
      outputPath === undefined ||
      score !== undefined ||
      error !== undefined ||
      !executionSucceeded(execution))
  ) {
    throw new Error(
      "No-output evaluation results require selection, successful execution, and outputPath.",
    );
  }
  if (
    status === "execution-error" &&
    (selection === undefined || error === undefined || score !== undefined)
  ) {
    throw new Error(
      "Execution-error evaluation results require selection and error without score.",
    );
  }

  return {
    status,
    ...(selection === undefined ? {} : { selection }),
    ...(execution === undefined ? {} : { execution }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(score === undefined ? {} : { score }),
    ...(error === undefined ? {} : { error }),
  };
}
