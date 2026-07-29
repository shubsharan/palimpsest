import { resolve } from "node:path";

import { buildPuzzle } from "./build.js";
import { loadExperimentConfig } from "./config.js";
import { createConfiguredRunAgents } from "./experiment.js";
import { requiredFlag } from "./flags.js";
import { runPuzzle, type RunPuzzleResult } from "./run.js";

export async function runConfiguredPuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<RunPuzzleResult> {
  const configPath = requiredFlag(flags, "--config");
  const runName = requiredFlag(flags, "--run");
  const buildRoot = resolve(requiredFlag(flags, "--build"));
  const config = await loadExperimentConfig(configPath, {
    root,
    selectedRun: runName,
  });
  const run = config.runs.find((candidate) => candidate.name === runName);
  if (run === undefined) throw new Error(`Selected run ${runName} does not exist.`);
  const build = await buildPuzzle({ root, output: buildRoot, block: config.puzzle.block });
  return runPuzzle({
    root,
    buildRoot: build.buildPath,
    output: requiredFlag(flags, "--output"),
    runName,
    repetition: 1,
    agents: createConfiguredRunAgents(config, run),
    tokenBudgetPerAgent: config.limits.tokenBudgetPerAgent,
    wallTimeMs: config.limits.wallTimeMs,
    stageIntervalMs: config.puzzle.stageIntervalMs,
  });
}
