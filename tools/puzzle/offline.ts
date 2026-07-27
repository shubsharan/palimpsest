import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPuzzle, type BuildPuzzleResult } from "./build.js";
import { parseFlags, requiredFlag } from "./common.js";
import { evaluatePuzzle } from "./evaluate.js";
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
    wallTimeMs: 2_000,
  });
  const evaluation = await evaluatePuzzle({
    root,
    attempt: run.attemptRoot,
    workspace: "agent-1",
    command: "sh solve.sh",
    outputPath: "reconstruction.txt",
    notes: "Offline fixture selects the solver published by agent-1.",
  });
  return { build, run, evaluation };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const result = await runOfflinePuzzle({
    root: resolve("."),
    output: requiredFlag(flags, "--output"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
