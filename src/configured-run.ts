import { join, resolve } from "node:path";

import { decodeBuildManifest } from "./artifacts.js";
import { resolveCondition } from "./condition.js";
import { loadResolvedStudy } from "./config.js";
import { assertBuildMatchesStudy, createConfiguredStudyAgents } from "./experiment.js";
import { requiredFlag } from "./flags.js";
import { assertPreflightSandbox, readCurrentPreflight } from "./preflight.js";
import { readJsonObject } from "./python.js";
import { runPuzzle, type RunPuzzleResult } from "./run.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";

export async function runConfiguredPuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<RunPuzzleResult> {
  const repositoryRoot = resolve(root);
  const configPath = resolve(repositoryRoot, requiredFlag(flags, "--config"));
  const condition = resolveCondition(requiredFlag(flags, "--condition")).id;
  const buildRoot = resolve(repositoryRoot, requiredFlag(flags, "--build"));
  const study = await loadResolvedStudy(configPath, repositoryRoot);
  const manifest = decodeBuildManifest(await readJsonObject(join(buildRoot, "puzzle-build.json")));
  assertBuildMatchesStudy(manifest, study);
  const sandbox = await createDockerCommandSandbox({ root: repositoryRoot });
  const preflight = await readCurrentPreflight(repositoryRoot);
  assertPreflightSandbox(preflight, sandbox.identity);
  const agents = createConfiguredStudyAgents(study);
  return runPuzzle({
    root: repositoryRoot,
    buildRoot,
    output: resolve(repositoryRoot, requiredFlag(flags, "--attempt-root")),
    studyPhase: "standalone",
    monetaryAuthorizationCeilingCents: study.budgets.perAttemptMonetaryCeilingCents,
    condition,
    agents,
    releaseOffsetsMs: study.schedule.releaseOffsetsMs,
    cutoffMs: study.schedule.cutoffMs,
    tokenBudgetPerAgent: study.budgets.tokenBudgetPerAgent,
    teamChannel: study.communication.teamChannel,
    sandbox,
  });
}
