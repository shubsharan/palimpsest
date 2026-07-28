import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeAttemptSummary, publishAttemptSummary } from "./artifacts.js";
import { FixtureModelAdapter } from "./fixture.js";
import type { AgentId, ModelAdapter, ModelBinding } from "./model.js";
import type { PreflightReceipt } from "./preflight.js";
import { systemMonotonicClock } from "./reveal.js";
import {
  finalizeAttempt,
  runAttempt,
  runPuzzle,
  validateAttemptConfig,
  type AgentRuntimeBinding,
  type AttemptConfig,
} from "./run.js";
import {
  SandboxInfrastructureError,
  type AgentSandboxLease,
  type AgentSandboxLeaseRequest,
} from "./sandbox/contracts.js";
import { FakeCommandSandbox } from "./test-helpers.js";

const AGENTS = ["agent-1", "agent-2"] as const satisfies readonly AgentId[];
const BUILD_ID = `build-${"a".repeat(64)}`;

function model(profile: string, requestedModel = profile): ModelBinding {
  return {
    profile,
    provider: `${profile}-provider`,
    driver: "openai-compatible",
    requestedModel,
    settings: {},
    providerOptions: {},
  };
}

function runtimes(
  adapterFor: (agentId: AgentId) => ModelAdapter,
): Record<AgentId, AgentRuntimeBinding> {
  return Object.fromEntries(
    AGENTS.map((agentId, index) => [
      agentId,
      {
        model: model(index === 0 ? "model-a" : "model-b"),
        adapter: adapterFor(agentId),
      },
    ]),
  ) as Record<AgentId, AgentRuntimeBinding>;
}

class StalledLeaseSandbox extends FakeCommandSandbox {
  override async openAgentLease(request: AgentSandboxLeaseRequest): Promise<AgentSandboxLease> {
    this.leases.push(request);
    return new Promise((_, reject) => {
      const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (request.signal?.aborted) {
        abort();
        return;
      }
      request.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

async function fixtureConfig(root: string, wallTimeMs = 2_000): Promise<AttemptConfig> {
  const stageCount = 3;
  const agentStages = Object.fromEntries(
    await Promise.all(
      AGENTS.map(async (agentId) => {
        await mkdir(join(root, "source", agentId), { recursive: true });
        const paths = await Promise.all(
          Array.from({ length: stageCount }, async (_, index) => {
            const path = join(root, "source", agentId, `stage-${index + 1}.txt`);
            await writeFile(path, `${agentId}-${index + 1}\n`, { encoding: "utf8", flag: "wx" });
            return path;
          }),
        );
        return [agentId, paths] as const;
      }),
    ),
  ) as Record<AgentId, readonly string[]>;
  const reference = join(root, "reference");
  await writeFile(reference, "reference\n", "utf8");
  return {
    attemptId: "attempt-baseline-001",
    buildId: BUILD_ID,
    runName: "baseline",
    repetition: 1,
    artifactRoot: join(root, "attempt"),
    buildRoot: join(root, "build"),
    referenceCorpusPath: reference,
    agentIds: AGENTS,
    agentStages,
    stageCount,
    rekeyCount: 0,
    tokenBudgetPerAgent: 20,
    wallTimeMs,
    stageIntervalMs: 10,
  };
}

function finishAdapter(finalResponse = "done"): ModelAdapter {
  return {
    openSession: () => ({
      respond: async () => ({
        toolCalls: [],
        finalResponse,
        usage: { inputTokens: 2, outputTokens: 1 },
      }),
    }),
  };
}

describe("run coordinator", () => {
  it("rejects provider-backed sessions before output when preflight is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-missing-preflight-"));
    const output = join(root, "attempt");
    let opened = false;
    const agents = runtimes(() => ({
      openSession() {
        opened = true;
        return {
          respond: async () => ({
            toolCalls: [],
            finalResponse: "unexpected",
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
        };
      },
    }));

    await expect(
      runPuzzle({
        root,
        buildRoot: join(root, "unused-build"),
        output,
        runName: "provider",
        repetition: 1,
        agents,
        tokenBudgetPerAgent: 20,
        wallTimeMs: 2_000,
        sandbox: new FakeCommandSandbox(),
      }),
    ).rejects.toThrow(/preflight receipt is missing or invalid/i);
    expect(opened).toBe(false);
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("copies preflight provenance before opening provider-backed model sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-preflight-"));
    const config = await fixtureConfig(root);
    const preflight: PreflightReceipt = {
      schemaVersion: 1,
      testedCommit: "a".repeat(40),
      sourceClean: true,
      completedAt: "2026-07-28T12:00:00.000Z",
      sandbox: new FakeCommandSandbox().identity,
    };
    const adapter: ModelAdapter = {
      openSession() {
        return {
          async respond() {
            expect(
              JSON.parse(await readFile(join(config.artifactRoot, "preflight.json"), "utf8")),
            ).toEqual(preflight);
            return {
              toolCalls: [],
              finalResponse: "ready",
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        };
      },
    };

    await runAttempt({
      config,
      agents: runtimes(() => adapter),
      sandbox: new FakeCommandSandbox(),
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: systemMonotonicClock,
      preflight,
    });
  });

  it("accepts dynamic agent and stage geometry without interaction caps", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-config-"));
    const config = await fixtureConfig(root);

    expect(validateAttemptConfig(config)).toEqual(config);
    expect(config).not.toHaveProperty("maxTurns");
    expect(config).not.toHaveProperty("maxGitBytes");
  });

  it.each([
    ["tokenBudgetPerAgent", 0, "tokenBudgetPerAgent"],
    ["wallTimeMs", -1, "wallTimeMs"],
  ] as const)("rejects invalid %s", async (key, value, message) => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-config-invalid-"));
    const config = await fixtureConfig(root);
    expect(() => validateAttemptConfig({ ...config, [key]: value })).toThrow(message);
  });

  it("rejects mismatched agents and stages", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-config-geometry-"));
    const config = await fixtureConfig(root);
    expect(() =>
      validateAttemptConfig({
        ...config,
        agentStages: {
          ...config.agentStages,
          "agent-2": config.agentStages["agent-2"]!.slice(0, 2),
        },
      }),
    ).toThrow("exactly 3 stages");
    expect(() =>
      validateAttemptConfig({
        ...config,
        agentIds: ["agent-1", "agent-3"],
      }),
    ).toThrow("agentIds must be ordered canonically");
  });

  it("runs a mixed-model assignment and records configured bindings in the trace", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-mixed-model-"));
    const config = await fixtureConfig(root);
    const openedBy: string[] = [];
    const agents = runtimes((agentId) => ({
      openSession: () => {
        openedBy.push(agentId);
        return {
          respond: async () => ({
            toolCalls: [],
            finalResponse: `done by ${agentId}`,
            usage: { inputTokens: 2, outputTokens: 1 },
            responseIdentity: {
              actualProvider: `${agentId}-actual-provider`,
              actualModel: `${agentId}-actual-model`,
            },
          }),
        };
      },
    }));

    const sandbox = new FakeCommandSandbox();
    const result = await runAttempt({
      config,
      agents,
      sandbox,
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: systemMonotonicClock,
    });

    expect(openedBy.sort()).toEqual([...AGENTS]);
    expect(result.agentIds).toEqual(AGENTS);
    expect(
      result.sessions.map(({ agentId, model: binding }) => [agentId, binding.profile]),
    ).toEqual([
      ["agent-1", "model-a"],
      ["agent-2", "model-b"],
    ]);
    expect(result.sessions[1]?.model).toMatchObject({
      actualProvider: "agent-2-actual-provider",
      actualModel: "agent-2-actual-model",
    });
    expect(result.frozen.workspaces.map(({ agentId }) => agentId)).toEqual(AGENTS);

    const trace = (await readFile(result.tracePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string; data: unknown });
    expect(trace.find(({ kind }) => kind === "attempt.configured")?.data).toEqual({
      attemptId: config.attemptId,
      buildId: BUILD_ID,
      runName: "baseline",
      repetition: 1,
      tokenBudgetPerAgent: 20,
      wallTimeMs: 2_000,
      stageIntervalMs: 10,
      agentCount: 2,
      stageCount: 3,
      rekeyCount: 0,
      models: [
        { agentId: "agent-1", ...model("model-a") },
        { agentId: "agent-2", ...model("model-b") },
      ],
    });
    expect(sandbox.leases).toHaveLength(AGENTS.length);
    expect(sandbox.closedLeases).toBe(AGENTS.length);
    expect(new Set(sandbox.leases.map((request) => request.profile))).toEqual(new Set(["agent"]));
  });

  it("publishes first private evidence before opening each model session", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-initial-stage-"));
    const config = await fixtureConfig(root);
    const seen = new Map<string, string>();
    const agents = runtimes(() => ({
      openSession(context) {
        return {
          async respond(request) {
            const evidenceLine = (request.prompt ?? "")
              .split("\n")
              .find((line) => line.startsWith("Private evidence: "));
            if (!evidenceLine) throw new Error("Prompt omitted private evidence.");
            seen.set(context.agentId, evidenceLine.slice("Private evidence: ".length));
            return {
              toolCalls: [],
              finalResponse: "ready",
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        };
      },
    }));
    const result = await runAttempt({
      config,
      agents,
      sandbox: new FakeCommandSandbox(),
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: systemMonotonicClock,
    });

    expect([...seen.keys()].sort()).toEqual([...AGENTS]);
    for (const agentId of AGENTS) {
      expect(seen.get(agentId)).toBe("/evidence");
      expect(await readdir(join(config.artifactRoot, "private-evidence", agentId))).toContain(
        "stage-01-stage-1.txt",
      );
    }
    expect(result.sessions.every((session) => session.state === "finished")).toBe(true);
  });

  it("ends only active sessions when global wall time expires", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-wall-"));
    const config = await fixtureConfig(root, 80);
    const adapter = FixtureModelAdapter.repeatingWait();
    const result = await runAttempt({
      config,
      agents: runtimes(() => adapter),
      sandbox: new FakeCommandSandbox(),
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: systemMonotonicClock,
    });
    expect(result.sessions.every((session) => session.state === "time-exhausted")).toBe(true);
  });

  it("bounds initial lease setup by the global wall-time cutoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-lease-cutoff-"));
    const config = await fixtureConfig(root, 250);
    const sandbox = new StalledLeaseSandbox();
    const startedAt = performance.now();

    await expect(
      runAttempt({
        config,
        agents: runtimes(() => FixtureModelAdapter.repeatingWait()),
        sandbox,
        checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
        clock: systemMonotonicClock,
      }),
    ).rejects.toThrow("Attempt wall-time cutoff expired during agent sandbox setup.");

    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expect(sandbox.leases).toHaveLength(AGENTS.length);
    expect(
      sandbox.leases.every(
        (request) =>
          request.signal !== undefined &&
          request.timeoutMs > 0 &&
          request.timeoutMs <= config.wallTimeMs,
      ),
    ).toBe(true);
  });

  it("closes every lease when stage publication fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-stage-cleanup-"));
    const config = await fixtureConfig(root, 80);
    const agentStages = config.agentStages["agent-1"];
    const missingStage = agentStages?.[1];
    if (missingStage === undefined) throw new Error("Fixture omitted agent-1 stage 2.");
    await rm(missingStage);
    const sandbox = new FakeCommandSandbox();

    await expect(
      runAttempt({
        config,
        agents: runtimes(() => FixtureModelAdapter.repeatingWait()),
        sandbox,
        checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
        clock: systemMonotonicClock,
      }),
    ).rejects.toThrow();

    expect(sandbox.leases).toHaveLength(AGENTS.length);
    expect(sandbox.closedLeases).toBe(AGENTS.length);
  });

  it("freezes and publishes attempt v2 when a provider fails before opening a session", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-provider-failure-"));
    const config = await fixtureConfig(root);
    const agents = runtimes((agentId) =>
      agentId === "agent-1"
        ? {
            openSession() {
              throw new Error("provider unavailable");
            },
          }
        : finishAdapter(),
    );
    const result = await runAttempt({
      config,
      agents,
      sandbox: new FakeCommandSandbox(),
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: systemMonotonicClock,
    });

    expect(result.sessions[0]).toMatchObject({
      state: "infrastructure-error",
      terminationReason: "provider unavailable",
      model: model("model-a"),
    });
    expect(result.frozen.frozen).toBe(true);
    await expect(
      finalizeAttempt({
        attemptRoot: config.artifactRoot,
        buildRoot: config.buildRoot,
        result,
        publishSummary: publishAttemptSummary,
        observeOverlap: async () => ({
          findings: [],
          scan: {
            reachableObjectCount: 0,
            reachableBlobReferenceCount: 0,
            uniqueReachableBlobCount: 0,
            uniqueTextBlobCount: 0,
            repeatedTreeReferenceCount: 0,
            skippedNonTextBlobCount: 0,
          },
        }),
        appendTrace: async () => undefined,
      }),
    ).resolves.toEqual({
      findings: [],
      scan: {
        reachableObjectCount: 0,
        reachableBlobReferenceCount: 0,
        uniqueReachableBlobCount: 0,
        uniqueTextBlobCount: 0,
        repeatedTreeReferenceCount: 0,
        skippedNonTextBlobCount: 0,
      },
    });

    const summary = decodeAttemptSummary(
      JSON.parse(await readFile(join(config.artifactRoot, "attempt.json"), "utf8")),
    );
    expect(summary).toMatchObject({
      schemaVersion: 2,
      buildId: BUILD_ID,
      agentIds: AGENTS,
    });
    expect(summary.sessions[0]).toMatchObject({
      state: "infrastructure-error",
      model: model("model-a"),
    });
  });

  it("classifies command sandbox failures as session infrastructure errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-sandbox-failure-"));
    const config = await fixtureConfig(root);
    const adapter = new FixtureModelAdapter({
      "agent-1": [
        {
          toolCalls: [{ id: "command", name: "run_command", arguments: { command: "true" } }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ],
      "agent-2": [{ toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } }],
    });
    const sandbox = new FakeCommandSandbox(async () => {
      throw new SandboxInfrastructureError("Docker daemon unavailable.");
    });
    const result = await runAttempt({
      config,
      agents: runtimes(() => adapter),
      sandbox,
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: systemMonotonicClock,
    });

    expect(result.sessions.find((session) => session.agentId === "agent-1")).toMatchObject({
      state: "infrastructure-error",
      terminationReason: "Docker daemon unavailable.",
    });
  });
});
