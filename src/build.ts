import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import {
  decodeBuildManifest,
  decodeBuildResult,
  type BuildManifest,
  type BuildPuzzleResult,
} from "./artifacts.js";
import { loadExperimentConfig, type PuzzleDefinition } from "./config.js";
import { requiredFlag } from "./flags.js";
import { runProcess } from "./process.js";
import { readJsonObject, runPythonJson } from "./python.js";
import { createDockerCommandSandbox, dockerHostEnvironment } from "./sandbox/container.js";
import { SANDBOX_IMAGE_TAG } from "./sandbox/contracts.js";
import { sandboxDockerfileDigest } from "./sandbox/docker.js";

export interface BuildPuzzleOptions {
  root: string;
  output: string;
  puzzle: PuzzleDefinition;
}

export type { BuildPuzzleResult } from "./artifacts.js";

export function assertBuildMatchesPuzzle(
  manifest: BuildManifest,
  result: BuildPuzzleResult,
  puzzle: PuzzleDefinition,
  output: string,
): void {
  const declaredAgentIds = Array.from(
    { length: puzzle.agentCount },
    (_, index) => `agent-${String(index + 1)}`,
  );
  const declaredReferenceIds = puzzle.references.join("\0");
  if (
    resolve(result.buildPath) !== resolve(output) ||
    manifest.buildId !== result.buildId ||
    manifest.agentIds.join("\0") !== result.agentIds.join("\0") ||
    manifest.agentIds.join("\0") !== declaredAgentIds.join("\0") ||
    manifest.stageCount !== result.stageCount ||
    manifest.stageCount !== puzzle.stageCount ||
    manifest.stageIntervalMs !== puzzle.stageIntervalMs ||
    manifest.source.sourceId !== puzzle.target.corpus ||
    manifest.source.chapters.start !== puzzle.target.chapters.start ||
    manifest.source.chapters.end !== puzzle.target.chapters.end ||
    manifest.references.map(({ sourceId }) => sourceId).join("\0") !== declaredReferenceIds ||
    manifest.seed !== puzzle.seed ||
    manifest.rekeys.length !== puzzle.rekeys.length ||
    manifest.rekeys.some((rekey, index) => {
      const declared = puzzle.rekeys[index];
      return (
        declared === undefined ||
        rekey.atStage !== declared.atStage ||
        rekey.keyVersion !== index + 1 ||
        rekey.changedTokenMass !== declared.changedTokenMass
      );
    })
  ) {
    throw new Error("Puzzle build does not match its resolved experiment configuration.");
  }
}

export async function buildPuzzle(options: BuildPuzzleOptions): Promise<BuildPuzzleResult> {
  const root = resolve(options.root);
  const output = resolve(options.output);
  const result = decodeBuildResult(
    await runPythonJson(
      root,
      "palimpsest.puzzle.build",
      ["--root", root, "--output", output],
      undefined,
      JSON.stringify(options.puzzle),
    ),
  );
  const manifest = decodeBuildManifest(await readJsonObject(resolve(output, "puzzle-build.json")));
  assertBuildMatchesPuzzle(manifest, result, options.puzzle, await realpath(output));
  return decodeBuildResult({ ...result, buildPath: output });
}

export async function buildPuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<BuildPuzzleResult> {
  const config = await loadExperimentConfig(requiredFlag(flags, "--config"), { root });
  return buildPuzzle({
    root,
    output: requiredFlag(flags, "--output"),
    puzzle: config.puzzle,
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
      stdio: "stderr",
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
