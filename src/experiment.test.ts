import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ResolvedExperiment } from "./config.js";
import { runExperiment, runExperimentFromFlags } from "./experiment.js";
import type { FixturePackage } from "./fixture-package.js";
import type { AgentId, ModelAdapter, ModelBinding } from "./model.js";
import type { RunPreparedFixtureOptions, RunPreparedFixtureResult } from "./run.js";
import { FakeCommandSandbox } from "./test-helpers.js";

const agentIds = ["agent-1", "agent-2"] as const satisfies readonly AgentId[];
const binding: ModelBinding = {
  profile: "research",
  provider: "provider",
  driver: "openai-compatible",
  requestedModel: "model",
  settings: {},
  providerOptions: {},
};

function fixture(): FixturePackage {
  return {
    schemaVersion: 1,
    fixtureId: "fixture",
    contentDigest: "a".repeat(64),
    agentIds,
    stageCount: 1,
    variants: {
      stationary: {
        variantId: "stationary",
        rekeyFromStage: null,
        buildId: `build-${"b".repeat(64)}`,
        publicCiphertextPath: "variants/stationary/ciphertext.txt",
        publicCiphertextSha256: "e".repeat(64),
        referenceCorpusPath: "variants/stationary/references",
        referenceFiles: [
          {
            sourceId: "reference",
            sourceSha256: "f".repeat(64),
            path: "variants/stationary/references/reference.txt",
            byteLength: 1,
            sha256: "f".repeat(64),
          },
        ],
        stages: agentIds.map((agentId) => ({
          agentId,
          ordinal: 1,
          sourcePath: `variants/stationary/private/${agentId}/stage-01.txt`,
          sha256: "1".repeat(64),
        })),
      },
    },
  };
}

function experiment(packagePath: string): ResolvedExperiment {
  const run = (id: string) => ({
    id,
    fixture: { packagePath, variant: "stationary" },
    assignment: { "agent-1": "research", "agent-2": "research" },
    capabilities: { git: "shared" as const, teamRoom: "disabled" as const },
    schedule: { releaseOffsetsMs: [0], cutoffMs: 1_000 },
    limits: { tokenLimitPerAgent: null, spendCeilingCents: 10 },
    labels: { treatment: id },
  });
  return {
    schemaVersion: 1,
    providers: {
      provider: { driver: "openai-compatible", baseURL: "https://provider.invalid/v1" },
    },
    models: {
      research: {
        provider: "provider",
        model: "model",
        settings: {},
        providerOptions: {},
      },
    },
    totalSpendCeilingCents: 20,
    runs: [run("run-a"), run("run-b")],
    manifestDigest: "c".repeat(64),
  };
}

function adapter(): ModelAdapter {
  return {
    openSession: () => ({
      respond: async () => ({ toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } }),
    }),
  };
}

async function fakeResult(
  options: RunPreparedFixtureOptions,
  sandbox: FakeCommandSandbox,
): Promise<RunPreparedFixtureResult> {
  await mkdir(options.output, { recursive: true });
  const repository = {
    repositoryId: "shared" as const,
    path: join(options.output, "frozen", "shared.git"),
    agentIds,
  };
  return {
    runRoot: options.output,
    runId: options.runId,
    experimentId: options.experimentId,
    fixtureId: "fixture",
    fixtureDigest: "a".repeat(64),
    spendCeilingCents: options.spendCeilingCents,
    gitVisibility: options.gitVisibility,
    teamRoom: options.teamRoom,
    variantId: options.variantId,
    buildId: `build-${"b".repeat(64)}`,
    buildRoot: options.fixtureRoot,
    agentIds,
    releaseOffsetsMs: options.releaseOffsetsMs,
    cutoffMs: options.cutoffMs,
    tokenBudgetPerAgent: options.tokenBudgetPerAgent,
    labels: options.labels,
    sessions: agentIds.map((agentId) => ({
      agentId,
      model: binding,
      state: "finished" as const,
      inputTokens: 1,
      outputTokens: 1,
      activityCursor: 0,
      terminationReason: "voluntary final response",
    })),
    frozen: {
      frozen: true,
      root: join(options.output, "frozen"),
      communicationMode: "shared",
      repositories: [repository],
      workspaces: agentIds.map((agentId) => ({
        agentId,
        path: join(options.output, "frozen", "workspaces", agentId),
        repositoryId: "shared" as const,
      })),
      treeSeal: { schemaVersion: 1, digest: "d".repeat(64), fileCount: 1, byteCount: 1 },
    },
    tracePath: join(options.output, "trace.jsonl"),
    traceMetadataPath: join(options.output, "trace.meta.json"),
    sandbox: sandbox.identity,
  };
}

describe("experiment orchestration", () => {
  it("validates provider-free and checks spend authorization before adapters", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-experiment-"));
    const packagePath = join(root, "fixture");
    const sandbox = new FakeCommandSandbox();
    let adapterCalls = 0;
    let smokeCalls = 0;

    await expect(
      runExperiment({
        root,
        configPath: "manifest.yaml",
        output: "experiment",
        allowSpend: false,
        dependencies: {
          loadExperiment: async () => experiment(packagePath),
          loadFixture: async () => fixture(),
          createSandbox: async () => sandbox,
          run: async (options) => {
            smokeCalls += 1;
            return fakeResult(options, sandbox);
          },
          createAdapter: () => {
            adapterCalls += 1;
            return adapter();
          },
        },
      }),
    ).rejects.toThrow(/allow-spend true/i);
    expect(smokeCalls).toBe(1);
    expect(adapterCalls).toBe(0);
  });

  it("executes declared runs sequentially and publishes one record per run", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-experiment-"));
    const packagePath = join(root, "fixture");
    const sandbox = new FakeCommandSandbox();
    const calls: string[] = [];
    const records = await runExperiment({
      root,
      configPath: "manifest.yaml",
      output: "experiment",
      allowSpend: true,
      dependencies: {
        loadExperiment: async () => experiment(packagePath),
        loadFixture: async () => fixture(),
        createSandbox: async () => sandbox,
        createAdapter: () => adapter(),
        run: async (options) => {
          calls.push(options.runId);
          return fakeResult(options, sandbox);
        },
        evaluate: async () => [
          { repositoryId: "shared", agentIds, status: "not-runnable" as const },
        ],
      },
    });

    expect(calls).toEqual(["run-a-validation", "run-a", "run-b"]);
    expect(records.map(({ run }) => run.id)).toEqual(["run-a", "run-b"]);
    await expect(
      readFile(join(root, "experiment", "run-a", "run.json"), "utf8"),
    ).resolves.toContain('"id": "run-a"');
  });

  it("stops at the first failed run without replacement or retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-experiment-"));
    const packagePath = join(root, "fixture");
    const sandbox = new FakeCommandSandbox();
    const calls: string[] = [];
    await expect(
      runExperiment({
        root,
        configPath: "manifest.yaml",
        output: "experiment",
        allowSpend: true,
        dependencies: {
          loadExperiment: async () => experiment(packagePath),
          loadFixture: async () => fixture(),
          createSandbox: async () => sandbox,
          createAdapter: () => adapter(),
          run: async (options) => {
            calls.push(options.runId);
            if (options.runId === "run-a") throw new Error("run failed");
            return fakeResult(options, sandbox);
          },
        },
      }),
    ).rejects.toThrow("run failed");
    expect(calls).toEqual(["run-a-validation", "run-a"]);
  });

  it("requires an explicit boolean spend decision at the CLI", () => {
    expect(() =>
      runExperimentFromFlags(
        new Map([
          ["--config", "manifest.yaml"],
          ["--output", "experiment"],
        ]),
      ),
    ).toThrow(/allow-spend must be exactly true or false/i);
  });
});
