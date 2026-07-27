import { describe, expect, test } from "vitest";

import { SnapshotStore, captureFetchSnapshot, publishSnapshot } from "../src/index.js";

describe("immutable publication snapshots", () => {
  test("captures one complete ref map for a connection", () => {
    const snapshot = publishSnapshot({
      runId: "run-1",
      ordinal: 1,
      refs: { "refs/heads/main": "a".repeat(64) },
      visibilityJournalDigest: "b".repeat(64),
      eventSequence: 4,
    });
    const store = new SnapshotStore();
    store.add(snapshot);
    const captured = captureFetchSnapshot(store.get(snapshot.snapshotId));
    snapshot.ordinal = 9;
    expect(captured.snapshot.ordinal).toBe(1);
    expect(() => store.add(captured.snapshot)).toThrow(/already exists/);
  });
});
