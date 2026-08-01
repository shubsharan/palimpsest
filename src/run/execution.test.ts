import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  generateAgentIds,
  type AgentId,
  type ModelAdapter,
  type ModelBinding,
} from "../model/contracts.js";
import { FakeCommandSandbox } from "../../tests/support/fake-command-sandbox.js";
import { removeTestRoot } from "../../tests/support/temp-root.js";
import {
  executeRun,
  validateRunExecutionConfig,
  type AgentRuntimeMap,
  type RunExecutionConfig,
} from "./execution.js";
import type { MonotonicClock } from "./releases.js";

function config(agentCount: number, stageCount: number): RunExecutionConfig {
  const agentIds = generateAgentIds(agentCount);
  const offsets = Array.from({ length: stageCount }, (_, index) => index * 1_000);
  return {
    runId: "run-fixture",
    experimentId: "experiment-fixture",
    fixtureId: "fixture",
    fixtureDigest: "a".repeat(64),
    variantId: "stationary",
    buildId: `build-${"b".repeat(64)}`,
    artifactRoot: "/tmp/palimpsest/run",
    buildRoot: "/tmp/palimpsest/fixture",
    agentIds,
    agentStages: Object.fromEntries(
      agentIds.map((agentId) => [
        agentId,
        Array.from({ length: stageCount }, (_, index) => `/${agentId}/stage-${index + 1}.txt`),
      ]),
    ) as Record<AgentId, readonly string[]>,
    schedule: { releaseOffsetsMs: offsets, cutoffMs: offsets.at(-1)! + 1_000 },
    limits: { tokenLimitPerAgent: null, spendCeilingCents: 0 },
    capabilities: { git: "shared", teamRoom: "enabled", checker: true },
    labels: { cohort: "geometry" },
  };
}

async function executionFixture(root: string, stageCount = 2) {
  const buildRoot = join(root, "fixture");
  const artifactRoot = join(root, "run");
  const agentIds = generateAgentIds(2);
  await mkdir(buildRoot, { recursive: true });
  const agentStages = Object.fromEntries(
    await Promise.all(
      agentIds.map(async (agentId) => {
        const stages = Array.from({ length: stageCount }, (_, index) =>
          join(buildRoot, `${agentId}-stage-${String(index + 1)}.txt`),
        );
        await Promise.all(
          stages.map((path, index) => writeFile(path, `stage ${String(index + 1)}\n`)),
        );
        return [agentId, stages] as const;
      }),
    ),
  ) as Record<AgentId, readonly string[]>;
  return { buildRoot, artifactRoot, agentIds, agentStages };
}

interface ClockWaiter {
  deadlineMs: number;
  signal: AbortSignal;
  onAbort: () => void;
  resolve: (reached: boolean) => void;
}

class ManualClock implements MonotonicClock {
  readonly deadlines: number[] = [];
  private currentMs = 0;
  private waiters: ClockWaiter[] = [];

  nowMs(): number {
    return this.currentMs;
  }

  waitUntil(deadlineMs: number, signal: AbortSignal): Promise<boolean> {
    this.deadlines.push(deadlineMs);
    if (signal.aborted) return Promise.resolve(false);
    if (deadlineMs <= this.currentMs) return Promise.resolve(true);
    return new Promise((resolve) => {
      let waiter: ClockWaiter;
      const onAbort = () => this.finish(waiter, false);
      waiter = { deadlineMs, signal, onAbort, resolve };
      this.waiters.push(waiter);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  advanceTo(deadlineMs: number): void {
    this.currentMs = Math.max(this.currentMs, deadlineMs);
    const ready = this.waiters.filter((waiter) => waiter.deadlineMs <= this.currentMs);
    for (const waiter of ready) {
      this.finish(waiter, true);
    }
  }

  private finish(waiter: ClockWaiter, reached: boolean): void {
    const index = this.waiters.indexOf(waiter);
    if (index === -1) return;
    this.waiters.splice(index, 1);
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.resolve(reached);
  }
}

describe("run execution configuration", () => {
  it.each([
    [2, 3],
    [4, 8],
  ])("accepts %i agents with %i declared stages", (agentCount, stageCount) => {
    const resolved = validateRunExecutionConfig(config(agentCount, stageCount));
    expect(resolved.agentIds).toHaveLength(agentCount);
    expect(resolved.schedule.releaseOffsetsMs).toHaveLength(stageCount);
  });

  it("keeps capabilities explicit instead of deriving named conditions", () => {
    const isolated = {
      ...config(2, 3),
      capabilities: { git: "isolated", teamRoom: "disabled", checker: true },
    } as const;
    expect(validateRunExecutionConfig(isolated)).toMatchObject({
      capabilities: { git: "isolated", teamRoom: "disabled", checker: true },
    });
    expect(() =>
      validateRunExecutionConfig({
        ...isolated,
        capabilities: { ...isolated.capabilities, teamRoom: "enabled" },
      }),
    ).toThrow(/isolated run cannot expose a shared team room/i);
  });

  it("requires checker wiring to match the declared capability", async () => {
    const enabled = config(2, 3);
    const disabled = {
      ...enabled,
      capabilities: { ...enabled.capabilities, checker: false },
    };

    await expect(
      executeRun({
        config: enabled,
        agents: {} as AgentRuntimeMap,
        sandbox: new FakeCommandSandbox(),
        clock: new ManualClock(),
      }),
    ).rejects.toThrow(/requires a checker hook/i);
    await expect(
      executeRun({
        config: disabled,
        agents: {} as AgentRuntimeMap,
        checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
        sandbox: new FakeCommandSandbox(),
        clock: new ManualClock(),
      }),
    ).rejects.toThrow(/cannot receive a checker hook/i);
  });

  it("records an external interruption without freezing a run", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-interrupted-run-"));
    try {
      const { buildRoot, artifactRoot, agentIds, agentStages } = await executionFixture(root);
      const controller = new AbortController();
      controller.abort("SIGINT");
      const binding: ModelBinding = {
        profile: "fixture",
        provider: "fixture",
        driver: "openai-compatible",
        requestedModel: "interruption-probe",
        settings: {},
        providerOptions: {},
      };
      const adapter: ModelAdapter = {
        openSession: () => ({
          respond: async () => ({ toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } }),
        }),
      };

      await expect(
        executeRun({
          config: { ...config(2, 2), artifactRoot, buildRoot, agentStages },
          agents: Object.fromEntries(
            agentIds.map((agentId) => [agentId, { model: binding, adapter }]),
          ) as Record<AgentId, { model: ModelBinding; adapter: ModelAdapter }>,
          checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
          sandbox: new FakeCommandSandbox(),
          clock: new ManualClock(),
          signal: controller.signal,
        }),
      ).rejects.toThrow("Experiment interrupted by external signal.");
      await expect(readFile(join(artifactRoot, "trace.jsonl"), "utf8")).resolves.toContain(
        '"kind":"infrastructure.error"',
      );
      await expect(readFile(join(artifactRoot, "frozen", "tree.json"), "utf8")).rejects.toThrow();
    } finally {
      await removeTestRoot(root);
    }
  });

  it("rejects schedule or assignment geometry that differs from the package", () => {
    expect(() =>
      validateRunExecutionConfig({
        ...config(2, 3),
        schedule: { releaseOffsetsMs: [0, 1_000], cutoffMs: 3_000 },
      }),
    ).toThrow(/exactly 3 stage offsets/i);
    expect(() =>
      validateRunExecutionConfig({
        ...config(2, 3),
        agentStages: { "agent-1": ["/one"], "agent-2": ["/one", "/two"] },
      }),
    ).toThrow(/same number of ordered stages/i);
  });

  it("starts every agent session before any session is allowed to finish", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-concurrent-sessions-"));
    try {
      const { buildRoot, artifactRoot, agentIds, agentStages } = await executionFixture(root);
      const started = new Set<AgentId>();
      let releaseAgents: (() => void) | undefined;
      const allAgentsStarted = new Promise<void>((resolve) => {
        releaseAgents = resolve;
      });
      const binding: ModelBinding = {
        profile: "fixture",
        provider: "fixture",
        driver: "openai-compatible",
        requestedModel: "concurrency-probe",
        settings: {},
        providerOptions: {},
      };
      const adapter = (agentId: AgentId): ModelAdapter => ({
        openSession: () => ({
          respond: async () => {
            started.add(agentId);
            if (started.size === agentIds.length) {
              releaseAgents?.();
            }
            await allAgentsStarted;
            return {
              toolCalls: [],
              finalResponse: "finished",
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          },
        }),
      });
      const clock = new ManualClock();

      const execution = executeRun({
        config: {
          ...config(2, 2),
          artifactRoot,
          buildRoot,
          agentStages,
          schedule: { releaseOffsetsMs: [0, 1_000], cutoffMs: 2_000 },
        },
        agents: Object.fromEntries(
          agentIds.map((agentId) => [agentId, { model: binding, adapter: adapter(agentId) }]),
        ) as Record<AgentId, { model: ModelBinding; adapter: ModelAdapter }>,
        checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
        sandbox: new FakeCommandSandbox(),
        clock,
      });
      await allAgentsStarted;
      clock.advanceTo(1_000);
      const result = await execution;

      expect(started).toEqual(new Set(agentIds));
      expect(result.sessions.map(({ state }) => state)).toEqual(["finished", "finished"]);
    } finally {
      await removeTestRoot(root);
    }
  });

  it("completes the declared release schedule after every session finishes early", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-early-sessions-"));
    try {
      const { buildRoot, artifactRoot, agentIds, agentStages } = await executionFixture(root);
      const finished = new Set<AgentId>();
      const binding: ModelBinding = {
        profile: "fixture",
        provider: "fixture",
        driver: "openai-compatible",
        requestedModel: "early-finish-probe",
        settings: {},
        providerOptions: {},
      };
      const adapter = (agentId: AgentId): ModelAdapter => ({
        openSession: () => ({
          respond: async () => {
            finished.add(agentId);
            return {
              toolCalls: [],
              finalResponse: "finished",
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          },
        }),
      });
      const clock = new ManualClock();
      const execution = executeRun({
        config: {
          ...config(2, 2),
          artifactRoot,
          buildRoot,
          agentStages,
          schedule: { releaseOffsetsMs: [0, 1_000], cutoffMs: 2_000 },
        },
        agents: Object.fromEntries(
          agentIds.map((agentId) => [agentId, { model: binding, adapter: adapter(agentId) }]),
        ) as Record<AgentId, { model: ModelBinding; adapter: ModelAdapter }>,
        checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
        sandbox: new FakeCommandSandbox(),
        clock,
      });

      await vi.waitFor(() => expect(finished).toEqual(new Set(agentIds)));
      await vi.waitFor(() =>
        expect(clock.deadlines).toEqual(expect.arrayContaining([1_000, 2_000])),
      );
      expect(
        await Promise.race([execution.then(() => "settled"), Promise.resolve("pending")]),
      ).toBe("pending");

      clock.advanceTo(1_000);
      const result = await execution;

      expect(result.sessions.map(({ state }) => state)).toEqual(["finished", "finished"]);
      expect(result.releases.map(({ agentId, ordinal }) => [agentId, ordinal])).toEqual([
        ["agent-1", 1],
        ["agent-1", 2],
        ["agent-2", 1],
        ["agent-2", 2],
      ]);
    } finally {
      await removeTestRoot(root);
    }
  });
});
