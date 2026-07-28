import { resolve } from "node:path";

import { decodeBuildResult, decodeEvaluationRecord, decodeOverlapResult } from "./artifacts.js";
import { buildPuzzle, type BuildPuzzleResult } from "./build.js";
import { evaluatePuzzle } from "./evaluate.js";
import { requiredFlag } from "./flags.js";
import { runPuzzle, type RunPuzzleResult } from "./run.js";

export interface OfflinePuzzleOptions {
  root: string;
  output: string;
}

export interface OfflinePuzzleResult {
  build: BuildPuzzleResult;
  run: RunPuzzleResult;
  evaluation: Awaited<ReturnType<typeof evaluatePuzzle>>;
}

export async function runOfflinePuzzle(
  options: OfflinePuzzleOptions,
): Promise<OfflinePuzzleResult> {
  const root = resolve(options.root);
  const output = resolve(options.output);
  const build = await buildPuzzle({
    root,
    output: resolve(output, "build"),
    seed: 0,
    stageIntervalMs: 20,
    transitionStage: 4,
    changedTokenMass: 0.2,
  });
  const run = await runPuzzle({
    root,
    buildRoot: build.buildPath,
    output: resolve(output, "attempt"),
    adapter: "fixture",
    fixtureScenario: "collaborative-revision",
    tokenBudget: 100,
    wallTimeMs: 10_000,
  });
  const evaluation = await evaluatePuzzle({
    root,
    attempt: run.attemptRoot,
    workspace: "agent-1",
    command: "sh solve.sh",
    outputPath: "reconstruction.txt",
    notes: "Offline fixture selects the solver published by agent-1.",
  });
  return {
    build: decodeBuildResult(build),
    run: { ...run, overlap: decodeOverlapResult(run.overlap) },
    evaluation: decodeEvaluationRecord(evaluation),
  };
}

export function runOfflinePuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<OfflinePuzzleResult> {
  return runOfflinePuzzle({
    root,
    output: requiredFlag(flags, "--output"),
  });
}
