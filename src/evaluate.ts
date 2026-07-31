import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { loadFixturePackage, selectFixtureVariant } from "./fixture-package.js";
import { requiredFlag } from "./flags.js";
import type { FrozenGitEnvironment, GitRepository } from "./git.js";
import { appendTraceEvent, readJsonObject, runPythonJson } from "./python.js";
import {
  PUBLISHED_MAIN_REF,
  PublishedSolverSubmissionError,
  runPublishedSolver,
  SOLVER_COMMAND,
  SOLVER_OUTPUT_PATH,
} from "./published-solver.js";
import type { RunEvaluation, RunRecord } from "./records.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";
import type { CommandSandbox, SandboxCommandResult } from "./sandbox/contracts.js";
import { verifyTree } from "./seal.js";

const EVALUATION_TIMEOUT_MS = 30_000;

type AggregateScore = NonNullable<RunEvaluation["score"]>;

export interface EvaluateCanonicalOriginsOptions {
  root: string;
  runRoot: string;
  fixtureRoot: string;
  variantId: string;
  frozen: FrozenGitEnvironment;
  sandbox: CommandSandbox;
  tracePath?: string;
}

function decodeAggregateScore(value: Record<string, unknown>): AggregateScore {
  const matchedWords = value.matchedWords;
  const totalWords = value.totalWords;
  const coverage = value.coverage;
  const accuracy = value.accuracy;
  if (
    !Number.isSafeInteger(matchedWords) ||
    !Number.isSafeInteger(totalWords) ||
    (matchedWords as number) < 0 ||
    (totalWords as number) < 0 ||
    (matchedWords as number) > (totalWords as number) ||
    typeof coverage !== "number" ||
    !Number.isFinite(coverage) ||
    coverage < 0 ||
    coverage > 1 ||
    typeof accuracy !== "number" ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > 1
  ) {
    throw new Error("Evaluator returned an invalid aggregate score.");
  }
  return {
    matchedWords: matchedWords as number,
    totalWords: totalWords as number,
    coverage,
    accuracy,
  };
}

function assertCanonicalTopology(frozen: FrozenGitEnvironment, agentIds: readonly string[]): void {
  if (frozen.communicationMode === "shared") {
    const repository = frozen.repositories[0];
    if (
      frozen.repositories.length !== 1 ||
      repository?.repositoryId !== "shared" ||
      repository.agentIds.join("\0") !== agentIds.join("\0")
    ) {
      throw new Error(
        "Shared frozen Git must contain one canonical origin for every fixture agent.",
      );
    }
    return;
  }

  if (
    frozen.repositories.map(({ repositoryId }) => repositoryId).join("\0") !==
      agentIds.join("\0") ||
    frozen.repositories.some(
      (repository) =>
        repository.agentIds.length !== 1 || repository.agentIds[0] !== repository.repositoryId,
    )
  ) {
    throw new Error("Isolated frozen Git must contain one canonical origin per fixture agent.");
  }
}

function executionError(execution: SandboxCommandResult, fallback: string): string {
  if (execution.timedOut) return "Published solver timed out.";
  if (execution.exitCode !== 0) {
    return `Published solver exited ${String(execution.exitCode)}.`;
  }
  return fallback;
}

async function evaluateOrigin(options: {
  root: string;
  runRoot: string;
  fixtureRoot: string;
  ciphertextPath: string;
  repository: GitRepository;
  evaluationRoot: string;
  sandbox: CommandSandbox;
}): Promise<RunEvaluation> {
  const outputRoot = join(options.evaluationRoot, "output");
  await mkdir(outputRoot, { recursive: true });
  try {
    const published = await runPublishedSolver({
      repositoryPath: options.repository.path,
      ciphertextPath: options.ciphertextPath,
      outputRoot,
      sandbox: options.sandbox,
      command: SOLVER_COMMAND,
      outputPath: SOLVER_OUTPUT_PATH,
      deadline: performance.now() + EVALUATION_TIMEOUT_MS,
      evaluate: async ({ outputPath }) =>
        decodeAggregateScore(
          await runPythonJson(options.root, "palimpsest.evaluation.score", [
            "--truth",
            join(options.fixtureRoot, "oracle", "plaintext.txt"),
            "--candidate",
            outputPath,
          ]),
        ),
    });
    const outputPath = relative(options.runRoot, published.outputPath);
    if (published.kind === "succeeded") {
      return {
        repositoryId: options.repository.repositoryId,
        agentIds: options.repository.agentIds,
        status: "scored",
        commit: published.identity.commit,
        outputPath,
        score: published.value,
      };
    }
    const status =
      published.error === "Published solver did not produce output." ||
      published.error === "Published solver output is empty."
        ? "no-output"
        : "execution-error";
    return {
      repositoryId: options.repository.repositoryId,
      agentIds: options.repository.agentIds,
      status,
      commit: published.identity.commit,
      outputPath,
      ...(status === "execution-error"
        ? { error: executionError(published.execution, published.error) }
        : {}),
    };
  } catch (error) {
    if (error instanceof PublishedSolverSubmissionError) {
      return {
        repositoryId: options.repository.repositoryId,
        agentIds: options.repository.agentIds,
        status: "not-runnable",
        error: error.message,
      };
    }
    throw error;
  }
}

export async function evaluateCanonicalOrigins(
  options: EvaluateCanonicalOriginsOptions,
): Promise<RunEvaluation[]> {
  const root = resolve(options.root);
  const runRoot = resolve(options.runRoot);
  const fixtureRoot = resolve(options.fixtureRoot);
  const fixture = await loadFixturePackage(fixtureRoot);
  const variant = selectFixtureVariant(fixture, options.variantId);
  assertCanonicalTopology(options.frozen, fixture.agentIds);
  await verifyTree(options.frozen.root, options.frozen.treeSeal, "Frozen Git tree");

  const evaluationsRoot = join(runRoot, "evaluations");
  await mkdir(evaluationsRoot, { recursive: true });
  const batchRoot = await mkdtemp(join(evaluationsRoot, "batch-"));
  const evaluations: RunEvaluation[] = [];
  for (const repository of options.frozen.repositories) {
    const evaluation = await evaluateOrigin({
      root,
      runRoot,
      fixtureRoot,
      ciphertextPath: join(fixtureRoot, variant.publicCiphertextPath),
      repository,
      evaluationRoot: join(batchRoot, repository.repositoryId),
      sandbox: options.sandbox,
    });
    evaluations.push(evaluation);
    if (options.tracePath !== undefined) {
      await appendTraceEvent(options.tracePath, "evaluation.completed", evaluation);
    }
  }
  return evaluations;
}

export async function reevaluateRun(options: {
  root: string;
  runRoot: string;
  sandbox?: CommandSandbox;
}): Promise<readonly RunEvaluation[]> {
  const root = resolve(options.root);
  const runRoot = resolve(options.runRoot);
  const value = await readJsonObject(join(runRoot, "run.json"));
  if (
    value.schemaVersion !== 1 ||
    typeof value.run !== "object" ||
    value.run === null ||
    typeof value.frozen !== "object" ||
    value.frozen === null
  ) {
    throw new Error("Run record is invalid or unsupported.");
  }
  const record = value as unknown as RunRecord;
  const sandbox =
    options.sandbox ??
    (await createDockerCommandSandbox({
      root,
      expectedImageId: record.sandbox.imageId,
    }));
  const evaluations = await evaluateCanonicalOrigins({
    root,
    runRoot,
    fixtureRoot: record.run.fixture.packagePath,
    variantId: record.run.fixture.variant,
    frozen: record.frozen,
    sandbox,
  });
  const historyRoot = join(runRoot, "evaluations", "history");
  await mkdir(historyRoot, { recursive: true });
  const path = join(historyRoot, `${new Date().toISOString().replaceAll(":", "-")}.json`);
  await writeFile(
    path,
    `${JSON.stringify({ evaluatedAt: new Date().toISOString(), evaluations }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return evaluations;
}

export function evaluateRunFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<readonly RunEvaluation[]> {
  for (const flag of flags.keys()) {
    if (flag !== "--run-root") throw new Error(`Unknown evaluation option ${flag}.`);
  }
  return reevaluateRun({ root, runRoot: requiredFlag(flags, "--run-root") });
}

export { PUBLISHED_MAIN_REF, SOLVER_COMMAND, SOLVER_OUTPUT_PATH };
