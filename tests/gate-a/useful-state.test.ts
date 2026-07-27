import { describe, expect, test } from "vitest";

import { measureUsefulState } from "../../tools/gate-a/useful-state.js";

describe("faithful evolving belief workload", () => {
  test("materializes all four semantic checkpoints through competing encodings", async () => {
    const results = await measureUsefulState();
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.cumulativeCheckpointBytes).toHaveLength(4);
      expect(result.encodedByteLengths).toHaveLength(4);
      expect(result.frameDigests).toHaveLength(4);
      expect(result.cumulativeCheckpointBytes).toEqual(
        [...result.cumulativeCheckpointBytes].sort((left, right) => left - right),
      );
    }
    expect(Math.min(...results.map(({ cumulativeFrameBytes }) => cumulativeFrameBytes))).toBe(
      results.find(({ strategyId }) => strategyId === "field-table-deflate-9")!
        .cumulativeFrameBytes,
    );
  }, 30_000);
});
