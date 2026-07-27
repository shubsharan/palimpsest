import { describe, expect, test } from "vitest";

import {
  ACCOUNTING_VERSION,
  GIT_SHA256_OBJECT_FORMAT,
  refOperations,
} from "@palimpsest/git-accounting";

import { InMemoryRefTransactionStore, SerializedAdmissionGateway } from "../src/admission.js";
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

  test("admits independent refs serially without imposing an agent order", async () => {
    const refs = new InMemoryRefTransactionStore();
    const ledgers = new Map(
      ["agent-1", "agent-2"].map((agentId) => [
        agentId,
        new CumulativeLedger("run-1", agentId, 1_000),
      ]),
    );
    const gateway = new SerializedAdmissionGateway(refs, ledgers, async () => {});
    const results = await Promise.all(
      ["agent-1", "agent-2"].map((agentId, index) =>
        gateway.admit({
          agent: {
            agentId,
            refNamespace: `refs/heads/agents/${agentId}` as const,
            authenticatedAgent: index + 1,
          },
          transactionId: `tx-${index + 1}`,
          frame: {
            accountingVersion: ACCOUNTING_VERSION,
            authenticatedAgent: index + 1,
            objectFormat: GIT_SHA256_OBJECT_FORMAT,
            publicationSlot: 1,
            operation: refOperations.create,
            refName: `refs/heads/agents/${agentId}/work`,
            oldOid: Buffer.alloc(32),
            newOid: Buffer.from(String(index + 1).repeat(64), "hex"),
            objects: [],
          },
        }),
      ),
    );
    expect(results.every((result) => result.refCommitted)).toBe(true);
    expect(Object.keys(await refs.snapshot()).sort()).toEqual([
      "refs/heads/agents/agent-1/work",
      "refs/heads/agents/agent-2/work",
    ]);
  });
});
