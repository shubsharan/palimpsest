import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { completeGateReport, predeclarationDigest, validateGateReport } from "../src/index.js";

async function fixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/valid/${name}.json`, import.meta.url), "utf8"),
  );
}

describe("gate report state", () => {
  test("predeclared and completed fixtures preserve the same frozen projection", async () => {
    const predeclared = await fixture("gate-predeclared");
    const completed = await fixture("gate-completed");
    expect(predeclarationDigest(predeclared)).toBe(predeclared.predeclarationDigest);
    expect(predeclarationDigest(completed)).toBe(predeclared.predeclarationDigest);
    expect(validateGateReport(predeclared).accepted).toBe(true);
    expect(validateGateReport(completed).accepted).toBe(true);
  });

  test("completion carries the original declaration digest", async () => {
    const predeclared = await fixture("gate-predeclared");
    const completedFixture = await fixture("gate-completed");
    const completed = completeGateReport(predeclared, {
      environment: completedFixture.environment,
      producerVersions: completedFixture.producerVersions,
      rawArtifacts: completedFixture.rawArtifacts,
      analysis: completedFixture.analysis,
      result: completedFixture.result,
      followUp: completedFixture.followUp,
    });
    expect(completed.predeclarationDigest).toBe(predeclared.predeclarationDigest);
    expect(validateGateReport(completed).accepted).toBe(true);
  });

  test.each(["thresholds", "frozenInputs"] as const)(
    "tampering with %s is detected",
    async (field) => {
      const completed = await fixture("gate-completed");
      const tampered = structuredClone(completed);
      if (field === "thresholds") {
        (tampered.thresholds as Array<Record<string, unknown>>)[0]!.value = "1";
      } else {
        (tampered.frozenInputs as Array<Record<string, unknown>>)[0]!.sha256 = "e".repeat(64);
      }
      expect(validateGateReport(tampered)).toMatchObject({
        accepted: false,
        reason: "digest",
        pointer: "/predeclarationDigest",
      });
    },
  );
});
