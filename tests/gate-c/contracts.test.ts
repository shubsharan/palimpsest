import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { validateFixture, validateValue } from "@palimpsest/contracts";

describe("Gate C contracts", () => {
  test.each([
    ["revision-instance", "artifacts/gate-c/calibration/private-instance.json"],
    ["reveal-plan", "artifacts/gate-c/calibration/reveal-plan.json"],
  ] as const)("accepts generated %s evidence", async (contractId, path) => {
    const value = JSON.parse(await readFile(path, "utf8"));
    expect(validateValue(contractId, value)).toMatchObject({
      accepted: true,
      pointer: null,
      reason: null,
    });
  });

  test("rejects an undeclared checkpoint field", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      contractId: "solver-checkpoint",
      attemptId: "gate-c/aaaaaaaa/run-1",
      ordinal: 1,
      revealOrdinal: 1,
      observedMonotonicMs: 1,
      responseId: "resp_1",
      previousResponseId: null,
      containerId: "cntr_1",
      mappings: [],
      switchHypotheses: [],
      reconstructionRefs: [],
      usage: { inputTokens: 1, outputTokens: 1, toolCalls: 0 },
      oracleSwitch: 3,
    });
    expect(validateFixture("solver-checkpoint", raw)).toMatchObject({
      accepted: false,
      pointer: "/oracleSwitch",
      reason: "unknown_field",
    });
  });
});
