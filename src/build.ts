import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { loadFixturePackage } from "./fixture-package.js";
import { requiredFlag } from "./flags.js";
import { runProcess } from "./process.js";
import { runPythonJson } from "./python.js";
import { createDockerCommandSandbox, dockerHostEnvironment } from "./sandbox/container.js";
import { SANDBOX_IMAGE_TAG } from "./sandbox/contracts.js";
import { sandboxDockerfileDigest } from "./sandbox/docker.js";

export interface BuildFixtureOptions {
  root: string;
  output: string;
  fixtureId: string;
}

export interface BuildFixtureResult {
  fixtureId: string;
  contentDigest: string;
  packagePath: string;
  agentIds: readonly string[];
  stageCount: number;
  variants: Readonly<Record<string, string>>;
}

export interface BuildFixturesResult {
  fixtures: readonly Pick<BuildFixtureResult, "fixtureId" | "contentDigest" | "packagePath">[];
}

function buildResult(value: unknown): BuildFixtureResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Fixture build result must be an object.");
  }
  const result = value as Partial<BuildFixtureResult>;
  if (
    typeof result.fixtureId !== "string" ||
    typeof result.contentDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(result.contentDigest) ||
    typeof result.packagePath !== "string" ||
    !Array.isArray(result.agentIds) ||
    !Number.isSafeInteger(result.stageCount) ||
    result.stageCount === undefined ||
    result.stageCount < 1 ||
    typeof result.variants !== "object" ||
    result.variants === null
  ) {
    throw new Error("Fixture build result is invalid.");
  }
  return result as BuildFixtureResult;
}

export async function buildFixture(options: BuildFixtureOptions): Promise<BuildFixtureResult> {
  const root = resolve(options.root);
  const output = resolve(options.output);
  const result = buildResult(
    await runPythonJson(root, "palimpsest.puzzle.build", [
      "--root",
      root,
      "--output",
      output,
      "--fixture",
      options.fixtureId,
    ]),
  );
  const fixture = await loadFixturePackage(output);
  if (
    (await realpath(result.packagePath)) !== (await realpath(output)) ||
    fixture.fixtureId !== options.fixtureId ||
    fixture.fixtureId !== result.fixtureId ||
    fixture.contentDigest !== result.contentDigest ||
    fixture.stageCount !== result.stageCount ||
    fixture.agentIds.join("\0") !== result.agentIds.join("\0") ||
    Object.entries(result.variants).some(
      ([variantId, buildId]) => fixture.variants[variantId]?.buildId !== buildId,
    )
  ) {
    throw new Error("Fixture package does not match the builder result.");
  }
  return { ...result, packagePath: output };
}

export async function buildFixtures(options: {
  root: string;
  output: string;
}): Promise<BuildFixturesResult> {
  const root = resolve(options.root);
  const output = resolve(options.output);
  const value = await runPythonJson(root, "palimpsest.puzzle.build", [
    "--root",
    root,
    "--output",
    output,
    "--all",
  ]);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Fixture build collection result must be an object.");
  }
  const fixtures = (value as { fixtures?: unknown }).fixtures;
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error("Fixture build collection must contain at least one fixture.");
  }
  const decoded = await Promise.all(
    fixtures.map(async (candidate) => {
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        throw new Error("Fixture build collection entry is invalid.");
      }
      const item = candidate as Record<string, unknown>;
      if (
        typeof item.fixtureId !== "string" ||
        typeof item.contentDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(item.contentDigest) ||
        typeof item.packagePath !== "string"
      ) {
        throw new Error("Fixture build collection entry is invalid.");
      }
      const packagePath = await realpath(item.packagePath);
      const packageRoot = await realpath(resolve(output, item.fixtureId));
      const fixture = await loadFixturePackage(packageRoot);
      if (
        packagePath !== packageRoot ||
        fixture.fixtureId !== item.fixtureId ||
        fixture.contentDigest !== item.contentDigest
      ) {
        throw new Error("Fixture package does not match the collection builder result.");
      }
      return {
        fixtureId: item.fixtureId,
        contentDigest: item.contentDigest,
        packagePath: packageRoot,
      };
    }),
  );
  return { fixtures: decoded };
}

export function buildFixtureFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<BuildFixtureResult | BuildFixturesResult> {
  for (const flag of flags.keys()) {
    if (flag !== "--fixture" && flag !== "--all" && flag !== "--output") {
      throw new Error(`Unknown build option ${flag}.`);
    }
  }
  const all = flags.get("--all");
  if (all !== undefined && all !== "true") {
    throw new Error("--all must be exactly true when provided.");
  }
  if (all === "true") {
    if (flags.has("--fixture")) throw new Error("--fixture and --all are mutually exclusive.");
    return buildFixtures({ root, output: requiredFlag(flags, "--output") });
  }
  return buildFixture({
    root,
    output: requiredFlag(flags, "--output"),
    fixtureId: requiredFlag(flags, "--fixture"),
  });
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
