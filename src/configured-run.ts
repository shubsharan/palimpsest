import { join, resolve } from "node:path";

import { decodeBuildManifest } from "./artifacts.js";
import { resolveCondition } from "./condition.js";
import { loadExperimentConfig } from "./config.js";
import { assertBuildMatchesExperimentConfig, createConfiguredRunAgents } from "./experiment.js";
import { requiredFlag } from "./flags.js";
import { readJsonObject } from "./python.js";
import { runPuzzle, type RunPuzzleResult } from "./run.js";

export async function runConfiguredPuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<RunPuzzleResult> {
  const configPath = requiredFlag(flags, "--config");
  const runName = requiredFlag(flags, "--run");
  const condition = resolveCondition(requiredFlag(flags, "--condition")).id;
  const buildRoot = resolve(requiredFlag(flags, "--build"));
  const config = await loadExperimentConfig(configPath, {
    root,
    selectedRun: runName,
  });
  const run = config.runs.find((candidate) => candidate.name === runName);
  if (run === undefined) throw new Error(`Selected run ${runName} does not exist.`);
  const manifest = decodeBuildManifest(await readJsonObject(join(buildRoot, "puzzle-build.json")));
  assertBuildMatchesExperimentConfig(manifest, config);
  return runPuzzle({
    root,
    buildRoot,
    output: requiredFlag(flags, "--output"),
    runName,
    repetition: 1,
    condition,
    agents: createConfiguredRunAgents(config, run),
    tokenBudgetPerAgent: config.limits.tokenBudgetPerAgent,
  });
}
