import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import {
  decodeBuildManifest,
  decodeBuildResult,
  type BuildManifest,
  type BuildPuzzleResult,
} from "./artifacts.js";
import { requiredFlag } from "./flags.js";
import { runProcess } from "./process.js";
import { readJsonObject, runPythonJson } from "./python.js";
import { createDockerCommandSandbox, dockerHostEnvironment } from "./sandbox/container.js";
import { SANDBOX_IMAGE_TAG } from "./sandbox/contracts.js";
import { sandboxDockerfileDigest } from "./sandbox/docker.js";

export interface BuildPuzzleOptions {
  root: string;
  output: string;
  source: string;
  phase?: "calibration" | "validation";
  block?: string;
}

export type { BuildPuzzleResult } from "./artifacts.js";

export function assertBuildMatchesBlock(
  manifest: BuildManifest,
  result: BuildPuzzleResult,
  block: string | undefined,
  output: string,
): void {
  if (
    resolve(result.buildPath) !== resolve(output) ||
    manifest.pairedBuildId !== result.pairedBuildId ||
    manifest.blockId !== result.blockId ||
    (block !== undefined && result.blockId !== block) ||
    manifest.variants.stationary.buildId !== result.variants.stationary ||
    manifest.variants.rekey.buildId !== result.variants.rekey ||
    manifest.agentIds.join("\0") !== result.agentIds.join("\0") ||
    manifest.stageCount !== result.stageCount ||
    manifest.agentIds.join("\0") !== "agent-1\0agent-2\0agent-3" ||
    manifest.stageCount !== 6
  ) {
    throw new Error("Puzzle build does not match the requested block.");
  }
}

export async function buildPuzzle(options: BuildPuzzleOptions): Promise<BuildPuzzleResult> {
  const root = resolve(options.root);
  const output = resolve(options.output);
  const arguments_ = [
    "--root",
    root,
    "--output",
    output,
    "--source",
    resolve(options.source),
    "--phase",
    options.phase ?? "validation",
  ];
  if (options.block !== undefined) arguments_.push("--block", options.block);
  const result = decodeBuildResult(
    await runPythonJson(root, "palimpsest.puzzle.build", arguments_, undefined),
  );
  const manifest = decodeBuildManifest(await readJsonObject(resolve(output, "puzzle-build.json")));
  assertBuildMatchesBlock(manifest, result, options.block, await realpath(output));
  return decodeBuildResult({ ...result, buildPath: output });
}

export async function buildPuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<BuildPuzzleResult> {
  const allowed = new Set(["--source", "--output", "--phase", "--block"]);
  const unexpected = [...flags.keys()].find((flag) => !allowed.has(flag));
  if (unexpected !== undefined) throw new Error(`Unknown build option ${unexpected}.`);
  const options = {
    root,
    output: requiredFlag(flags, "--output"),
    source: requiredFlag(flags, "--source"),
    phase: flags.get("--phase") ?? "validation",
    block: flags.get("--block"),
  };
  if (options.phase !== "calibration" && options.phase !== "validation") {
    throw new Error("--phase must be exactly calibration or validation.");
  }
  return buildPuzzle(
    options.block === undefined
      ? { root: options.root, output: options.output, source: options.source, phase: options.phase }
      : { ...options, block: options.block, phase: options.phase },
  );
}

export function sandboxDockerBuildArguments(sourceDigest: string): readonly string[] {
  return [
    "build",
    "--provenance=false",
    "--tag",
    SANDBOX_IMAGE_TAG,
    "--build-arg",
    `PALIMPSEST_SANDBOX_SOURCE_DIGEST=${sourceDigest}`,
    "containers/puzzle-sandbox",
  ];
}

async function buildImage(root: string, sourceDigest: string): Promise<void> {
  const result = await runProcess("docker", sandboxDockerBuildArguments(sourceDigest), {
    cwd: root,
    env: dockerHostEnvironment(),
    stdio: "stderr",
  });
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
