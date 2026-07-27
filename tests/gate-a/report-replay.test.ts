import { existsSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { replayGateA } from "../../tools/gate-a/replay.js";

describe.runIf(existsSync("artifacts/gate-a/gate-report.json"))(
  "independent Gate A report replay",
  () => {
    test("resolves every frame and recomputes the retained decision", async () => {
      await expect(replayGateA()).resolves.toEqual({
        attemptCount: 630,
        maximumAdjacentPoints: 20,
        retainedGeometryId: "tokens-27000-vocab-8000",
        result: "pass",
      });
    }, 30_000);
  },
);
