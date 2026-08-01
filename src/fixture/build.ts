import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { loadFixturePackage } from "./package.js";
import { runProcess } from "../process.js";
import { runPythonJson } from "../python.js";
import { loadResolvedExperiment, validateRunAgainstFixture } from "../experiment/manifest.js";
import type { ResolvedRun } from "../experiment/contracts.js";
import { createDockerCommandSandbox, dockerHostEnvironment } from "../sandbox/container.js";
import { SandboxInfrastructureError, sandboxImageTag } from "../sandbox/contracts.js";
import {
  parseSandboxImageInspection,
  sandboxDockerfileDigest,
  validateSandboxImageInspection,
} from "../sandbox/docker.js";

export interface BuildFixtureOptions {
  root: string;
  output: string;
  fixture?: Record<string, unknown>;
  selectedVariant?: string;
  /** @deprecated Use the fixture declared in experiments/config.yaml. */
  fixtureId?: string;
}

export interface BuildFixtureResult {
  fixtureId: string;
  contentDigest: string;
  packagePath: string;
  agentIds: readonly string[];
  stageCount: number;
  buildId: string;
  rekeyAtStage: number | null;
}

export interface BuildFixturesResult {
  fixtures: readonly (Pick<BuildFixtureResult, "fixtureId" | "contentDigest" | "packagePath"> & {
    runIds: readonly string[];
  })[];
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
    typeof result.buildId !== "string" ||
    !/^build-[0-9a-f]{64}$/.test(result.buildId) ||
    (result.rekeyAtStage !== null && !Number.isSafeInteger(result.rekeyAtStage))
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
      "--definition-json",
      JSON.stringify(options.fixture),
      ...(options.selectedVariant === undefined
        ? []
        : ["--selected-variant", options.selectedVariant]),
    ]),
  );
  const fixture = await loadFixturePackage(output);
  if (
    (await realpath(result.packagePath)) !== (await realpath(output)) ||
    fixture.fixtureId !== options.fixture?.fixtureId ||
    fixture.constructionId !== options.fixture.constructionId ||
    fixture.fixtureId !== result.fixtureId ||
    fixture.contentDigest !== result.contentDigest ||
    fixture.stageCount !== result.stageCount ||
    fixture.agentIds.join("\0") !== result.agentIds.join("\0") ||
    fixture.buildId !== result.buildId ||
    fixture.rekeyAtStage !== result.rekeyAtStage
  ) {
    throw new Error("Fixture package does not match the builder result.");
  }
  return { ...result, packagePath: output };
}

async function reuseBuiltFixture(run: ResolvedRun): Promise<BuildFixtureResult | undefined> {
  try {
    const existing = await stat(run.fixture.packageRoot);
    if (!existing.isDirectory()) {
      throw new Error(`Derived fixture path is not a directory: ${run.fixture.packageRoot}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const fixture = await loadFixturePackage(run.fixture.packageRoot);
  validateRunAgainstFixture(run, fixture);
  if (
    fixture.fixtureId !== run.fixture.fixtureId ||
    fixture.constructionId !== run.fixture.constructionId ||
    fixture.variantId !== run.fixture.variant ||
    fixture.rekeyAtStage !== (run.fixture.rekeyAtStage ?? null)
  ) {
    throw new Error(`Existing derived fixture does not match run ${run.id}.`);
  }
  return {
    fixtureId: fixture.fixtureId,
    contentDigest: fixture.contentDigest,
    packagePath: run.fixture.packageRoot,
    agentIds: fixture.agentIds,
    stageCount: fixture.stageCount,
    buildId: fixture.buildId,
    rekeyAtStage: fixture.rekeyAtStage,
  };
}

export function derivedFixtureDefinition(run: ResolvedRun): Record<string, unknown> {
  const fixtureId = run.fixture.fixtureId;
  const constructionId = run.fixture.constructionId;
  const source = run.fixture.source;
  if (fixtureId === undefined || source === undefined) {
    throw new Error(`Run ${run.id} is missing its derived fixture inputs.`);
  }
  const stageCount = run.schedule.releaseOffsetsMs.length;
  const rekeyAtStage = run.fixture.rekeyAtStage ?? Math.floor(stageCount / 2) + 1;
  return {
    fixtureId,
    constructionId,
    source: {
      path: source,
      format: "plain-text",
      window: { paragraphStart: 0, paragraphEnd: 0, wordCount: 0, sha256: "" },
    },
    references: [],
    seed: Number.parseInt(constructionId.slice(-12), 16),
    agentIds: Object.keys(run.assignment),
    stageCount,
    variants: [
      { variantId: "stationary", rekeyFromStage: null },
      { variantId: `rekey-stage-${String(rekeyAtStage)}`, rekeyFromStage: rekeyAtStage },
    ],
    allocationConstraints: {
      minimumAnchors: 12,
      minimumSentinels: 6,
      minimumSpecialistsPerAgent: 3,
      minimumChangedMass: 0.15,
      tiers: [
        {
          tier: "strict",
          minimumSpecialistOwnerShare: 0.67,
          minimumOwnerOccurrences: 3,
          minimumSentinelOccurrences: 3,
          maximumSoloCoverage: 0.6,
          maximumRegionDeviation: 0.04,
          maximumStageDeviation: 0.12,
          maximumControlDistance: 0.15,
        },
        {
          tier: "balanced",
          minimumSpecialistOwnerShare: 0.6,
          minimumOwnerOccurrences: 2,
          minimumSentinelOccurrences: 2,
          maximumSoloCoverage: 0.67,
          maximumRegionDeviation: 0.07,
          maximumStageDeviation: 0.18,
          maximumControlDistance: 0.25,
        },
        {
          tier: "fallback",
          minimumSpecialistOwnerShare: 0.55,
          minimumOwnerOccurrences: 2,
          minimumSentinelOccurrences: 1,
          maximumSoloCoverage: 0.75,
          maximumRegionDeviation: 0.1,
          maximumStageDeviation: 0.25,
          maximumControlDistance: 0.4,
        },
      ],
    },
  };
}

export async function buildFixtureFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<BuildFixturesResult> {
  for (const flag of flags.keys()) {
    if (flag !== "--config" && flag !== "--run") {
      throw new Error(`Unknown build option ${flag}.`);
    }
  }
  const configPath = resolve(root, flags.get("--config") ?? "experiments/config.yaml");
  const experiment = await loadResolvedExperiment(configPath, root);
  const selectedRun = flags.get("--run");
  const runs =
    selectedRun === undefined
      ? experiment.runs
      : experiment.runs.filter(({ id }) => id === selectedRun);
  if (runs.length === 0) throw new Error(`Unknown experiment run ${selectedRun}.`);

  const grouped = new Map<string, typeof runs>();
  for (const run of runs) {
    const peers = grouped.get(run.fixture.packageRoot) ?? [];
    grouped.set(run.fixture.packageRoot, [...peers, run]);
  }
  const fixtures: BuildFixturesResult["fixtures"][number][] = [];
  for (const packageRuns of grouped.values()) {
    const run = packageRuns[0]!;
    const result =
      (await reuseBuiltFixture(run)) ??
      (await buildFixture({
        root,
        output: run.fixture.packageRoot,
        fixture: derivedFixtureDefinition(run),
        selectedVariant: run.fixture.variant,
      }));
    fixtures.push({
      fixtureId: result.fixtureId,
      contentDigest: result.contentDigest,
      packagePath: result.packagePath,
      runIds: packageRuns.map(({ id }) => id),
    });
  }
  return { fixtures };
}

export function sandboxDockerBuildArguments(sourceDigest: string): readonly string[] {
  return [
    "build",
    "--provenance=false",
    "--tag",
    sandboxImageTag(sourceDigest),
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
    deadline: performance.now() + 600_000,
  });
  if (result.timedOut) {
    throw new Error("Docker sandbox build exceeded its 10 minute deadline.");
  }
  if (result.signal !== null || result.exitCode !== 0) {
    throw new Error(
      `Docker sandbox build failed${result.signal === null ? ` with exit ${String(result.exitCode)}` : ` from ${result.signal}`}.`,
    );
  }
}

async function sandboxImageAvailable(root: string, sourceDigest: string): Promise<boolean> {
  const imageTag = sandboxImageTag(sourceDigest);
  const result = await runProcess("docker", ["image", "inspect", imageTag], {
    cwd: root,
    env: dockerHostEnvironment(),
    deadline: performance.now() + 10_000,
  });
  if (result.timedOut) {
    throw new Error("Docker image inspection exceeded its 10 second deadline.");
  }
  if (result.signal !== null) {
    throw new Error(`Docker image inspection was terminated by ${result.signal}.`);
  }
  if (result.exitCode === 0) {
    try {
      validateSandboxImageInspection(
        parseSandboxImageInspection(result.stdout.toString("utf8")),
        sourceDigest,
      );
      return true;
    } catch (error) {
      if (error instanceof SandboxInfrastructureError) return false;
      throw error;
    }
  }
  const diagnostic = result.stderr.toString("utf8").toLowerCase();
  if (diagnostic.includes("no such image") || diagnostic.includes("no such object")) return false;
  throw new Error(
    `Docker image inspection failed with exit ${String(result.exitCode)}: ${diagnostic.trim() || "no error detail"}`,
  );
}

export async function buildSandbox(root = resolve(".")) {
  const sourceDigest = await sandboxDockerfileDigest(root);
  if (!(await sandboxImageAvailable(root, sourceDigest))) {
    await buildImage(root, sourceDigest);
  }
  return (await createDockerCommandSandbox({ root })).identity;
}
