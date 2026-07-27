import { resolve } from "node:path";

import { decodeBuildManifest, decodeBuildResult, type BuildPuzzleResult } from "./artifacts.js";
import { integerFlag, numberFlag, requiredFlag } from "./flags.js";
import { runProcess } from "./process.js";
import { readJsonObject, runPythonJson } from "./python.js";
import { createDockerCommandSandbox, dockerHostEnvironment } from "./sandbox/container.js";
import { SANDBOX_IMAGE_TAG } from "./sandbox/contracts.js";
import { sandboxDockerfileDigest } from "./sandbox/docker.js";

export interface BuildPuzzleOptions {
  root: string;
  output: string;
  seed?: number;
  stageIntervalMs?: number;
  transitionStage?: number;
  changedTokenMass?: number;
}

export type { BuildPuzzleResult } from "./artifacts.js";

export async function buildPuzzle(options: BuildPuzzleOptions): Promise<BuildPuzzleResult> {
  const root = resolve(options.root);
  const output = resolve(options.output);
  const result = decodeBuildResult(
    await runPythonJson(root, "palimpsest.puzzle.build", [
      "--root",
      root,
      "--output",
      output,
      "--seed",
      String(options.seed ?? 0),
      "--stage-interval-ms",
      String(options.stageIntervalMs ?? 120_000),
      "--transition-stage",
      String(options.transitionStage ?? 4),
      "--changed-token-mass",
      String(options.changedTokenMass ?? 0.2),
    ]),
  );
  const manifest = decodeBuildManifest(await readJsonObject(resolve(output, "puzzle-build.json")));
  if (
    manifest.buildId !== result.buildId ||
    manifest.agentCount !== result.agentCount ||
    manifest.stageCount !== result.stageCount ||
    manifest.transitionStage !== result.transitionStage
  ) {
    throw new Error("Puzzle build result does not match its current-version manifest.");
  }
  return decodeBuildResult({ ...result, buildPath: output });
}

export function buildPuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<BuildPuzzleResult> {
  return buildPuzzle({
    root,
    output: requiredFlag(flags, "--output"),
    seed: integerFlag(flags, "--seed", 0),
    stageIntervalMs: integerFlag(flags, "--stage-interval-ms", 120_000),
    transitionStage: integerFlag(flags, "--transition-stage", 4),
    changedTokenMass: numberFlag(flags, "--changed-token-mass", 0.2),
  });
}

async function buildImage(root: string, sourceDigest: string): Promise<void> {
  const result = await runProcess(
    "docker",
    [
      "build",
      "--tag",
      SANDBOX_IMAGE_TAG,
      "--build-arg",
      `PALIMPSEST_SANDBOX_SOURCE_DIGEST=${sourceDigest}`,
      "containers/puzzle-sandbox",
    ],
    {
      cwd: root,
      env: dockerHostEnvironment(),
      stdio: "inherit",
    },
  );
  if (result.signal !== null || result.exitCode !== 0) {
    throw new Error(
      `Docker sandbox build failed${result.signal === null ? ` with exit ${String(result.exitCode)}` : ` from ${result.signal}`}.`,
    );
  }
}

export async function buildSandbox(root = resolve(".")) {
  const sourceDigest = await sandboxDockerfileDigest(root);
  await buildImage(root, sourceDigest);
  return (await createDockerCommandSandbox({ root })).identity;
}
