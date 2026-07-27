import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, posix, win32 } from "node:path";

import { AGENT_IDS, type AgentId } from "./model.js";
import type { EvaluationResult, EvaluationSelection, EvaluationStatus } from "./evaluate.js";
import {
  SANDBOX_IMAGE_TAG,
  SANDBOX_POLICY,
  type SandboxCommandResult,
  type SandboxIdentity,
} from "./sandbox/contracts.js";
import type { AgentSessionResult, SessionState } from "./session.js";

const SHA256 = /^[0-9a-f]{64}$/;
const BUILD_ID = /^build-[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const STAGE_COUNT = 6;

export interface BuildPuzzleResult {
  buildId: string;
  buildPath: string;
  agentCount: 3;
  stageCount: 6;
  transitionStage: number;
}

export interface BuildStage {
  agentId: AgentId;
  ordinal: number;
  releaseOffsetMs: number;
  sourcePath: string;
  tokenCount: number;
  sha256: string;
  regime: "base" | "revised";
}

export interface BuildManifest {
  schemaVersion: 1;
  buildId: string;
  agentCount: 3;
  stageCount: 6;
  transitionStage: number;
  stageIntervalMs: number;
  changedSymbols: readonly string[];
  publicCiphertextPath: string;
  referenceCorpusPath: string;
  privateStageRoots: Record<AgentId, string>;
  oracleRoot: string;
  stages: readonly BuildStage[];
}

export interface SandboxPolicy {
  network: "none";
  cpus: 2;
  memoryBytes: 2_147_483_648;
  pids: 256;
  tmpfsBytes: 268_435_456;
  maxOutputBytes: 4_194_304;
}

export interface AttemptSummary {
  attemptId: string;
  buildRoot: string;
  tracePath: string;
  traceMetadataPath: string;
  frozenRoot: string;
  sandbox: SandboxIdentity & SandboxPolicy;
  sessions: readonly AgentSessionResult[];
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

function agentId(value: unknown, name: string): AgentId {
  if (value === "agent-1" || value === "agent-2" || value === "agent-3") return value;
  throw new Error(`${name} must identify one declared agent.`);
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
  const record = object(value, "Puzzle build result");
  const agentCount = integer(record.agentCount, "Puzzle build result agentCount");
  const stageCount = integer(record.stageCount, "Puzzle build result stageCount");
  if (agentCount !== AGENT_IDS.length || stageCount !== STAGE_COUNT) {
    throw new Error("Puzzle build result must describe three six-stage agent streams.");
  }
  const transitionStage = integer(record.transitionStage, "Puzzle build result transitionStage", 2);
  if (transitionStage > STAGE_COUNT) {
    throw new Error("Puzzle build result transitionStage must be between 2 and 6.");
  }
  return {
    buildId: decodeBuildId(record.buildId, "Puzzle build result buildId"),
    buildPath: absolutePath(record.buildPath, "Puzzle build result buildPath"),
    agentCount: 3,
    stageCount: 6,
    transitionStage,
  };
}

function decodeAgentPathMap(value: unknown): Record<AgentId, string> {
  const record = object(value, "Puzzle build privateStageRoots");
  const keys = Object.keys(record).sort();
  if (keys.length !== AGENT_IDS.length || keys.some((key, index) => key !== AGENT_IDS[index])) {
    throw new Error("Puzzle build privateStageRoots must contain exactly three agents.");
  }
  return {
    "agent-1": safeRelativePath(record["agent-1"], "agent-1 private stage root"),
    "agent-2": safeRelativePath(record["agent-2"], "agent-2 private stage root"),
    "agent-3": safeRelativePath(record["agent-3"], "agent-3 private stage root"),
  };
}

export function decodeBuildManifest(value: unknown): BuildManifest {
  const record = object(value, "Puzzle build manifest");
  if (record.schemaVersion !== 1) {
    throw new Error("Unsupported puzzle build schema version.");
  }
  const agentCount = integer(record.agentCount, "Puzzle build agentCount");
  const stageCount = integer(record.stageCount, "Puzzle build stageCount");
  if (agentCount !== AGENT_IDS.length || stageCount !== STAGE_COUNT) {
    throw new Error("Puzzle build must describe exactly three agents and six stages.");
  }
  const transitionStage = integer(record.transitionStage, "Puzzle build transitionStage", 2);
  if (transitionStage > STAGE_COUNT) {
    throw new Error("Puzzle build transitionStage must be between 2 and 6.");
  }
  const stageIntervalMs = integer(record.stageIntervalMs, "Puzzle build stageIntervalMs", 1);
  if (!Array.isArray(record.changedSymbols) || record.changedSymbols.length === 0) {
    throw new Error("Puzzle build changedSymbols must be a non-empty array.");
  }
  const changedSymbols = record.changedSymbols.map((symbol, index) =>
    nonEmptyString(symbol, `Puzzle build changedSymbols[${String(index)}]`),
  );
  if (
    new Set(changedSymbols).size !== changedSymbols.length ||
    changedSymbols.some((symbol, index) => index > 0 && changedSymbols[index - 1]! >= symbol)
  ) {
    throw new Error("Puzzle build changedSymbols must be unique and sorted.");
  }
  if (!Array.isArray(record.stages) || record.stages.length !== AGENT_IDS.length * STAGE_COUNT) {
    throw new Error("Puzzle build must contain exactly three six-stage streams.");
  }
  const stages = record.stages.map((rawStage, index): BuildStage => {
    const stage = object(rawStage, `Puzzle build stage ${String(index + 1)}`);
    const expectedAgent = AGENT_IDS[Math.floor(index / STAGE_COUNT)];
    const expectedOrdinal = (index % STAGE_COUNT) + 1;
    const decodedAgent = agentId(stage.agentId, `Puzzle build stage ${String(index + 1)} agentId`);
    const ordinal = integer(stage.ordinal, `Puzzle build stage ${String(index + 1)} ordinal`, 1);
    if (decodedAgent !== expectedAgent || ordinal !== expectedOrdinal) {
      throw new Error("Puzzle build stages must contain six ordered stages per agent.");
    }
    const releaseOffsetMs = integer(
      stage.releaseOffsetMs,
      `Puzzle build ${decodedAgent} stage ${String(ordinal)} releaseOffsetMs`,
    );
    if (releaseOffsetMs !== (ordinal - 1) * stageIntervalMs) {
      throw new Error("Puzzle build stage offsets must follow the configured interval.");
    }
    const expectedRegime = ordinal < transitionStage ? "base" : "revised";
    if (stage.regime !== expectedRegime) {
      throw new Error("Puzzle build stage regime does not match the transition stage.");
    }
    return {
      agentId: decodedAgent,
      ordinal,
      releaseOffsetMs,
      sourcePath: safeRelativePath(
        stage.sourcePath,
        `Puzzle build ${decodedAgent} stage ${String(ordinal)} sourcePath`,
      ),
      tokenCount: integer(
        stage.tokenCount,
        `Puzzle build ${decodedAgent} stage ${String(ordinal)} tokenCount`,
        1,
      ),
      sha256: digest(stage.sha256, `Puzzle build ${decodedAgent} stage ${String(ordinal)} sha256`),
      regime: expectedRegime,
    };
  });
  return {
    schemaVersion: 1,
    buildId: decodeBuildId(record.buildId, "Puzzle build buildId"),
    agentCount: 3,
    stageCount: 6,
    transitionStage,
    stageIntervalMs,
    changedSymbols,
    publicCiphertextPath: safeRelativePath(
      record.publicCiphertextPath,
      "Puzzle build publicCiphertextPath",
    ),
    referenceCorpusPath: safeRelativePath(
      record.referenceCorpusPath,
      "Puzzle build referenceCorpusPath",
    ),
    privateStageRoots: decodeAgentPathMap(record.privateStageRoots),
    oracleRoot: safeRelativePath(record.oracleRoot, "Puzzle build oracleRoot"),
    stages,
  };
}

function decodeSession(value: unknown, index: number): AgentSessionResult {
  const record = object(value, `Attempt session ${String(index + 1)}`);
  const finalResponse =
    record.finalResponse === undefined
      ? undefined
      : nonEmptyString(record.finalResponse, `Attempt session ${String(index + 1)} finalResponse`);
  const common = {
    agentId: agentId(record.agentId, `Attempt session ${String(index + 1)} agentId`),
    state: sessionState(record.state, `Attempt session ${String(index + 1)} state`),
    inputTokens: integer(record.inputTokens, `Attempt session ${String(index + 1)} inputTokens`),
    outputTokens: integer(record.outputTokens, `Attempt session ${String(index + 1)} outputTokens`),
    activityCursor: integer(
      record.activityCursor,
      `Attempt session ${String(index + 1)} activityCursor`,
    ),
    terminationReason: nonEmptyString(
      record.terminationReason,
      `Attempt session ${String(index + 1)} terminationReason`,
    ),
  };
  return finalResponse === undefined ? common : { ...common, finalResponse };
}

function decodeSandbox(value: unknown): SandboxIdentity & SandboxPolicy {
  const record = object(value, "Attempt sandbox");
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

export function decodeAttemptSummary(value: unknown): AttemptSummary {
  const record = object(value, "Attempt summary");
  if (!Array.isArray(record.sessions) || record.sessions.length !== AGENT_IDS.length) {
    throw new Error("Attempt summary must contain exactly one session per agent.");
  }
  const sessions = record.sessions.map(decodeSession);
  const seen = sessions.map((session) => session.agentId).sort();
  if (seen.some((id, index) => id !== AGENT_IDS[index])) {
    throw new Error("Attempt summary must contain exactly one session per agent.");
  }
  return {
    attemptId: nonEmptyString(record.attemptId, "Attempt summary attemptId"),
    buildRoot: absolutePath(record.buildRoot, "Attempt summary buildRoot"),
    tracePath: absolutePath(record.tracePath, "Attempt summary tracePath"),
    traceMetadataPath: absolutePath(record.traceMetadataPath, "Attempt summary traceMetadataPath"),
    frozenRoot: absolutePath(record.frozenRoot, "Attempt summary frozenRoot"),
    sandbox: decodeSandbox(record.sandbox),
    sessions,
  };
}

export async function publishAttemptSummary(
  attemptRoot: string,
  summary: AttemptSummary,
): Promise<void> {
  const encoded = `${JSON.stringify(decodeAttemptSummary(summary), null, 2)}\n`;
  const temporaryPath = `${attemptRoot}/attempt.json.${randomUUID()}.tmp`;
  const destinationPath = `${attemptRoot}/attempt.json`;
  try {
    await writeFile(temporaryPath, encoded, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, destinationPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
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
      sourceKind: finding.sourceKind,
      sourceId: nonEmptyString(finding.sourceId, `Overlap finding ${String(index + 1)} sourceId`),
      matchKind: finding.matchKind,
      wordCount: integer(finding.wordCount, `Overlap finding ${String(index + 1)} wordCount`, 32),
      sha256: digest(finding.sha256, `Overlap finding ${String(index + 1)} sha256`),
    };
  });
  const keys = findings.map(
    (finding) =>
      `${finding.committedPath}\0${finding.sourceKind}\0${finding.sourceId}\0${finding.matchKind}`,
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
  const selection = {
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
  };
}

function decodeScore(value: unknown): AggregateScore {
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

export function decodeEvaluationRecord(value: unknown): EvaluationResult {
  const record = object(value, "Evaluation result");
  const status = evaluationStatus(record.status);
  const selection = record.selection === undefined ? undefined : decodeSelection(record.selection);
  const execution = record.execution === undefined ? undefined : decodeExecution(record.execution);
  const outputPath =
    record.outputPath === undefined
      ? undefined
      : absolutePath(record.outputPath, "Evaluation outputPath");
  const score = record.score === undefined ? undefined : decodeScore(record.score);
  const error =
    record.error === undefined ? undefined : nonEmptyString(record.error, "Evaluation error");

  if (
    status === "scored" &&
    (selection === undefined ||
      execution === undefined ||
      outputPath === undefined ||
      score === undefined ||
      error !== undefined)
  ) {
    throw new Error("Scored evaluation results require selection, execution, output, and score.");
  }
  if (
    status === "not-runnable" &&
    (execution !== undefined ||
      outputPath !== undefined ||
      score !== undefined ||
      error !== undefined)
  ) {
    throw new Error("Not-runnable evaluation results cannot contain execution outcomes.");
  }
  if (
    status === "no-output" &&
    (selection === undefined ||
      execution === undefined ||
      outputPath === undefined ||
      score !== undefined ||
      error !== undefined)
  ) {
    throw new Error("No-output evaluation results require selection, execution, and outputPath.");
  }
  if (status === "execution-error" && (selection === undefined || error === undefined)) {
    throw new Error("Execution-error evaluation results require selection and an error.");
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
