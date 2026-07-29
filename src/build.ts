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
  block: string;
}

export interface BlockDiscoveryResult {
  blockId: string;
  discoveryPath: string;
  window: {
    paragraphStart: number;
    paragraphEnd: number;
    wordCount: number;
    sha256: string;
  };
  tier: "strict" | "balanced" | "fallback";
}

export type { BuildPuzzleResult } from "./artifacts.js";

export function assertBuildMatchesBlock(
  manifest: BuildManifest,
  result: BuildPuzzleResult,
  block: string,
  output: string,
): void {
  if (
    resolve(result.buildPath) !== resolve(output) ||
    manifest.pairedBuildId !== result.pairedBuildId ||
    manifest.blockId !== result.blockId ||
    result.blockId !== block ||
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
  const result = decodeBuildResult(
    await runPythonJson(
      root,
      "palimpsest.puzzle.build",
      ["--root", root, "--output", output, "--block", options.block],
      undefined,
    ),
  );
  const manifest = decodeBuildManifest(await readJsonObject(resolve(output, "puzzle-build.json")));
  assertBuildMatchesBlock(manifest, result, options.block, await realpath(output));
  return decodeBuildResult({ ...result, buildPath: output });
}

function discoveryResult(value: unknown, output: string): BlockDiscoveryResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Block discovery result must be an object.");
  }
  const record = value as Record<string, unknown>;
  const window = record.window;
  if (typeof window !== "object" || window === null || Array.isArray(window)) {
    throw new Error("Block discovery result window must be an object.");
  }
  const decoded = window as Record<string, unknown>;
  const tier = record.tier;
  if (tier !== "strict" && tier !== "balanced" && tier !== "fallback") {
    throw new Error("Block discovery result tier is unsupported.");
  }
  const result: BlockDiscoveryResult = {
    blockId: requiredResultString(record.blockId, "blockId"),
    discoveryPath: resolve(requiredResultString(record.discoveryPath, "discoveryPath")),
    window: {
      paragraphStart: requiredResultInteger(decoded.paragraphStart, "paragraphStart"),
      paragraphEnd: requiredResultInteger(decoded.paragraphEnd, "paragraphEnd"),
      wordCount: requiredResultInteger(decoded.wordCount, "wordCount"),
      sha256: requiredResultString(decoded.sha256, "sha256"),
    },
    tier,
  };
  if (result.discoveryPath !== resolve(output, "discovery.json")) {
    throw new Error("Block discovery result path does not match its output.");
  }
  return result;
}

function requiredResultString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Block discovery result ${name} must be a non-empty string.`);
  }
  return value;
}

function requiredResultInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Block discovery result ${name} must be a positive integer.`);
  }
  return value as number;
}

async function discoverBlock(options: BuildPuzzleOptions): Promise<BlockDiscoveryResult> {
  const root = resolve(options.root);
  const output = resolve(options.output);
  return discoveryResult(
    await runPythonJson(
      root,
      "palimpsest.puzzle.build",
      ["--root", root, "--output", output, "--block", options.block, "--discover", "true"],
      undefined,
    ),
    output,
  );
}

export async function buildPuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<BuildPuzzleResult | BlockDiscoveryResult> {
  const allowed = new Set(["--block", "--output", "--discover"]);
  const unexpected = [...flags.keys()].find((flag) => !allowed.has(flag));
  if (unexpected !== undefined) throw new Error(`Unknown build option ${unexpected}.`);
  const options = {
    root,
    output: requiredFlag(flags, "--output"),
    block: requiredFlag(flags, "--block"),
  };
  const discover = flags.get("--discover");
  if (discover === undefined) return buildPuzzle(options);
  if (discover !== "true") throw new Error("--discover must be exactly true.");
  return discoverBlock(options);
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
