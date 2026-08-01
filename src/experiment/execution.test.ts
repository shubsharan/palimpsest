import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ResolvedExperiment } from "./contracts.js";
import { runExperiment, runExperimentFromFlags } from "./execution.js";
import type { FixturePackage } from "../fixture/package.js";
import type { AgentId, ModelAdapter, ModelBinding } from "../model/contracts.js";
import type { RunPreparedFixtureOptions, RunPreparedFixtureResult } from "../run/execution.js";
import { FakeCommandSandbox } from "../../tests/support/fake-command-sandbox.js";
import { JsonlObservationLog } from "../trace.js";

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
    fixture: { packagePath: "fixtures/package", packageRoot: packagePath, variant: "stationary" },
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
  const trace = await JsonlObservationLog.create(join(options.output, "trace.jsonl"));
  await trace.append("run.frozen", { runId: options.runId });
  await trace.flush();
  const repository = {
    repositoryId: "shared" as const,
    path: join(options.output, "frozen", "shared.git"),
    agentIds,
  };
  const startedAt = new Date(0).toISOString();
  const frozenAt = new Date(1).toISOString();
  return {
    runRoot: options.output,
    startedAt,
    frozenAt,
    releases: agentIds.map((agentId) => ({
      agentId,
      ordinal: 1,
      variantId: options.variantId,
      releasedAt: startedAt,
      visiblePath: `private-evidence/${agentId}/stage-01.txt`,
      sha256: "1".repeat(64),
    })),
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
  it("rejects missing spend authorization before validation or adapters", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-experiment-"));
    const packagePath = join(root, "fixture");
    const sandbox = new FakeCommandSandbox();
    let loadCalls = 0;
    let fixtureCalls = 0;
    let sandboxCalls = 0;
    let adapterCalls = 0;
    let smokeCalls = 0;

    await expect(
      runExperiment({
        root,
        configPath: "manifest.yaml",
        output: "experiment",
        allowSpend: false,
        dependencies: {
          loadExperiment: async () => {
            loadCalls += 1;
            return experiment(packagePath);
          },
          loadFixture: async () => {
            fixtureCalls += 1;
            return fixture();
          },
          createSandbox: async () => {
            sandboxCalls += 1;
            return sandbox;
          },
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
    expect(loadCalls).toBe(0);
    expect(fixtureCalls).toBe(0);
    expect(sandboxCalls).toBe(0);
    expect(smokeCalls).toBe(0);
    expect(adapterCalls).toBe(0);
  });

  it("executes declared runs sequentially and publishes one record per run", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-experiment-"));
    const packagePath = join(root, "fixture");
    const secondPackagePath = join(root, "fixture-b");
    const sandbox = new FakeCommandSandbox();
    const calls: string[] = [];
    const fixtureLoads: string[] = [];
    let sandboxCalls = 0;
    const records = await runExperiment({
      root,
      configPath: "manifest.yaml",
      output: "experiment",
      allowSpend: true,
      dependencies: {
        loadExperiment: async () => {
          const value = experiment(packagePath);
          return {
            ...value,
            runs: [
              value.runs[0]!,
              {
                ...value.runs[1]!,
                fixture: {
                  ...value.runs[1]!.fixture,
                  packagePath: "fixtures/package-b",
                  packageRoot: secondPackagePath,
                },
              },
            ],
          };
        },
        loadFixture: async (path) => {
          fixtureLoads.push(path);
          return path === secondPackagePath
            ? { ...fixture(), fixtureId: "fixture-b", contentDigest: "2".repeat(64) }
            : fixture();
        },
        createSandbox: async () => {
          sandboxCalls += 1;
          return sandbox;
        },
        createAdapter: () => adapter(),
        run: async (options) => {
          calls.push(options.runId);
          return fakeResult(options, sandbox);
        },
        evaluate: async () => [
          {
            originId: "shared",
            agentIds,
            status: "not-runnable" as const,
            error: "solver unavailable",
          },
        ],
      },
    });

    expect(fixtureLoads).toEqual([packagePath, secondPackagePath]);
    expect(sandboxCalls).toBe(1);
    expect(calls).toEqual(["run-a-validation", "run-a", "run-b"]);
    expect(records.map(({ runId }) => runId)).toEqual(["run-a", "run-b"]);
    expect(records.map(({ configuration }) => configuration.validation.smoke.sourceRunId)).toEqual([
      "run-a",
      "run-a",
    ]);
    expect(records.map(({ configuration }) => configuration.validation.smoke.runId)).toEqual([
      "run-a-validation",
      "run-a-validation",
    ]);
    expect(records.map(({ configuration }) => configuration.validation.smoke.fixtureId)).toEqual([
      "fixture",
      "fixture",
    ]);
    expect(records.map(({ configuration }) => configuration.validation.fixture.fixtureId)).toEqual([
      "fixture",
      "fixture-b",
    ]);
    await expect(
      readFile(join(root, "experiment", "run-a", "run.json"), "utf8"),
    ).resolves.toContain('"id": "run-a"');
  });

  it("smoke-tests the selected run before opening a provider adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-experiment-"));
    const packagePath = join(root, "fixture");
    const sandbox = new FakeCommandSandbox();
    const calls: string[] = [];
    let adapterCalls = 0;

    await expect(
      runExperiment({
        root,
        configPath: "manifest.yaml",
        output: "experiment",
        runId: "run-b",
        allowSpend: true,
        dependencies: {
          loadExperiment: async () => experiment(packagePath),
          loadFixture: async () => fixture(),
          createSandbox: async () => sandbox,
          createAdapter: () => {
            adapterCalls += 1;
            return adapter();
          },
          run: async (options) => {
            calls.push(options.runId);
            throw new Error("selected smoke failed");
          },
        },
      }),
    ).rejects.toThrow("selected smoke failed");
    expect(calls).toEqual(["run-b-validation"]);
    expect(adapterCalls).toBe(0);
  });

  it.each(["manifest", "fixture", "sandbox", "smoke"] as const)(
    "does not construct adapters when %s validation fails",
    async (failure) => {
      const root = await mkdtemp(join(tmpdir(), "palimpsest-experiment-"));
      const packagePath = join(root, "fixture");
      const sandbox = new FakeCommandSandbox();
      let adapterCalls = 0;

      await expect(
        runExperiment({
          root,
          configPath: "manifest.yaml",
          output: "experiment",
          allowSpend: true,
          dependencies: {
            loadExperiment: async () => {
              if (failure === "manifest") throw new Error("manifest failed");
              return experiment(packagePath);
            },
            loadFixture: async () =>
              failure === "fixture" ? { ...fixture(), stageCount: 2 } : fixture(),
            createSandbox: async () => {
              if (failure === "sandbox") throw new Error("sandbox failed");
              return sandbox;
            },
            run: async (options) => {
              if (failure === "smoke") throw new Error("smoke failed");
              return fakeResult(options, sandbox);
            },
            createAdapter: () => {
              adapterCalls += 1;
              return adapter();
            },
          },
        }),
      ).rejects.toThrow();
      expect(adapterCalls).toBe(0);
    },
  );

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

  it("records a thrown evaluation failure without publishing or starting a later run", async () => {
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
            return fakeResult(options, sandbox);
          },
          evaluate: async () => {
            throw new Error("evaluation failed");
          },
        },
      }),
    ).rejects.toThrow("evaluation failed");
    expect(calls).toEqual(["run-a-validation", "run-a"]);
    await expect(readFile(join(root, "experiment", "run-a", "run.json"), "utf8")).rejects.toThrow();
    await expect(
      readFile(join(root, "experiment", "run-a", "trace.jsonl"), "utf8"),
    ).resolves.toContain('"kind":"infrastructure.error"');
  });

  it("publishes independent peer outcomes after one session infrastructure failure", async () => {
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
            const result = await fakeResult(options, sandbox);
            if (options.runId.endsWith("-validation")) return result;
            return {
              ...result,
              sessions: result.sessions.map((session, index) =>
                index === 0
                  ? {
                      ...session,
                      state: "infrastructure-error" as const,
                      terminationReason: "provider transport failed",
                    }
                  : session,
              ),
            };
          },
          evaluate: async () => [
            {
              originId: "shared",
              agentIds,
              status: "not-runnable" as const,
              error: "solver unavailable",
            },
          ],
        },
      }),
    ).rejects.toThrow(/run run-a ended with an infrastructure error/i);
    expect(calls).toEqual(["run-a-validation", "run-a"]);
    const published = JSON.parse(
      await readFile(join(root, "experiment", "run-a", "run.json"), "utf8"),
    ) as { status: string; sessions: { state: string }[] };
    expect(published.status).toBe("infrastructure-error");
    expect(published.sessions.map(({ state }) => state)).toEqual([
      "infrastructure-error",
      "finished",
    ]);
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

  it("rejects an external manifest before loading or provider setup", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-experiment-"));
    let loadCalls = 0;
    let adapterCalls = 0;

    await expect(
      runExperiment({
        root,
        configPath: "../manifest.yaml",
        output: "experiment",
        allowSpend: true,
        dependencies: {
          loadExperiment: async () => {
            loadCalls += 1;
            return experiment(join(root, "fixture"));
          },
          createAdapter: () => {
            adapterCalls += 1;
            return adapter();
          },
        },
      }),
    ).rejects.toThrow(/contained by the repository root/i);
    expect(loadCalls).toBe(0);
    expect(adapterCalls).toBe(0);
  });
});
