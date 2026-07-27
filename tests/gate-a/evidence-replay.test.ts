import { describe, expect, test } from "vitest";

import { predeclarationDigest, validateGateReport } from "@palimpsest/contracts";

import { buildGateAPredeclaration } from "../../tools/gate-a/report.js";
import { timingCapacityResult } from "../../tools/gate-a/timing-capacity.js";

const artifact = (artifactType: string, fill: string) => ({
  artifactType,
  byteLength: 1,
  sha256: fill.repeat(64),
});

describe("Gate A frozen evidence", () => {
  test("accounts for all 120 binary publication-presence choices", () => {
    expect(timingCapacityResult()).toEqual({
      capacityBytes: "15",
      contractId: "timing-capacity-result",
      presenceBits: "120",
      residualBits: "0",
      runSeconds: 3600,
      schemaVersion: 1,
      slotCount: 120,
      slotSeconds: 30,
      totalBits: "120",
    });
  });

  test("binds every frozen input and rejects a threshold mutation", () => {
    const report = buildGateAPredeclaration([
      artifact("gate-a-input-manifest", "a"),
      artifact("gate-a-frozen-inputs", "b"),
      artifact("gate-a-contracts", "c"),
      artifact("gate-a-implementation", "d"),
    ]);
    expect(validateGateReport(report).accepted).toBe(true);
    const tampered = structuredClone(report);
    (tampered.thresholds as Array<Record<string, unknown>>)[2]!.value = "2";
    expect(predeclarationDigest(tampered)).not.toBe(report.predeclarationDigest);
    expect(validateGateReport(tampered)).toMatchObject({
      accepted: false,
      pointer: "/predeclarationDigest",
      reason: "digest",
    });
  });
});
