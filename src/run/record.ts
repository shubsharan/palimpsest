import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";

import { contentDigest } from "../canonical.js";
import type { ResolvedRun } from "../experiment/contracts.js";
import type { FrozenGitEnvironment, GitRepositoryId } from "../git.js";
import {
  isAgentId,
  type AgentId,
  type AgentSessionResult,
  type JsonObject,
  type JsonValue,
  type ModelBinding,
  type ModelSettings,
} from "../model/contracts.js";
import type { SandboxIdentity } from "../sandbox/contracts.js";
import type { TreeSeal } from "../seal.js";
import { JsonlObservationLog } from "../trace.js";

const DIGEST = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;

export type ResolvedRunRecord = Readonly<Omit<ResolvedRun, "fixture">> & {
  readonly fixture: Readonly<
    Pick<ResolvedRun["fixture"], "packagePath" | "variant" | "source" | "rekeyAtStage"> & {
      id: string;
      digest: string;
    }
  >;
};

export interface RunValidationSnapshot {
  readonly manifestPath: string;
  readonly manifestDigest: string;
  readonly fixture: {
    readonly packagePath: string;
    readonly fixtureId: string;
    readonly contentDigest: string;
  };
  readonly sandbox: SandboxIdentity;
  readonly smoke: {
    readonly sourceRunId: string;
    readonly runId: string;
    readonly fixtureId: string;
    readonly variantId: string;
    readonly fixtureDigest: string;
    readonly agentIds: readonly AgentId[];
    readonly stageCount: number;
  };
  readonly validatedAt: string;
  readonly spendAuthorized: boolean;
}

export interface RunConfiguration {
  readonly digest: string;
  readonly manifestPath: string;
  readonly manifestDigest: string;
  readonly run: ResolvedRunRecord;
  readonly models: readonly { readonly agentId: AgentId; readonly binding: ModelBinding }[];
  readonly validation: RunValidationSnapshot;
}

export type RunConfigurationInput = Omit<RunConfiguration, "digest">;

export interface RunRelease {
  readonly agentId: AgentId;
  readonly ordinal: number;
  readonly variantId: string;
  readonly releasedAt: string;
  readonly visiblePath: string;
  readonly sha256: string;
}

export interface FrozenOrigin {
  readonly originId: GitRepositoryId;
  readonly path: string;
  readonly agentIds: readonly AgentId[];
  readonly mainCommit: string | null;
}

export interface FrozenWorkspace {
  readonly agentId: AgentId;
  readonly path: string;
  readonly originId: GitRepositoryId;
}

export interface RunTopology {
  readonly root: string;
  readonly communicationMode: "shared" | "isolated";
  readonly origins: readonly FrozenOrigin[];
  readonly workspaces: readonly FrozenWorkspace[];
  readonly treeSeal: TreeSeal;
}

export interface RunEvaluation {
  readonly originId: GitRepositoryId;
  readonly agentIds: readonly AgentId[];
  readonly status: "scored" | "not-runnable" | "no-output" | "execution-error";
  readonly commit?: string;
  readonly outputPath?: string;
  readonly score?: {
    readonly matchedWords: number;
    readonly totalWords: number;
    readonly coverage: number;
    readonly accuracy: number;
  };
  readonly error?: string;
}

export interface RunEvaluationBatch {
  readonly evaluationId: string;
  readonly kind: "automatic" | "review";
  readonly evaluatedAt: string;
  readonly results: readonly RunEvaluation[];
}

export interface OverlapScanMetadata {
  readonly reachableObjectCount: number;
  readonly reachableBlobReferenceCount: number;
  readonly uniqueReachableBlobCount: number;
  readonly uniqueTextBlobCount: number;
  readonly repeatedTreeReferenceCount: number;
  readonly skippedNonTextBlobCount: number;
}

export interface OverlapFinding {
  readonly committedPath: string;
  readonly committedBlobId: string;
  readonly sourceKind: "private-ciphertext" | "plaintext";
  readonly sourceId: string;
  readonly matchKind: "exact" | "normalized";
  readonly wordCount: number;
  readonly sha256: string;
}

export interface OriginOverlapAnalysis {
  readonly originId: GitRepositoryId;
  readonly scan: OverlapScanMetadata;
  readonly findings: readonly OverlapFinding[];
}

export interface RunAnalysis {
  readonly analysisId: string;
  readonly kind: "overlap";
  readonly analyzedAt: string;
  readonly minimumWords: number;
  readonly origins: readonly OriginOverlapAnalysis[];
}

export interface SessionInfrastructureFailure {
  readonly agentId: AgentId;
  readonly component: string;
  readonly message: string;
}

export interface RunRecord {
  readonly schemaVersion: 1;
  readonly manifestDigest: string;
  readonly runId: string;
  readonly status: "completed" | "infrastructure-error";
  readonly startedAt: string;
  readonly frozenAt: string;
  readonly publishedAt: string;
  readonly configuration: RunConfiguration;
  readonly trace: { readonly path: "trace.jsonl"; readonly metadataPath: "trace.meta.json" };
  readonly releases: readonly RunRelease[];
  readonly sessions: readonly AgentSessionResult[];
  readonly topology: RunTopology;
  readonly evaluations: readonly RunEvaluationBatch[];
  readonly analyses: readonly RunAnalysis[];
  readonly sessionInfrastructureFailures: readonly SessionInfrastructureFailure[];
}

export interface LoadedRunRecord {
  readonly record: RunRecord;
  readonly fixtureRoot: string;
  readonly topology: FrozenGitEnvironment;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  name: string,
): Record<string, unknown> {
  const decoded = object(value, name);
  const actual = Object.keys(decoded).sort();
  const expected = [...keys].sort();
  if (actual.join("\0") !== expected.join("\0")) {
    throw new Error(`${name} contains unknown or missing fields.`);
  }
  return decoded;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function digest(value: unknown, name: string): string {
  const decoded = text(value, name);
  if (!DIGEST.test(decoded)) throw new Error(`${name} must be a lowercase SHA-256 digest.`);
  return decoded;
}

function timestamp(value: unknown, name: string): string {
  const decoded = text(value, name);
  const date = new Date(decoded);
  if (!decoded.endsWith("Z") || Number.isNaN(date.valueOf()) || date.toISOString() !== decoded) {
    throw new Error(`${name} must be a canonical UTC timestamp.`);
  }
  return decoded;
}

function integer(value: unknown, minimum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${name} must be a safe integer of at least ${String(minimum)}.`);
  }
  return value as number;
}

function ratio(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number between zero and one.`);
  }
  return value;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return value;
}

function relativePath(value: unknown, name: string): string {
  const decoded = text(value, name);
  if (
    isAbsolute(decoded) ||
    win32.isAbsolute(decoded) ||
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    decoded.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${name} must be a safe relative path.`);
  }
  return decoded;
}

function optionalFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  name: string,
): Record<string, unknown> {
  const decoded = object(value, name);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in decoded)) ||
    Object.keys(decoded).some((key) => !allowed.has(key))
  ) {
    throw new Error(`${name} contains unknown or missing fields.`);
  }
  return decoded;
}

function jsonValue(value: unknown, name: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${name} must contain finite JSON numbers.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${name}[${index}]`));
  const decoded = object(value, name);
  return Object.fromEntries(
    Object.entries(decoded).map(([key, item]) => [key, jsonValue(item, `${name}.${key}`)]),
  );
}

function jsonObject(value: unknown, name: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object.`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${name}.${key}`)]),
  );
}

function agentId(value: unknown, name: string): AgentId {
  if (!isAgentId(value)) throw new Error(`${name} must be a canonical agent ID.`);
  return value;
}

function agentIds(value: unknown, name: string): readonly AgentId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} must be non-empty.`);
  const decoded = value.map((item, index) => agentId(item, `${name}[${String(index)}]`));
  if (new Set(decoded).size !== decoded.length) throw new Error(`${name} must contain unique IDs.`);
  return decoded;
}

function modelBinding(value: unknown, name: string): ModelBinding {
  const decoded = optionalFields(
    value,
    ["profile", "provider", "driver", "requestedModel", "settings", "providerOptions"],
    ["actualProvider", "actualModel"],
    name,
  );
  const driver = decoded.driver;
  if (
    driver !== "openai" &&
    driver !== "anthropic" &&
    driver !== "google" &&
    driver !== "openai-compatible"
  ) {
    throw new Error(`${name}.driver is invalid.`);
  }
  const optionalText = (key: "actualProvider" | "actualModel") =>
    decoded[key] === undefined ? {} : { [key]: text(decoded[key], `${name}.${key}`) };
  const settingsValue = optionalFields(
    decoded.settings,
    [],
    ["maxOutputTokens", "temperature", "topP", "seed"],
    `${name}.settings`,
  );
  const settings: ModelSettings = {
    ...(settingsValue.maxOutputTokens === undefined
      ? {}
      : {
          maxOutputTokens: integer(
            settingsValue.maxOutputTokens,
            1,
            `${name}.settings.maxOutputTokens`,
          ),
        }),
    ...(settingsValue.temperature === undefined
      ? {}
      : {
          temperature: finiteNumber(settingsValue.temperature, `${name}.settings.temperature`),
        }),
    ...(settingsValue.topP === undefined
      ? {}
      : { topP: finiteNumber(settingsValue.topP, `${name}.settings.topP`) }),
    ...(settingsValue.seed === undefined
      ? {}
      : { seed: integer(settingsValue.seed, Number.MIN_SAFE_INTEGER, `${name}.settings.seed`) }),
  };
  return {
    profile: text(decoded.profile, `${name}.profile`),
    provider: text(decoded.provider, `${name}.provider`),
    driver,
    requestedModel: text(decoded.requestedModel, `${name}.requestedModel`),
    settings,
    providerOptions: jsonObject(decoded.providerOptions, `${name}.providerOptions`),
    ...optionalText("actualProvider"),
    ...optionalText("actualModel"),
  };
}

function sandboxIdentity(value: unknown, name: string): SandboxIdentity {
  const decoded = exactObject(
    value,
    ["imageTag", "imageId", "sourceDigest", "profileVersion"],
    name,
  );
  const imageId = text(decoded.imageId, `${name}.imageId`);
  if (!IMAGE_ID.test(imageId)) throw new Error(`${name}.imageId is invalid.`);
  if (decoded.profileVersion !== 1) throw new Error(`${name}.profileVersion is unsupported.`);
  return {
    imageTag: text(decoded.imageTag, `${name}.imageTag`),
    imageId,
    sourceDigest: digest(decoded.sourceDigest, `${name}.sourceDigest`),
    profileVersion: 1,
  };
}

function treeSeal(value: unknown, name: string): TreeSeal {
  const decoded = exactObject(value, ["schemaVersion", "digest", "fileCount", "byteCount"], name);
  if (decoded.schemaVersion !== 1) throw new Error(`${name}.schemaVersion is unsupported.`);
  return {
    schemaVersion: 1,
    digest: digest(decoded.digest, `${name}.digest`),
    fileCount: integer(decoded.fileCount, 0, `${name}.fileCount`),
    byteCount: integer(decoded.byteCount, 0, `${name}.byteCount`),
  };
}

function resolvedRun(value: unknown): ResolvedRunRecord {
  const decoded = exactObject(
    value,
    ["id", "fixture", "assignment", "capabilities", "schedule", "limits", "labels"],
    "Run configuration",
  );
  const fixture = object(decoded.fixture, "Run fixture");
  const allowedFixtureFields = new Set([
    "id",
    "packagePath",
    "digest",
    "variant",
    "source",
    "rekeyAtStage",
  ]);
  const unknownFixtureField = Object.keys(fixture).find((key) => !allowedFixtureFields.has(key));
  if (unknownFixtureField !== undefined) {
    throw new Error(`Run fixture contains unknown field ${unknownFixtureField}.`);
  }
  const assignmentValue = object(decoded.assignment, "Run assignment");
  const assignmentEntries = Object.entries(assignmentValue);
  if (assignmentEntries.length === 0) throw new Error("Run assignment must be non-empty.");
  const assignment = Object.fromEntries(
    assignmentEntries.map(([key, value]) => [
      agentId(key, `Run assignment key ${key}`),
      text(value, `Run assignment ${key}`),
    ]),
  ) as Record<AgentId, string>;
  const capabilities = exactObject(decoded.capabilities, ["git", "teamRoom"], "Run capabilities");
  if (capabilities.git !== "shared" && capabilities.git !== "isolated") {
    throw new Error("Run capabilities.git is invalid.");
  }
  if (capabilities.teamRoom !== "enabled" && capabilities.teamRoom !== "disabled") {
    throw new Error("Run capabilities.teamRoom is invalid.");
  }
  if (capabilities.git === "isolated" && capabilities.teamRoom === "enabled") {
    throw new Error("An isolated run cannot expose a shared team room.");
  }
  const schedule = exactObject(decoded.schedule, ["releaseOffsetsMs", "cutoffMs"], "Run schedule");
  if (!Array.isArray(schedule.releaseOffsetsMs) || schedule.releaseOffsetsMs.length === 0) {
    throw new Error("Run release offsets must be non-empty.");
  }
  const releaseOffsetsMs = schedule.releaseOffsetsMs.map((item, index) =>
    integer(item, 0, `Run release offset ${String(index + 1)}`),
  );
  if (
    releaseOffsetsMs[0] !== 0 ||
    releaseOffsetsMs.some((item, index) => index > 0 && item <= releaseOffsetsMs[index - 1]!)
  ) {
    throw new Error("Run release offsets must begin at zero and increase strictly.");
  }
  const cutoffMs = integer(schedule.cutoffMs, 1, "Run cutoff");
  if (cutoffMs <= releaseOffsetsMs.at(-1)!)
    throw new Error("Run cutoff must follow the final release.");
  const limits = exactObject(
    decoded.limits,
    ["tokenLimitPerAgent", "spendCeilingCents"],
    "Run limits",
  );
  const tokenLimitPerAgent =
    limits.tokenLimitPerAgent === null
      ? null
      : integer(limits.tokenLimitPerAgent, 1, "Run token limit");
  return {
    id: text(decoded.id, "Run id"),
    fixture: {
      id: text(fixture.id, "Run fixture id"),
      packagePath: relativePath(fixture.packagePath, "Run fixture packagePath"),
      digest: digest(fixture.digest, "Run fixture digest"),
      variant: text(fixture.variant, "Run fixture variant"),
      ...(fixture.source === undefined
        ? {}
        : { source: relativePath(fixture.source, "Run fixture source") }),
      ...(fixture.rekeyAtStage === undefined
        ? {}
        : {
            rekeyAtStage:
              fixture.rekeyAtStage === null
                ? null
                : integer(fixture.rekeyAtStage, 2, "Run fixture rekeyAtStage"),
          }),
    },
    assignment,
    capabilities: { git: capabilities.git, teamRoom: capabilities.teamRoom },
    schedule: { releaseOffsetsMs, cutoffMs },
    limits: {
      tokenLimitPerAgent,
      spendCeilingCents: integer(limits.spendCeilingCents, 0, "Run spend ceiling"),
    },
    labels: jsonObject(decoded.labels, "Run labels"),
  };
}

function validationSnapshot(value: unknown): RunValidationSnapshot {
  const decoded = exactObject(
    value,
    [
      "manifestPath",
      "manifestDigest",
      "fixture",
      "sandbox",
      "smoke",
      "validatedAt",
      "spendAuthorized",
    ],
    "Validation snapshot",
  );
  const fixture = exactObject(
    decoded.fixture,
    ["packagePath", "fixtureId", "contentDigest"],
    "Validation fixture",
  );
  const smoke = exactObject(
    decoded.smoke,
    ["sourceRunId", "runId", "fixtureId", "variantId", "fixtureDigest", "agentIds", "stageCount"],
    "Validation smoke",
  );
  if (typeof decoded.spendAuthorized !== "boolean")
    throw new Error("Validation spendAuthorized must be boolean.");
  return {
    manifestPath: relativePath(decoded.manifestPath, "Validation manifestPath"),
    manifestDigest: digest(decoded.manifestDigest, "Validation manifestDigest"),
    fixture: {
      packagePath: relativePath(fixture.packagePath, "Validation fixture packagePath"),
      fixtureId: text(fixture.fixtureId, "Validation fixture fixtureId"),
      contentDigest: digest(fixture.contentDigest, "Validation fixture contentDigest"),
    },
    sandbox: sandboxIdentity(decoded.sandbox, "Validation sandbox"),
    smoke: {
      sourceRunId: text(smoke.sourceRunId, "Validation smoke sourceRunId"),
      runId: text(smoke.runId, "Validation smoke runId"),
      fixtureId: text(smoke.fixtureId, "Validation smoke fixtureId"),
      variantId: text(smoke.variantId, "Validation smoke variantId"),
      fixtureDigest: digest(smoke.fixtureDigest, "Validation smoke fixtureDigest"),
      agentIds: agentIds(smoke.agentIds, "Validation smoke agentIds"),
      stageCount: integer(smoke.stageCount, 1, "Validation smoke stageCount"),
    },
    validatedAt: timestamp(decoded.validatedAt, "Validation validatedAt"),
    spendAuthorized: decoded.spendAuthorized,
  };
}

function configuration(value: unknown): RunConfiguration {
  const decoded = exactObject(
    value,
    ["digest", "manifestPath", "manifestDigest", "run", "models", "validation"],
    "Resolved configuration",
  );
  const run = resolvedRun(decoded.run);
  if (!Array.isArray(decoded.models))
    throw new Error("Resolved configuration models must be an array.");
  const models = decoded.models.map((item, index) => {
    const model = exactObject(item, ["agentId", "binding"], `Resolved model ${String(index + 1)}`);
    return {
      agentId: agentId(model.agentId, `Resolved model ${String(index + 1)} agentId`),
      binding: modelBinding(model.binding, `Resolved model ${String(index + 1)} binding`),
    };
  });
  const validation = validationSnapshot(decoded.validation);
  const result = {
    digest: digest(decoded.digest, "Resolved configuration digest"),
    manifestPath: relativePath(decoded.manifestPath, "Resolved configuration manifestPath"),
    manifestDigest: digest(decoded.manifestDigest, "Resolved configuration manifestDigest"),
    run,
    models,
    validation,
  };
  const calculated = configurationDigest(result);
  if (result.digest !== calculated)
    throw new Error("Resolved configuration digest does not match its content.");
  return result;
}

function session(value: unknown, name: string): AgentSessionResult {
  const decoded = optionalFields(
    value,
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
    name,
  );
  const state = decoded.state;
  if (
    state !== "working" &&
    state !== "waiting" &&
    state !== "finished" &&
    state !== "token-exhausted" &&
    state !== "time-exhausted" &&
    state !== "infrastructure-error"
  ) {
    throw new Error(`${name}.state is invalid.`);
  }
  const finalResponse =
    decoded.finalResponse === undefined
      ? {}
      : { finalResponse: text(decoded.finalResponse, `${name}.finalResponse`) };
  return {
    agentId: agentId(decoded.agentId, `${name}.agentId`),
    model: modelBinding(decoded.model, `${name}.model`),
    state,
    inputTokens: integer(decoded.inputTokens, 0, `${name}.inputTokens`),
    outputTokens: integer(decoded.outputTokens, 0, `${name}.outputTokens`),
    activityCursor: integer(decoded.activityCursor, 0, `${name}.activityCursor`),
    terminationReason: text(decoded.terminationReason, `${name}.terminationReason`),
    ...finalResponse,
  };
}

function topology(value: unknown): RunTopology {
  const decoded = exactObject(
    value,
    ["root", "communicationMode", "origins", "workspaces", "treeSeal"],
    "Run topology",
  );
  if (decoded.communicationMode !== "shared" && decoded.communicationMode !== "isolated")
    throw new Error("Run topology communicationMode is invalid.");
  if (!Array.isArray(decoded.origins) || !Array.isArray(decoded.workspaces))
    throw new Error("Run topology origins and workspaces must be arrays.");
  const origins = decoded.origins.map((item, index): FrozenOrigin => {
    const origin = exactObject(
      item,
      ["originId", "path", "agentIds", "mainCommit"],
      `Run origin ${String(index + 1)}`,
    );
    const originId =
      origin.originId === "shared"
        ? "shared"
        : agentId(origin.originId, `Run origin ${String(index + 1)} originId`);
    const mainCommit =
      origin.mainCommit === null
        ? null
        : text(origin.mainCommit, `Run origin ${String(index + 1)} mainCommit`);
    if (mainCommit !== null && !/^[0-9a-f]{40,64}$/.test(mainCommit))
      throw new Error(`Run origin ${String(index + 1)} mainCommit is invalid.`);
    return {
      originId,
      path: relativePath(origin.path, `Run origin ${String(index + 1)} path`),
      agentIds: agentIds(origin.agentIds, `Run origin ${String(index + 1)} agentIds`),
      mainCommit,
    };
  });
  const workspaces = decoded.workspaces.map((item, index): FrozenWorkspace => {
    const workspace = exactObject(
      item,
      ["agentId", "path", "originId"],
      `Run workspace ${String(index + 1)}`,
    );
    return {
      agentId: agentId(workspace.agentId, `Run workspace ${String(index + 1)} agentId`),
      path: relativePath(workspace.path, `Run workspace ${String(index + 1)} path`),
      originId:
        workspace.originId === "shared"
          ? "shared"
          : agentId(workspace.originId, `Run workspace ${String(index + 1)} originId`),
    };
  });
  return {
    root: relativePath(decoded.root, "Run topology root"),
    communicationMode: decoded.communicationMode,
    origins,
    workspaces,
    treeSeal: treeSeal(decoded.treeSeal, "Run topology treeSeal"),
  };
}

function evaluation(value: unknown, name: string): RunEvaluation {
  const decoded = optionalFields(
    value,
    ["originId", "agentIds", "status"],
    ["commit", "outputPath", "score", "error"],
    name,
  );
  const originId =
    decoded.originId === "shared" ? "shared" : agentId(decoded.originId, `${name}.originId`);
  const status = decoded.status;
  if (
    status !== "scored" &&
    status !== "not-runnable" &&
    status !== "no-output" &&
    status !== "execution-error"
  )
    throw new Error(`${name}.status is invalid.`);
  const commit =
    decoded.commit === undefined ? {} : { commit: text(decoded.commit, `${name}.commit`) };
  if ("commit" in commit && !/^[0-9a-f]{40,64}$/.test(commit.commit))
    throw new Error(`${name}.commit is invalid.`);
  const outputPath =
    decoded.outputPath === undefined
      ? {}
      : { outputPath: relativePath(decoded.outputPath, `${name}.outputPath`) };
  let score: RunEvaluation["score"];
  if (decoded.score !== undefined) {
    const scoreValue = exactObject(
      decoded.score,
      ["matchedWords", "totalWords", "coverage", "accuracy"],
      `${name}.score`,
    );
    score = {
      matchedWords: integer(scoreValue.matchedWords, 0, `${name}.score.matchedWords`),
      totalWords: integer(scoreValue.totalWords, 0, `${name}.score.totalWords`),
      coverage: ratio(scoreValue.coverage, `${name}.score.coverage`),
      accuracy: ratio(scoreValue.accuracy, `${name}.score.accuracy`),
    };
    if (score.matchedWords > score.totalWords)
      throw new Error(`${name}.score matchedWords exceeds totalWords.`);
  }
  if ((status === "scored") !== (score !== undefined))
    throw new Error(`${name} score must exist exactly for scored results.`);
  const error = decoded.error === undefined ? {} : { error: text(decoded.error, `${name}.error`) };
  if ((status === "execution-error" || status === "not-runnable") !== "error" in error)
    throw new Error(`${name} error is inconsistent with its status.`);
  return {
    originId,
    agentIds: agentIds(decoded.agentIds, `${name}.agentIds`),
    status,
    ...commit,
    ...outputPath,
    ...(score === undefined ? {} : { score }),
    ...error,
  };
}

function evaluationBatch(value: unknown, index: number): RunEvaluationBatch {
  const name = `Evaluation batch ${String(index + 1)}`;
  const decoded = exactObject(value, ["evaluationId", "kind", "evaluatedAt", "results"], name);
  if (decoded.kind !== "automatic" && decoded.kind !== "review")
    throw new Error(`${name}.kind is invalid.`);
  if (!Array.isArray(decoded.results) || decoded.results.length === 0)
    throw new Error(`${name}.results must be non-empty.`);
  return {
    evaluationId: text(decoded.evaluationId, `${name}.evaluationId`),
    kind: decoded.kind,
    evaluatedAt: timestamp(decoded.evaluatedAt, `${name}.evaluatedAt`),
    results: decoded.results.map((item, resultIndex) =>
      evaluation(item, `${name} result ${String(resultIndex + 1)}`),
    ),
  };
}

const SCAN_FIELDS = [
  "reachableObjectCount",
  "reachableBlobReferenceCount",
  "uniqueReachableBlobCount",
  "uniqueTextBlobCount",
  "repeatedTreeReferenceCount",
  "skippedNonTextBlobCount",
] as const;

function scan(value: unknown, name: string): OverlapScanMetadata {
  const decoded = exactObject(value, SCAN_FIELDS, name);
  return Object.fromEntries(
    SCAN_FIELDS.map((field) => [field, integer(decoded[field], 0, `${name}.${field}`)]),
  ) as unknown as OverlapScanMetadata;
}

function finding(value: unknown, name: string): OverlapFinding {
  const decoded = exactObject(
    value,
    [
      "committedPath",
      "committedBlobId",
      "sourceKind",
      "sourceId",
      "matchKind",
      "wordCount",
      "sha256",
    ],
    name,
  );
  if (decoded.sourceKind !== "private-ciphertext" && decoded.sourceKind !== "plaintext")
    throw new Error(`${name}.sourceKind is invalid.`);
  if (decoded.matchKind !== "exact" && decoded.matchKind !== "normalized")
    throw new Error(`${name}.matchKind is invalid.`);
  const blob = text(decoded.committedBlobId, `${name}.committedBlobId`);
  if (!/^[0-9a-f]{40,64}$/.test(blob)) throw new Error(`${name}.committedBlobId is invalid.`);
  return {
    committedPath: text(decoded.committedPath, `${name}.committedPath`),
    committedBlobId: blob,
    sourceKind: decoded.sourceKind,
    sourceId: text(decoded.sourceId, `${name}.sourceId`),
    matchKind: decoded.matchKind,
    wordCount: integer(decoded.wordCount, 1, `${name}.wordCount`),
    sha256: digest(decoded.sha256, `${name}.sha256`),
  };
}

function analysis(value: unknown, index: number): RunAnalysis {
  const name = `Analysis ${String(index + 1)}`;
  const decoded = exactObject(
    value,
    ["analysisId", "kind", "analyzedAt", "minimumWords", "origins"],
    name,
  );
  if (decoded.kind !== "overlap") throw new Error(`${name}.kind is unsupported.`);
  if (!Array.isArray(decoded.origins) || decoded.origins.length === 0)
    throw new Error(`${name}.origins must be non-empty.`);
  return {
    analysisId: text(decoded.analysisId, `${name}.analysisId`),
    kind: "overlap",
    analyzedAt: timestamp(decoded.analyzedAt, `${name}.analyzedAt`),
    minimumWords: integer(decoded.minimumWords, 8, `${name}.minimumWords`),
    origins: decoded.origins.map((item, originIndex) => {
      const origin = exactObject(
        item,
        ["originId", "scan", "findings"],
        `${name} origin ${String(originIndex + 1)}`,
      );
      if (!Array.isArray(origin.findings))
        throw new Error(`${name} origin findings must be an array.`);
      return {
        originId:
          origin.originId === "shared" ? "shared" : agentId(origin.originId, `${name} originId`),
        scan: scan(origin.scan, `${name} origin scan`),
        findings: origin.findings.map((item, findingIndex) =>
          finding(item, `${name} finding ${String(findingIndex + 1)}`),
        ),
      };
    }),
  };
}

function release(value: unknown, index: number): RunRelease {
  const name = `Release ${String(index + 1)}`;
  const decoded = exactObject(
    value,
    ["agentId", "ordinal", "variantId", "releasedAt", "visiblePath", "sha256"],
    name,
  );
  return {
    agentId: agentId(decoded.agentId, `${name}.agentId`),
    ordinal: integer(decoded.ordinal, 1, `${name}.ordinal`),
    variantId: text(decoded.variantId, `${name}.variantId`),
    releasedAt: timestamp(decoded.releasedAt, `${name}.releasedAt`),
    visiblePath: relativePath(decoded.visiblePath, `${name}.visiblePath`),
    sha256: digest(decoded.sha256, `${name}.sha256`),
  };
}

function failure(value: unknown, index: number): SessionInfrastructureFailure {
  const name = `Session infrastructure failure ${String(index + 1)}`;
  const decoded = exactObject(value, ["agentId", "component", "message"], name);
  return {
    agentId: agentId(decoded.agentId, `${name}.agentId`),
    component: text(decoded.component, `${name}.component`),
    message: text(decoded.message, `${name}.message`),
  };
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.join("\0") === right.join("\0");
}

function requestedBinding(
  binding: ModelBinding,
): Omit<ModelBinding, "actualProvider" | "actualModel"> {
  return {
    profile: binding.profile,
    provider: binding.provider,
    driver: binding.driver,
    requestedModel: binding.requestedModel,
    settings: binding.settings,
    providerOptions: binding.providerOptions,
  };
}

function validateRelationships(record: RunRecord): void {
  const agents = Object.keys(record.configuration.run.assignment) as AgentId[];
  if (
    record.runId !== record.configuration.run.id ||
    record.manifestDigest !== record.configuration.manifestDigest
  )
    throw new Error("Run record identity differs from its frozen configuration.");
  const validation = record.configuration.validation;
  if (
    validation.manifestPath !== record.configuration.manifestPath ||
    validation.manifestDigest !== record.manifestDigest ||
    validation.fixture.packagePath !== record.configuration.run.fixture.packagePath ||
    validation.fixture.fixtureId !== record.configuration.run.fixture.id ||
    validation.fixture.contentDigest !== record.configuration.run.fixture.digest ||
    !validation.spendAuthorized
  )
    throw new Error("Validation snapshot differs from the resolved run configuration.");
  if (
    validation.smoke.runId !== `${validation.smoke.sourceRunId}-validation` ||
    (validation.smoke.sourceRunId === record.runId &&
      (validation.smoke.fixtureId !== record.configuration.run.fixture.id ||
        validation.smoke.variantId !== record.configuration.run.fixture.variant ||
        validation.smoke.fixtureDigest !== record.configuration.run.fixture.digest ||
        !same(validation.smoke.agentIds, agents) ||
        validation.smoke.stageCount !== record.configuration.run.schedule.releaseOffsetsMs.length))
  ) {
    throw new Error("Validation smoke differs from its source run configuration.");
  }
  if (
    !same(
      record.configuration.models.map(({ agentId }) => agentId),
      agents,
    ) ||
    !same(
      record.sessions.map(({ agentId }) => agentId),
      agents,
    )
  )
    throw new Error("Run models and sessions must match declared agents in order.");
  if (
    record.configuration.models.some(
      ({ agentId, binding }, index) =>
        binding.profile !== record.configuration.run.assignment[agentId] ||
        contentDigest(requestedBinding(binding)) !==
          contentDigest(requestedBinding(record.sessions[index]!.model)),
    )
  ) {
    throw new Error("Run model bindings must match assignments and session requests.");
  }
  const failureAgents = record.sessionInfrastructureFailures.map(({ agentId }) => agentId);
  const failedSessions = record.sessions
    .filter(({ state }) => state === "infrastructure-error")
    .map(({ agentId }) => agentId);
  if (
    !same(failureAgents, failedSessions) ||
    (record.status === "infrastructure-error") !== failureAgents.length > 0
  )
    throw new Error("Run status and session infrastructure failures are inconsistent.");
  if (record.configuration.run.capabilities.git !== record.topology.communicationMode)
    throw new Error("Frozen topology communication mode differs from configuration.");
  const origins = record.topology.origins;
  if (record.topology.communicationMode === "shared") {
    if (
      origins.length !== 1 ||
      origins[0]?.originId !== "shared" ||
      !same(origins[0].agentIds, agents)
    )
      throw new Error("Shared topology must contain one origin for every declared agent.");
  } else if (
    !same(
      origins.map(({ originId }) => originId),
      agents,
    ) ||
    origins.some((origin) => origin.agentIds.length !== 1 || origin.agentIds[0] !== origin.originId)
  ) {
    throw new Error("Isolated topology must contain one origin per declared agent.");
  }
  if (
    !same(
      record.topology.workspaces.map(({ agentId }) => agentId),
      agents,
    ) ||
    record.topology.workspaces.some(
      (workspace) =>
        !origins.some(
          (origin) =>
            origin.originId === workspace.originId && origin.agentIds.includes(workspace.agentId),
        ),
    )
  )
    throw new Error("Frozen workspaces must match declared agents and origins.");
  const topologyPrefix = `${record.topology.root}/`;
  if (
    record.topology.origins.some(({ path }) => !path.startsWith(topologyPrefix)) ||
    record.topology.workspaces.some(({ path }) => !path.startsWith(topologyPrefix))
  )
    throw new Error("Frozen origin and workspace paths must be contained by the topology root.");
  if (
    record.evaluations.length === 0 ||
    record.evaluations[0]?.kind !== "automatic" ||
    record.evaluations.slice(1).some(({ kind }) => kind !== "review")
  )
    throw new Error("Evaluation history must begin with one automatic batch followed by reviews.");
  for (const batch of record.evaluations) {
    if (
      !same(
        batch.results.map(({ originId }) => originId),
        origins.map(({ originId }) => originId),
      ) ||
      batch.results.some((result, index) => !same(result.agentIds, origins[index]!.agentIds))
    )
      throw new Error("Every evaluation batch must cover frozen origins in order.");
  }
  const automatic = record.evaluations[0]!;
  if (
    origins.some(
      ({ mainCommit }, index) => mainCommit !== (automatic.results[index]!.commit ?? null),
    )
  ) {
    throw new Error("Frozen main commits must match the automatic evaluation batch.");
  }
  for (const item of record.analyses) {
    if (
      !same(
        item.origins.map(({ originId }) => originId),
        origins.map(({ originId }) => originId),
      )
    )
      throw new Error("Every analysis must cover frozen origins in order.");
  }
  const releases = new Map<AgentId, number>();
  for (const item of record.releases) {
    if (
      !agents.includes(item.agentId) ||
      item.variantId !== record.configuration.run.fixture.variant ||
      item.ordinal !== (releases.get(item.agentId) ?? 0) + 1
    )
      throw new Error("Release history is inconsistent with the declared agents or variant.");
    releases.set(item.agentId, item.ordinal);
  }
  if (
    agents.some(
      (agent) => releases.get(agent) !== record.configuration.run.schedule.releaseOffsetsMs.length,
    )
  )
    throw new Error("Release history must contain every stage for every agent.");
  if (
    !(
      new Date(record.startedAt).valueOf() <= new Date(record.frozenAt).valueOf() &&
      new Date(record.frozenAt).valueOf() <= new Date(record.publishedAt).valueOf()
    )
  )
    throw new Error("Run record timestamps are out of order.");
}

export function configurationDigest(value: RunConfigurationInput | RunConfiguration): string {
  const { digest: _ignored, ...content } = value as RunConfiguration;
  return contentDigest(content);
}

export function freezeRunConfiguration(value: RunConfigurationInput): RunConfiguration {
  return { digest: configurationDigest(value), ...value };
}

export function decodeRunRecord(value: unknown): RunRecord {
  const decoded = exactObject(
    value,
    [
      "schemaVersion",
      "manifestDigest",
      "runId",
      "status",
      "startedAt",
      "frozenAt",
      "publishedAt",
      "configuration",
      "trace",
      "releases",
      "sessions",
      "topology",
      "evaluations",
      "analyses",
      "sessionInfrastructureFailures",
    ],
    "Run record",
  );
  if (decoded.schemaVersion !== 1) throw new Error("Unsupported run record schema version.");
  if (decoded.status !== "completed" && decoded.status !== "infrastructure-error")
    throw new Error("Run record status is invalid.");
  const trace = exactObject(decoded.trace, ["path", "metadataPath"], "Run record trace");
  if (trace.path !== "trace.jsonl" || trace.metadataPath !== "trace.meta.json")
    throw new Error("Run record trace paths must be trace.jsonl and trace.meta.json.");
  if (
    !Array.isArray(decoded.releases) ||
    !Array.isArray(decoded.sessions) ||
    !Array.isArray(decoded.evaluations) ||
    !Array.isArray(decoded.analyses) ||
    !Array.isArray(decoded.sessionInfrastructureFailures)
  )
    throw new Error("Run record histories must be arrays.");
  const record: RunRecord = {
    schemaVersion: 1,
    manifestDigest: digest(decoded.manifestDigest, "Run record manifestDigest"),
    runId: text(decoded.runId, "Run record runId"),
    status: decoded.status,
    startedAt: timestamp(decoded.startedAt, "Run record startedAt"),
    frozenAt: timestamp(decoded.frozenAt, "Run record frozenAt"),
    publishedAt: timestamp(decoded.publishedAt, "Run record publishedAt"),
    configuration: configuration(decoded.configuration),
    trace: { path: "trace.jsonl", metadataPath: "trace.meta.json" },
    releases: decoded.releases.map(release),
    sessions: decoded.sessions.map((item, index) => session(item, `Session ${String(index + 1)}`)),
    topology: topology(decoded.topology),
    evaluations: decoded.evaluations.map(evaluationBatch),
    analyses: decoded.analyses.map(analysis),
    sessionInfrastructureFailures: decoded.sessionInfrastructureFailures.map(failure),
  };
  validateRelationships(record);
  return record;
}

async function contained(root: string, path: string, name: string): Promise<string> {
  const resolvedRoot = await realpath(resolve(root));
  const candidate = resolve(resolvedRoot, path);
  const lexical = relative(resolvedRoot, candidate);
  if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical))
    throw new Error(`${name} escapes its declared root.`);
  const actual = await realpath(candidate);
  const physical = relative(resolvedRoot, actual);
  if (physical === ".." || physical.startsWith(`..${sep}`) || isAbsolute(physical))
    throw new Error(`${name} resolves outside its declared root.`);
  return actual;
}

export async function loadRunRecord(root: string, runRoot: string): Promise<LoadedRunRecord> {
  const resolvedRunRoot = await realpath(resolve(runRoot));
  const value = JSON.parse(await readFile(join(resolvedRunRoot, "run.json"), "utf8")) as unknown;
  const record = decodeRunRecord(value);
  const fixtureRoot = await contained(
    root,
    record.configuration.run.fixture.packagePath,
    "Run fixture packagePath",
  );
  const topologyRoot = await contained(resolvedRunRoot, record.topology.root, "Run topology root");
  const repositories = await Promise.all(
    record.topology.origins.map(async (origin) => ({
      repositoryId: origin.originId,
      path: await contained(resolvedRunRoot, origin.path, `Run origin ${origin.originId}`),
      agentIds: origin.agentIds,
    })),
  );
  const workspaces = await Promise.all(
    record.topology.workspaces.map(async (workspace) => ({
      agentId: workspace.agentId,
      path: await contained(resolvedRunRoot, workspace.path, `Run workspace ${workspace.agentId}`),
      repositoryId: workspace.originId,
    })),
  );
  return {
    record,
    fixtureRoot,
    topology: {
      frozen: true,
      root: topologyRoot,
      communicationMode: record.topology.communicationMode,
      repositories,
      workspaces,
      treeSeal: record.topology.treeSeal,
    },
  };
}

export async function validateRunRecordTrace(runRoot: string, trace: unknown): Promise<void> {
  const decoded = exactObject(trace, ["path", "metadataPath"], "Run record trace");
  if (decoded.path !== "trace.jsonl" || decoded.metadataPath !== "trace.meta.json")
    throw new Error("Run record trace paths must be trace.jsonl and trace.meta.json.");
  await JsonlObservationLog.open(join(resolve(runRoot), "trace.jsonl"));
}

async function serialized(record: RunRecord): Promise<string> {
  const decoded = decodeRunRecord(record);
  return `${JSON.stringify(decoded, null, 2)}\n`;
}

export async function publishRunRecord(runRoot: string, record: RunRecord): Promise<string> {
  await validateRunRecordTrace(runRoot, record.trace);
  const path = join(resolve(runRoot), "run.json");
  const temporaryPath = join(resolve(runRoot), `.run-${randomUUID()}.tmp`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, await serialized(record), { encoding: "utf8", flag: "wx" });
  try {
    await link(temporaryPath, path);
  } finally {
    await unlink(temporaryPath);
  }
  return path;
}

async function replaceRunRecord(runRoot: string, record: RunRecord): Promise<void> {
  const path = join(resolve(runRoot), "run.json");
  const temporaryPath = join(resolve(runRoot), `.run-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, await serialized(record), { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function appendEvaluationBatch(
  runRoot: string,
  record: RunRecord,
  batch: RunEvaluationBatch,
): Promise<RunRecord> {
  if (batch.kind !== "review")
    throw new Error("Post-publication evaluation batches must be reviews.");
  const updated = decodeRunRecord({ ...record, evaluations: [...record.evaluations, batch] });
  await replaceRunRecord(runRoot, updated);
  return updated;
}

export async function appendRunAnalysis(
  runRoot: string,
  record: RunRecord,
  item: RunAnalysis,
): Promise<RunRecord> {
  const updated = decodeRunRecord({ ...record, analyses: [...record.analyses, item] });
  await replaceRunRecord(runRoot, updated);
  return updated;
}
