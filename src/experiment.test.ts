import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  decodeBuildManifest,
  publishAttemptSummary,
  type AttemptSummary,
  type BuildManifest,
  type BuildPuzzleResult,
} from "./artifacts.js";
import { type ResolvedExperimentConfig } from "./config.js";
import {
  assertBuildMatchesExperimentConfig,
  createConfiguredRunAgents,
  runExperiment,
  type CurrentBuildInputs,
  type ExperimentRunRequest,
} from "./experiment.js";
import type { ModelAdapter } from "./model.js";
import { SANDBOX_IMAGE_TAG, SANDBOX_POLICY } from "./sandbox/contracts.js";
import { testBuildManifest } from "./test-helpers.js";

const BUILD_ID = `build-${"a".repeat(64)}`;
const DIGEST = "b".repeat(64);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "palimpsest-experiment-"));
  temporaryRoots.push(path);
  return path;
}

function config(): ResolvedExperimentConfig {
  return {
    schemaVersion: 1,
    puzzle: {
      block: "calibration-theron-ware",
      stageIntervalMs: 100,
    },
    limits: { tokenBudgetPerAgent: 1_000, wallTimeMs: 10_000 },
    providers: {
      first: { driver: "openai", apiKeyEnv: "RESEARCH_KEY" },
      second: { driver: "anthropic", apiKeyEnv: "SECOND_KEY" },
    },
    models: {
      one: {
        provider: "first",
        model: "model-one",
        settings: { temperature: 0 },
        providerOptions: {},
      },
      two: {
        provider: "second",
        model: "model-two",
        settings: {},
        providerOptions: {},
      },
    },
    runs: [
      {
        name: "alpha",
        repetitions: 2,
        agents: [
          { agentId: "agent-1", modelProfile: "one" },
          { agentId: "agent-2", modelProfile: "one" },
          { agentId: "agent-3", modelProfile: "one" },
        ],
      },
      {
        name: "beta",
        repetitions: 1,
        agents: [
          { agentId: "agent-1", modelProfile: "one" },
          { agentId: "agent-2", modelProfile: "two" },
          { agentId: "agent-3", modelProfile: "one" },
        ],
      },
    ],
  };
}

function adapter(): ModelAdapter {
  return {
    openSession() {
      throw new Error("Fixture adapters are never opened by orchestration tests.");
    },
  };
}

function buildResult(experimentRoot: string): BuildPuzzleResult {
  return {
    pairedBuildId: `paired-${"b".repeat(64)}`,
    blockId: "calibration-theron-ware",
    buildPath: join(experimentRoot, "build"),
    agentIds: ["agent-1", "agent-2", "agent-3"],
    stageCount: 6,
    variants: {
      stationary: `build-${"a".repeat(64)}`,
      rekey: BUILD_ID,
    },
  };
}

function buildManifest(resolved: ResolvedExperimentConfig): BuildManifest {
  return decodeBuildManifest({
    ...testBuildManifest(),
    blockId: resolved.puzzle.block,
  });
}

function currentInputs(manifest: BuildManifest): CurrentBuildInputs {
  return {
    blockId: manifest.blockId,
    source: manifest.source,
    references: manifest.references,
    seed: manifest.seed,
    window: manifest.window,
    boundaryStage: manifest.boundaryStage,
  };
}

async function publishFixtureAttempt(
  request: ExperimentRunRequest,
  build: BuildPuzzleResult,
  state: "finished" | "infrastructure-error" = "finished",
): Promise<AttemptSummary> {
  await mkdir(request.output, { recursive: true });
  const attemptId = `attempt-${request.runName}-${String(request.repetition)}`;
  const agentIds = Object.keys(request.agents).sort() as Array<keyof typeof request.agents>;
  const summary: AttemptSummary = {
    schemaVersion: 2,
    attemptId,
    buildId: build.variants.rekey,
    buildRoot: build.buildPath,
    agentIds,
    tracePath: join(request.output, "trace.jsonl"),
    traceMetadataPath: join(request.output, "trace.meta.json"),
    frozenRoot: join(request.output, "frozen"),
    sandbox: {
      imageTag: SANDBOX_IMAGE_TAG,
      imageId: `sha256:${"c".repeat(64)}`,
      sourceDigest: DIGEST,
      profileVersion: 1,
      ...SANDBOX_POLICY,
    },
    sessions: agentIds.map((agentId, index) => ({
      agentId,
      model: request.agents[agentId]!.model,
      state: index === 0 ? state : "finished",
      inputTokens: 1,
      outputTokens: 1,
      activityCursor: 0,
      terminationReason:
        index === 0 && state === "infrastructure-error" ? "fixture failure" : "done",
    })),
  };
  await publishAttemptSummary(request.output, summary);
  return summary;
}

describe("experiment orchestration", () => {
  it("composes one configured run and accepts a current reusable build", () => {
    const resolved = config();
    const models: string[] = [];
    const agents = createConfiguredRunAgents(resolved, resolved.runs[1]!, {
      env: {
        RESEARCH_KEY: "secret-canary-openai",
        SECOND_KEY: "secret-canary-anthropic",
      },
      createAdapter: (options) => {
        models.push(options.model);
        return adapter();
      },
    });

    expect(models).toEqual(["model-one", "model-two"]);
    expect(agents["agent-1"]!.model.profile).toBe("one");
    expect(agents["agent-2"]!.model.profile).toBe("two");
    expect(agents["agent-3"]!.model.profile).toBe("one");
    const manifest = buildManifest(resolved);
    expect(() =>
      assertBuildMatchesExperimentConfig(manifest, resolved, currentInputs(manifest)),
    ).not.toThrow();
  });

  it.each([
    ["block", { blockId: "validation-odd-women" }],
    ["source", { source: { sourceId: "theron-ware", sha256: "0".repeat(64) } }],
    ["references", { references: [{ sourceId: "middlemarch", sha256: "0".repeat(64) }] }],
    ["seed", { seed: 42 }],
    ["window", { window: { ...buildManifest(config()).window, sha256: "0".repeat(64) } }],
  ] satisfies readonly [string, Partial<CurrentBuildInputs>][])(
    "rejects a reusable build with stale %s inputs",
    (_name, stale) => {
      const resolved = config();
      const manifest = buildManifest(resolved);
      expect(() =>
        assertBuildMatchesExperimentConfig(manifest, resolved, {
          ...currentInputs(manifest),
          ...stale,
        }),
      ).toThrow(/does not match/);
    },
  );

  it("preflights all runs, builds once, and executes every repetition sequentially", async () => {
    const root = await temporaryRoot();
    const experimentRoot = join(root, "research");
    const events: string[] = [];
    const resolved = config();
    const build = buildResult(experimentRoot);
    let activeAttempt = false;

    const summary = await runExperiment({
      root,
      configPath: "fixture.yaml",
      output: experimentRoot,
      env: {
        RESEARCH_KEY: "secret-canary-openai",
        SECOND_KEY: "secret-canary-anthropic",
      },
      dependencies: {
        loadConfig: async (_path, options) => {
          events.push(`load:${options?.selectedRun ?? "all"}`);
          return resolved;
        },
        createAdapter: (options) => {
          events.push(`adapter:${options.model}`);
          return adapter();
        },
        build: async (options) => {
          events.push("build");
          expect(options.output).toBe(build.buildPath);
          return build;
        },
        run: async (request) => {
          expect(activeAttempt).toBe(false);
          activeAttempt = true;
          events.push(`run:${request.runName}:${String(request.repetition)}`);
          const attempt = await publishFixtureAttempt(request, build);
          activeAttempt = false;
          return {
            attemptId: attempt.attemptId,
            attemptRoot: request.output,
            sessions: attempt.sessions,
          };
        },
      },
    });

    expect(events).toEqual([
      "load:all",
      "load:alpha",
      "load:beta",
      "adapter:model-one",
      "adapter:model-two",
      "build",
      "run:alpha:1",
      "run:alpha:2",
      "run:beta:1",
    ]);
    expect(summary.attempts.map(({ runName, repetition }) => ({ runName, repetition }))).toEqual([
      { runName: "alpha", repetition: 1 },
      { runName: "alpha", repetition: 2 },
      { runName: "beta", repetition: 1 },
    ]);
    const serialized = await readFile(join(experimentRoot, "experiment.json"), "utf8");
    expect(serialized).not.toContain("secret-canary");
    expect(JSON.parse(serialized)).toEqual(summary);
  });

  it("creates no output when credential preflight fails", async () => {
    const root = await temporaryRoot();
    const experimentRoot = join(root, "invalid");
    const resolved = config();
    let builds = 0;

    await expect(
      runExperiment({
        root,
        configPath: "fixture.yaml",
        output: experimentRoot,
        dependencies: {
          loadConfig: async (_path, options) => {
            if (options?.selectedRun === "beta") throw new Error("SECOND_KEY is missing.");
            return resolved;
          },
          createAdapter: adapter,
          build: async () => {
            builds += 1;
            return buildResult(experimentRoot);
          },
        },
      }),
    ).rejects.toThrow(/SECOND_KEY/);

    expect(builds).toBe(0);
    await expect(readFile(join(experimentRoot, "experiment.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not retry and retains the last published index after a later failure", async () => {
    const root = await temporaryRoot();
    const experimentRoot = join(root, "failure");
    const resolved = config();
    const build = buildResult(experimentRoot);
    let calls = 0;

    await expect(
      runExperiment({
        root,
        configPath: "fixture.yaml",
        output: experimentRoot,
        dependencies: {
          loadConfig: async () => resolved,
          createAdapter: adapter,
          build: async () => build,
          run: async (request) => {
            calls += 1;
            if (calls === 2) throw new Error("fixture command failed");
            const attempt = await publishFixtureAttempt(request, build);
            return {
              attemptId: attempt.attemptId,
              attemptRoot: request.output,
              sessions: attempt.sessions,
            };
          },
        },
      }),
    ).rejects.toThrow(/fixture command failed/);

    expect(calls).toBe(2);
    const published = JSON.parse(
      await readFile(join(experimentRoot, "experiment.json"), "utf8"),
    ) as { attempts: unknown[] };
    expect(published.attempts).toHaveLength(1);
  });

  it("indexes an infrastructure-error attempt, fails, and stops before the next repetition", async () => {
    const root = await temporaryRoot();
    const experimentRoot = join(root, "infrastructure");
    const resolved = config();
    const build = buildResult(experimentRoot);
    let calls = 0;

    await expect(
      runExperiment({
        root,
        configPath: "fixture.yaml",
        output: experimentRoot,
        dependencies: {
          loadConfig: async () => resolved,
          createAdapter: adapter,
          build: async () => build,
          run: async (request) => {
            calls += 1;
            const attempt = await publishFixtureAttempt(request, build, "infrastructure-error");
            return {
              attemptId: attempt.attemptId,
              attemptRoot: request.output,
              sessions: attempt.sessions,
            };
          },
        },
      }),
    ).rejects.toThrow(/infrastructure failure.*alpha\/1/i);

    expect(calls).toBe(1);
    const published = JSON.parse(
      await readFile(join(experimentRoot, "experiment.json"), "utf8"),
    ) as { attempts: unknown[] };
    expect(published.attempts).toHaveLength(1);
  });

  it("indexes a durable attempt before rethrowing a later runner failure", async () => {
    const root = await temporaryRoot();
    const experimentRoot = join(root, "post-publication-failure");
    const resolved = config();
    const build = buildResult(experimentRoot);

    await expect(
      runExperiment({
        root,
        configPath: "fixture.yaml",
        output: experimentRoot,
        dependencies: {
          loadConfig: async () => resolved,
          createAdapter: adapter,
          build: async () => build,
          run: async (request) => {
            await publishFixtureAttempt(request, build);
            throw new Error("overlap command failed");
          },
        },
      }),
    ).rejects.toThrow(/overlap command failed/);

    const published = JSON.parse(
      await readFile(join(experimentRoot, "experiment.json"), "utf8"),
    ) as { attempts: Array<{ runName: string; repetition: number }> };
    expect(published.attempts.map(({ runName, repetition }) => ({ runName, repetition }))).toEqual([
      { runName: "alpha", repetition: 1 },
    ]);
  });
});
