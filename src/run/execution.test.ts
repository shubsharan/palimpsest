import { describe, expect, it } from "vitest";

import { generateAgentIds, type AgentId } from "../model/contracts.js";
import { validateRunExecutionConfig, type RunExecutionConfig } from "./execution.js";

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
});
