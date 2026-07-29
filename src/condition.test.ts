import { describe, expect, it } from "vitest";

import {
  ATTEMPT_CUTOFF_MS,
  CONDITION_IDS,
  hashProtocolSnapshot,
  RELEASE_OFFSETS_MS,
  resolveCondition,
} from "./condition.js";

describe("condition", () => {
  it.each([
    ["CS", "shared", "stationary"],
    ["CR", "shared", "rekey"],
    ["IS", "isolated", "stationary"],
    ["IR", "isolated", "rekey"],
  ] as const)("resolves %s to its immutable treatment", (id, communicationMode, variantId) => {
    expect(resolveCondition(id)).toEqual({
      id,
      communicationMode,
      keyRegime: variantId,
      variantId,
    });
  });

  it.each([
    "cs",
    "Cr",
    "shared-stationary",
    "S",
    "CI",
    " CS",
    "CS ",
    "",
    null,
    4,
    { id: "CS", communicationMode: "isolated" },
  ])("rejects non-canonical condition input %j", (value) => {
    expect(() => resolveCondition(value)).toThrow(
      "Condition must be exactly one of CS, CR, IS, or IR.",
    );
  });

  it("owns the exact immutable release schedule and cutoff", () => {
    expect(CONDITION_IDS).toEqual(["CS", "CR", "IS", "IR"]);
    expect(RELEASE_OFFSETS_MS).toEqual([0, 300_000, 600_000, 1_200_000, 1_800_000, 2_400_000]);
    expect(ATTEMPT_CUTOFF_MS).toBe(3_600_000);
    expect(Object.isFrozen(CONDITION_IDS)).toBe(true);
    expect(Object.isFrozen(RELEASE_OFFSETS_MS)).toBe(true);
  });

  it("hashes JSON-compatible protocol snapshots with deterministic key ordering", () => {
    const snapshot = {
      schemaVersion: 1,
      blockId: "calibration-theron-ware",
      condition: "CR",
      prompts: ["agent-1 prompt", "agent-2 prompt", "agent-3 prompt"],
      schedule: {
        releaseOffsetsMs: RELEASE_OFFSETS_MS,
        cutoffMs: ATTEMPT_CUTOFF_MS,
      },
    };
    const reordered = {
      schedule: {
        cutoffMs: ATTEMPT_CUTOFF_MS,
        releaseOffsetsMs: RELEASE_OFFSETS_MS,
      },
      prompts: ["agent-1 prompt", "agent-2 prompt", "agent-3 prompt"],
      condition: "CR",
      blockId: "calibration-theron-ware",
      schemaVersion: 1,
    };

    expect(hashProtocolSnapshot(snapshot)).toBe(hashProtocolSnapshot(reordered));
    expect(hashProtocolSnapshot(snapshot)).toBe(
      "88de6dd7d463fb2e7d1773cbaecbd33dacb857eda6a748b59732c6ca83c76ab9",
    );
    expect(hashProtocolSnapshot({ ...snapshot, condition: "CS" })).not.toBe(
      hashProtocolSnapshot(snapshot),
    );
  });

  it.each([
    { unsupported: undefined },
    { unsupported: Number.NaN },
    { unsupported: Number.POSITIVE_INFINITY },
    { unsupported: 1n },
  ])("rejects non-JSON protocol input %#", (snapshot) => {
    expect(() => hashProtocolSnapshot(snapshot)).toThrow(
      "Protocol snapshot must contain only JSON-compatible values.",
    );
  });
});
