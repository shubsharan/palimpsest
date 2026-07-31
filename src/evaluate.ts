import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  type AggregateScore,
  type AttemptSummary,
  decodeAggregateScore,
  decodeAttemptSummary,
  decodeBuildManifest,
  decodeDiagnosticScore,
  decodeEvaluationRecord,
  type DiagnosticScore,
  selectBuildVariant,
} from "./artifacts.js";
import { requiredFlag } from "./flags.js";
import type { GitRepositoryId } from "./git.js";
import { appendTraceEvent, readJsonObject, runPythonJson } from "./python.js";
import {
  PUBLISHED_MAIN_REF,
  PublishedSolverSubmissionError,
  runPublishedSolver,
  SOLVER_COMMAND,
  SOLVER_OUTPUT_PATH,
} from "./published-solver.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";
import type { CommandSandbox, SandboxCommandResult } from "./sandbox/contracts.js";
import { verifyTree } from "./seal.js";

export type EvaluationStatus = "scored" | "not-runnable" | "no-output" | "execution-error";
export type IntegrationGapReason = "shared-single-origin" | "isolated-no-realized-product";

export interface CanonicalOrigin {
  originId: GitRepositoryId;
  repositoryId: GitRepositoryId;
  ref: typeof PUBLISHED_MAIN_REF;
  commit?: string;
  realizedTeamProduct: boolean;
}

export interface OutputProvenance {
  path: string;
  sha256: string;
  byteLength: number;
}

export interface OriginEvaluation {
  origin: CanonicalOrigin;
  status: EvaluationStatus;
  execution?: SandboxCommandResult;
  aggregate?: AggregateScore;
  diagnostics?: DiagnosticScore;
  error?: string;
  outputProvenance?: OutputProvenance;
}

export interface TeamEvaluation {
  realizedProductOriginId: GitRepositoryId | null;
  collectiveCeiling: AggregateScore | null;
  integrationGap: null;
  integrationGapReason: IntegrationGapReason;
}

export interface EvaluationRecord {
  schemaVersion: 2;
  evaluationPolicyId: "all-canonical-main-snapshots-v1";
  primaryMetricId: "normalized-positional-word-v1";
  diagnosticMetricId: "palimpsest-diagnostics-v1";
  attemptId: string;
  condition: AttemptSummary["condition"];
  buildId: string;
  protocolDigest: string;
  startedAt: string;
  completedAt: string;
  origins: readonly OriginEvaluation[];
  team: TeamEvaluation;
}

export interface EvaluatePuzzleOptions {
  root: string;
  attempt: string;
}

interface CanonicalTarget {
  originId: GitRepositoryId;
  repositoryPath: string;
  realizedTeamProduct: boolean;
}

interface ScoredCandidate {
  aggregate: AggregateScore;
  diagnostics: DiagnosticScore;
  correctPositions: readonly boolean[];
}

export { SOLVER_COMMAND, SOLVER_OUTPUT_PATH };

function attemptRootFrom(path: string): string {
  const resolved = resolve(path);
  return basename(resolved) === "frozen" ? dirname(resolved) : resolved;
}

function canonicalTargets(attempt: AttemptSummary): readonly CanonicalTarget[] {
  const expectedIds: readonly GitRepositoryId[] =
    attempt.communicationMode === "shared" ? ["shared"] : attempt.agentIds;
  return expectedIds.map((originId) => {
    const repository = attempt.frozen.repositories.find(
      (candidate) => candidate.repositoryId === originId,
    );
    if (repository === undefined) {
      throw new Error(`Frozen canonical origin ${originId} is missing.`);
    }
    return {
      originId,
      repositoryPath: repository.path,
      realizedTeamProduct: originId === "shared",
    };
  });
}

function decodeScoredCandidate(value: unknown): ScoredCandidate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Diagnostic scorer result must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.correctPositions) ||
    !record.correctPositions.every((item) => typeof item === "boolean")
  ) {
    throw new Error("Diagnostic scorer position facts are invalid.");
  }
  return {
    aggregate: decodeAggregateScore(record.aggregate),
    diagnostics: decodeDiagnosticScore(record.diagnostics),
    correctPositions: record.correctPositions as boolean[],
  };
}

async function provenance(path: string, evaluationRoot: string): Promise<OutputProvenance> {
  const [content, metadata] = await Promise.all([readFile(path), stat(path)]);
  return {
    path: relative(evaluationRoot, path),
    sha256: createHash("sha256").update(content).digest("hex"),
    byteLength: metadata.size,
  };
}

function originBase(target: CanonicalTarget, commit?: string): CanonicalOrigin {
  return {
    originId: target.originId,
    repositoryId: target.originId,
    ref: PUBLISHED_MAIN_REF,
    ...(commit === undefined ? {} : { commit }),
    realizedTeamProduct: target.realizedTeamProduct,
  };
}

async function evaluateOrigin(options: {
  target: CanonicalTarget;
  evaluationRoot: string;
  ciphertextPath: string;
  sandbox: CommandSandbox;
  score: (outputPath: string) => Promise<ScoredCandidate>;
}): Promise<{ result: OriginEvaluation; scored?: ScoredCandidate }> {
  const originRoot = join(options.evaluationRoot, "origins", options.target.originId);
  const outputRoot = join(originRoot, "output");
  await mkdir(outputRoot, { recursive: true });
  let commit: string | undefined;
  try {
    const published = await runPublishedSolver({
      repositoryPath: options.target.repositoryPath,
      ciphertextPath: options.ciphertextPath,
      outputRoot,
      sandbox: options.sandbox,
      deadline: performance.now() + 30_000,
      onCaptured: (identity) => {
        commit = identity.commit;
      },
      evaluate: ({ outputPath }) => options.score(outputPath),
    });
    const origin = originBase(options.target, published.identity.commit);
    if (published.kind === "submission-error") {
      const noOutput =
        published.error === "Published solver did not produce output." ||
        published.error === "Published solver output is empty.";
      return {
        result: {
          origin,
          status: noOutput ? "no-output" : "execution-error",
          execution: published.execution,
          error: published.error,
        },
      };
    }
    return {
      result: {
        origin,
        status: "scored",
        execution: published.execution,
        aggregate: published.value.aggregate,
        diagnostics: published.value.diagnostics,
        outputProvenance: await provenance(published.outputPath, options.evaluationRoot),
      },
      scored: published.value,
    };
  } catch (error) {
    if (error instanceof PublishedSolverSubmissionError) {
      return {
        result: {
          origin: originBase(options.target, commit),
          status: "not-runnable",
          error: error.message,
        },
      };
    }
    throw error;
  }
}

function teamEvaluation(
  communicationMode: AttemptSummary["communicationMode"],
  scored: readonly ScoredCandidate[],
): TeamEvaluation {
  if (scored.length === 0) {
    return {
      realizedProductOriginId: communicationMode === "shared" ? "shared" : null,
      collectiveCeiling: null,
      integrationGap: null,
      integrationGapReason:
        communicationMode === "shared" ? "shared-single-origin" : "isolated-no-realized-product",
    };
  }
  const expectedWords = scored[0]!.correctPositions.length;
  if (scored.some((item) => item.correctPositions.length !== expectedWords)) {
    throw new Error("Scored origins disagree on the expected word count.");
  }
  const matchedWords = Array.from({ length: expectedWords }, (_, index) =>
    scored.some((item) => item.correctPositions[index] === true),
  ).filter(Boolean).length;
  const totalWords = Math.min(...scored.map((item) => item.aggregate.totalWords));
  const coverage = Math.max(...scored.map((item) => item.aggregate.coverage));
  return {
    realizedProductOriginId: communicationMode === "shared" ? "shared" : null,
    collectiveCeiling: {
      matchedWords,
      totalWords,
      coverage,
      accuracy: totalWords === 0 ? 1 : matchedWords / totalWords,
    },
    integrationGap: null,
    integrationGapReason:
      communicationMode === "shared" ? "shared-single-origin" : "isolated-no-realized-product",
  };
}

export async function evaluateCanonicalOrigins(options: {
  attempt: AttemptSummary;
  targets: readonly CanonicalTarget[];
  evaluationRoot: string;
  ciphertextPath: string;
  sandbox: CommandSandbox;
  score: (outputPath: string) => Promise<ScoredCandidate>;
  now?: () => Date;
}): Promise<EvaluationRecord> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const origins: OriginEvaluation[] = [];
  const scored: ScoredCandidate[] = [];
  for (const target of options.targets) {
    const evaluated = await evaluateOrigin({ ...options, target });
    origins.push(evaluated.result);
    if (evaluated.scored !== undefined) scored.push(evaluated.scored);
  }
  return decodeEvaluationRecord({
    schemaVersion: 2,
    evaluationPolicyId: "all-canonical-main-snapshots-v1",
    primaryMetricId: "normalized-positional-word-v1",
    diagnosticMetricId: "palimpsest-diagnostics-v1",
    attemptId: options.attempt.attemptId,
    condition: options.attempt.condition,
    buildId: options.attempt.buildId,
    protocolDigest: options.attempt.protocolDigest,
    startedAt,
    completedAt: now().toISOString(),
    origins,
    team: teamEvaluation(options.attempt.communicationMode, scored),
  });
}

export async function evaluatePuzzle(options: EvaluatePuzzleOptions): Promise<EvaluationRecord> {
  const root = resolve(options.root);
  const attemptRoot = attemptRootFrom(options.attempt);
  const evaluationRoot = join(attemptRoot, "evaluation");
  const attempt = decodeAttemptSummary(await readJsonObject(join(attemptRoot, "attempt.json")));
  await Promise.all([
    verifyTree(attempt.buildRoot, attempt.buildTreeSeal, "Attempt build tree"),
    verifyTree(attempt.frozen.root, attempt.frozen.treeSeal, "Attempt frozen tree"),
  ]);
  const build = decodeBuildManifest(
    await readJsonObject(join(attempt.buildRoot, "puzzle-build.json")),
  );
  const variant = selectBuildVariant(build, attempt.variantId);
  if (variant.buildId !== attempt.buildId) {
    throw new Error("Attempt build identity does not match its selected variant.");
  }
  const staging = await mkdtemp(join(attemptRoot, ".evaluation-"));
  try {
    const sandbox = await createDockerCommandSandbox({
      root,
      expectedImageId: attempt.sandbox.imageId,
    });
    const record = await evaluateCanonicalOrigins({
      attempt,
      targets: canonicalTargets(attempt),
      evaluationRoot: staging,
      ciphertextPath: join(attempt.buildRoot, variant.publicCiphertextPath),
      sandbox,
      score: async (outputPath) =>
        decodeScoredCandidate(
          await runPythonJson(root, "palimpsest.evaluation.score", [
            "--truth",
            join(attempt.buildRoot, "oracle", "plaintext.txt"),
            "--candidate",
            outputPath,
            "--allocation",
            join(attempt.buildRoot, "oracle", "allocation.json"),
            "--design",
            join(attempt.buildRoot, "oracle", "design.json"),
          ]),
        ),
    });
    await writeFile(join(staging, "result.json"), `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(staging, evaluationRoot);
    await appendTraceEvent(attempt.tracePath, "evaluation.completed", {
      origins: record.origins.map(({ origin, status }) => ({ originId: origin.originId, status })),
    });
    return record;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export function evaluatePuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<EvaluationRecord> {
  const allowed = new Set(["--attempt"]);
  const unexpected = [...flags.keys()].find((flag) => !allowed.has(flag));
  if (unexpected !== undefined) throw new Error(`Unknown evaluate option ${unexpected}.`);
  return evaluatePuzzle({ root, attempt: requiredFlag(flags, "--attempt") });
}
