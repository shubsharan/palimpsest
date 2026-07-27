import { describe, expect, test } from "vitest";

import { CumulativeLedger } from "../src/ledger.js";
import { SnapshotStore, publishSnapshot } from "../src/publication.js";

describe("Git Gateway concurrency boundaries", () => {
  test("serializes competing reservations without overspending", async () => {
    const ledger = new CumulativeLedger("run-1", "agent-1", 10);
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => ledger.reserve("tx-1", "1".repeat(64), 7)),
      Promise.resolve().then(() => ledger.reserve("tx-2", "2".repeat(64), 7)),
    ]);
    expect([first.result, second.result].sort()).toEqual(["accepted", "rejected"]);
    expect(ledger.remainingBytes).toBe(3);
    expect(ledger.entries.map((entry) => entry.budgetAfter)).toEqual([3, 3]);
  });

  test("replays disconnect-after-admission idempotently and freezes entries", () => {
    const ledger = new CumulativeLedger("run-1", "agent-1", 10);
    const admitted = ledger.reserve("tx-1", "1".repeat(64), 4);
    expect(ledger.reserve("tx-1", "1".repeat(64), 4)).toBe(admitted);
    expect(() => {
      admitted.budgetAfter = 10;
    }).toThrow();
    expect(ledger.remainingBytes).toBe(6);
  });

  test("publishes independent branches as one immutable ref map digest", () => {
    const refs = {
      "refs/heads/agents/agent-1/work": "1".repeat(64),
      "refs/heads/agents/agent-2/work": "2".repeat(64),
    };
    const snapshot = publishSnapshot({
      runId: "run-1",
      ordinal: 1,
      refs,
      visibilityJournalDigest: "3".repeat(64),
      eventSequence: 4,
    });
    const store = new SnapshotStore();
    store.add(snapshot);
    refs["refs/heads/agents/agent-1/work"] = "4".repeat(64);
    expect(store.get(snapshot.snapshotId)).toEqual(snapshot);
  });
});
