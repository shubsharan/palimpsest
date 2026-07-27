import { describe, expect, test } from "vitest";

import {
  materializeAcrossGitStrategies,
  materializeBlobHistory,
} from "../../tools/gate-a/git-strategies.js";

describe("real-Git relay materialization", () => {
  test("reconstructs binary payloads and charges every logical transaction", async () => {
    const payload = Buffer.from(Array.from({ length: 1024 }, (_, index) => index % 256));
    const results = await materializeAcrossGitStrategies(payload);
    expect(results).toHaveLength(5);
    expect(results.every(({ exactReconstruction }) => exactReconstruction)).toBe(true);
    expect(results.every(({ cumulativeFrameBytes }) => cumulativeFrameBytes > payload.length)).toBe(
      true,
    );
    expect(results.map(({ transactionCount }) => transactionCount)).toEqual([1, 2, 4, 8, 1]);
  });

  test("captures logical-object deduplication when repeated chunks share one OID", async () => {
    const payload = Buffer.alloc(4096, 7);
    const [single, split] = await Promise.all([
      materializeBlobHistory(payload, 1),
      materializeBlobHistory(payload, 4),
    ]);
    expect(split.cumulativeFrameBytes).toBeLessThan(single.cumulativeFrameBytes);
  });
});
