import { describe, expect, it } from "vitest";

import { parseAttemptConfig, validateAttemptConfig } from "../src/config.js";

describe("attempt configuration", () => {
  const valid = {
    attemptId: "attempt-1",
    artifactRoot: "/tmp/palimpsest-attempt",
    buildPath: "/tmp/palimpsest-build/build.json",
    referenceCorpusPath: "/tmp/palimpsest-build/reference",
    agentStages: {
      "agent-1": Array.from({ length: 6 }, (_, index) => `/private/agent-1/stage-${index + 1}.txt`),
      "agent-2": Array.from({ length: 6 }, (_, index) => `/private/agent-2/stage-${index + 1}.txt`),
      "agent-3": Array.from({ length: 6 }, (_, index) => `/private/agent-3/stage-${index + 1}.txt`),
    },
    tokenBudgetPerAgent: 10_000,
    wallTimeMs: 120_000,
    stageIntervalMs: 1_000,
    shutdownToleranceMs: 5_000,
  };

  it("accepts exactly three agents with six stages each and no interaction caps", () => {
    const parsed = parseAttemptConfig(JSON.stringify(valid));
    expect(validateAttemptConfig(parsed)).toEqual(parsed);
    expect(parsed).not.toHaveProperty("maxTurns");
    expect(parsed).not.toHaveProperty("maxGitBytes");
  });

  it.each([
    [{ ...valid, tokenBudgetPerAgent: 0 }, "tokenBudgetPerAgent"],
    [{ ...valid, wallTimeMs: -1 }, "wallTimeMs"],
    [
      {
        ...valid,
        agentStages: { ...valid.agentStages, "agent-3": valid.agentStages["agent-3"].slice(0, 5) },
      },
      "six stages",
    ],
  ])("rejects invalid limits and geometry", (candidate, message) => {
    expect(() => validateAttemptConfig(candidate)).toThrow(message);
  });
});
