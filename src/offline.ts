import { resolve } from "node:path";

import { decodeBuildResult, decodeEvaluationRecord, decodeOverlapResult } from "./artifacts.js";
import { buildPuzzle, type BuildPuzzleResult } from "./build.js";
import type { PuzzleDefinition } from "./config.js";
import { evaluatePuzzle } from "./evaluate.js";
import { requiredFlag } from "./flags.js";
import { createFixtureAgentRuntimes, runPuzzle, type RunPuzzleResult } from "./run.js";

const OFFLINE_PUZZLE: PuzzleDefinition = {
  target: {
    corpus: "middlemarch",
    chapters: { start: 10, end: 15 },
  },
  references: ["jane-eyre", "moby-dick"],
  seed: 0,
  agentCount: 3,
  stageCount: 6,
  stageIntervalMs: 20,
  rekeys: [{ atStage: 4, changedTokenMass: 0.2 }],
};

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
    puzzle: OFFLINE_PUZZLE,
  });
  const run = await runPuzzle({
    root,
    buildRoot: build.buildPath,
    output: resolve(output, "attempt"),
    runName: "offline",
    repetition: 1,
    agents: createFixtureAgentRuntimes(build.agentIds, "collaborative-revision"),
    tokenBudgetPerAgent: 100,
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
