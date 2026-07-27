import { access } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { predeclarationDigest, validateGateReport } from "@palimpsest/contracts";

import { replayGateB } from "../../tools/gate-b/replay.js";
import { buildGateBPredeclaration } from "../../tools/gate-b/report.js";

describe("Gate B report replay", () => {
  it("keeps the predeclared projection digest stable", () => {
    const inputs = [{ artifactType: "input", byteLength: 1, sha256: "a".repeat(64) }];
    const report = buildGateBPredeclaration(inputs);
    expect(validateGateReport(report)).toMatchObject({ accepted: true });
    expect(report.predeclarationDigest).toBe(predeclarationDigest(report));
  });

  it("independently replays a completed report when one is present", async () => {
    const present = await access("artifacts/gate-b/gate-report.json")
      .then(() => true)
      .catch(() => false);
    if (!present) {
      return;
    }
    const result = await replayGateB();
    expect(result.scoreRowCount).toBe(44);
    expect(["pass", "rework", "stop"]).toContain(result.result);
  }, 60_000);
});
