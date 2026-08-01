import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  generateAgentIds,
  type AgentId,
  type ModelAdapter,
  type ModelBinding,
} from "../model/contracts.js";
import { FakeCommandSandbox } from "../../tests/support/fake-command-sandbox.js";
import { removeTestRoot } from "../../tests/support/temp-root.js";
import { executeRun, validateRunExecutionConfig, type RunExecutionConfig } from "./execution.js";
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
    referenceCorpusPath: "/tmp/palimpsest/fixture/references",
    agentIds,
    agentStages: Object.fromEntries(
      agentIds.map((agentId) => [
        agentId,
        Array.from({ length: stageCount }, (_, index) => `/${agentId}/stage-${index + 1}.txt`),
      ]),
    ) as Record<AgentId, readonly string[]>,
    schedule: { releaseOffsetsMs: offsets, cutoffMs: offsets.at(-1)! + 1_000 },
    limits: { tokenLimitPerAgent: null, spendCeilingCents: 0 },
    capabilities: { git: "shared", teamRoom: "enabled" },
    labels: { cohort: "geometry" },
  };
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
      capabilities: { git: "isolated", teamRoom: "disabled" },
    } as const;
    expect(validateRunExecutionConfig(isolated)).toMatchObject({
      capabilities: { git: "isolated", teamRoom: "disabled" },
    });
    expect(() =>
      validateRunExecutionConfig({
        ...isolated,
        capabilities: { ...isolated.capabilities, teamRoom: "enabled" },
      }),
    ).toThrow(/isolated run cannot expose a shared team room/i);
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
      const buildRoot = join(root, "fixture");
      const referenceCorpusPath = join(buildRoot, "references");
      const artifactRoot = join(root, "run");
      const agentIds = generateAgentIds(2);
      await mkdir(referenceCorpusPath, { recursive: true });
      const agentStages = Object.fromEntries(
        await Promise.all(
          agentIds.map(async (agentId) => {
            const stages = [
              join(buildRoot, `${agentId}-stage-1.txt`),
              join(buildRoot, `${agentId}-stage-2.txt`),
            ];
            await Promise.all(
              stages.map((path, index) => writeFile(path, `stage ${String(index + 1)}\n`)),
            );
            return [agentId, stages] as const;
          }),
        ),
      ) as Record<AgentId, readonly string[]>;
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
      const clock: MonotonicClock = {
        nowMs: () => 0,
        waitUntil: (_deadlineMs, signal) =>
          new Promise((resolve) => {
            if (signal.aborted) {
              resolve(false);
              return;
            }
            signal.addEventListener("abort", () => resolve(false), { once: true });
          }),
      };

      const result = await executeRun({
        config: {
          ...config(2, 2),
          artifactRoot,
          buildRoot,
          referenceCorpusPath,
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

      expect(started).toEqual(new Set(agentIds));
      expect(result.sessions.map(({ state }) => state)).toEqual(["finished", "finished"]);
    } finally {
      await removeTestRoot(root);
    }
  });
});
