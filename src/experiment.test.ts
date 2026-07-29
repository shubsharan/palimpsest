import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  decodeAttemptSummary,
  decodeBuildManifest,
  publishAttemptSummary,
  type AttemptSummary,
  type BuildManifest,
  type BuildPuzzleResult,
} from "./artifacts.js";
import { hashProtocolSnapshot, resolveCondition } from "./condition.js";
import { type ResolvedExperimentConfig } from "./config.js";
import {
  assertBuildMatchesExperimentConfig,
  createConfiguredRunAgents,
  runExperiment,
  type ExperimentRunRequest,
} from "./experiment.js";
import type { ModelAdapter } from "./model.js";
import { testAttemptSummary, testBuildManifest } from "./test-helpers.js";

const BUILD_ID = `build-${"a".repeat(64)}`;
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
    puzzle: { block: "calibration-theron-ware" },
    limits: { tokenBudgetPerAgent: 1_000 },
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
    buildId: BUILD_ID,
    buildPath: join(experimentRoot, "build"),
    agentIds: ["agent-1", "agent-2", "agent-3"],
    stageCount: 6,
  };
}

function buildManifest(resolved: ResolvedExperimentConfig): BuildManifest {
  return decodeBuildManifest({
    ...testBuildManifest(),
    blockId: resolved.puzzle.block,
  });
}

async function publishFixtureAttempt(
  request: ExperimentRunRequest,
  build: BuildPuzzleResult,
  state: "finished" | "infrastructure-error" = "finished",
): Promise<AttemptSummary> {
  await mkdir(request.output, { recursive: true });
  const attemptId = `attempt-${request.runName}-${String(request.repetition)}`;
  const agentIds = Object.keys(request.agents).sort() as Array<keyof typeof request.agents>;
  const base = testAttemptSummary({ condition: request.condition });
  const condition = resolveCondition(request.condition);
  const protocol = {
    ...(base.protocol as Record<string, unknown>),
    buildId: build.buildId,
    tokenBudgetPerAgent: request.tokenBudgetPerAgent,
    models: agentIds.map((agentId) => ({
      agentId,
      model: request.agents[agentId]!.model,
    })),
  };
  const frozenRoot = join(request.output, "frozen");
  const summary = decodeAttemptSummary({
    ...base,
    attemptId,
    runName: request.runName,
    repetition: request.repetition,
    buildId: build.buildId,
    buildRoot: build.buildPath,
    agentIds,
    tokenBudgetPerAgent: request.tokenBudgetPerAgent,
    protocolDigest: hashProtocolSnapshot(protocol),
    protocol,
    tracePath: join(request.output, "trace.jsonl"),
    traceMetadataPath: join(request.output, "trace.meta.json"),
    frozen: {
      root: frozenRoot,
      communicationMode: condition.communicationMode,
      repositories:
        condition.communicationMode === "shared"
          ? [{ repositoryId: "shared", path: join(frozenRoot, "shared.git"), agentIds }]
          : agentIds.map((agentId) => ({
              repositoryId: agentId,
              path: join(frozenRoot, `${agentId}.git`),
              agentIds: [agentId],
            })),
      workspaces: agentIds.map((agentId) => ({
        agentId,
        path: join(frozenRoot, "workspaces", agentId),
        repositoryId: condition.communicationMode === "shared" ? "shared" : agentId,
      })),
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
  });
  await publishAttemptSummary(request.output, summary);
  return summary;
}

describe("experiment orchestration", () => {
  it("composes one configured run and rejects a mismatched reusable build", () => {
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
    expect(() =>
      assertBuildMatchesExperimentConfig(buildManifest(resolved), resolved),
    ).not.toThrow();
    expect(() =>
      assertBuildMatchesExperimentConfig(
        { ...buildManifest(resolved), blockId: "validation-odd-women" },
        resolved,
      ),
    ).toThrow(/does not match/);
  });

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
      condition: "CR",
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
        readBuildManifest: async () => buildManifest(resolved),
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
        condition: "CR",
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
          readBuildManifest: async () => buildManifest(resolved),
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
        condition: "CR",
        dependencies: {
          loadConfig: async () => resolved,
          createAdapter: adapter,
          build: async () => build,
          readBuildManifest: async () => buildManifest(resolved),
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
        condition: "CR",
        dependencies: {
          loadConfig: async () => resolved,
          createAdapter: adapter,
          build: async () => build,
          readBuildManifest: async () => buildManifest(resolved),
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
        condition: "CR",
        dependencies: {
          loadConfig: async () => resolved,
          createAdapter: adapter,
          build: async () => build,
          readBuildManifest: async () => buildManifest(resolved),
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
