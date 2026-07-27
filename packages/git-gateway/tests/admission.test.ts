import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { sha256Hex } from "@palimpsest/contracts";
import {
  ACCOUNTING_VERSION,
  encodeGitAccountingFrame,
  gitAccountingCharge,
  gitObjectOid,
  gitObjectTypes,
  GIT_SHA256_OBJECT_FORMAT,
  refOperations,
  type GitAccountingFrameV1,
} from "@palimpsest/git-accounting";

import {
  InMemoryRefTransactionStore,
  SerializedAdmissionGateway,
  admitFrame,
} from "../src/admission.js";
import { CumulativeLedger } from "../src/ledger.js";

function frame(options: {
  agent?: number;
  oldOid?: string;
  newOid: string;
  refName?: string;
}): GitAccountingFrameV1 {
  return {
    accountingVersion: ACCOUNTING_VERSION,
    authenticatedAgent: options.agent ?? 1,
    objectFormat: GIT_SHA256_OBJECT_FORMAT,
    publicationSlot: 1,
    operation: options.oldOid ? refOperations.update : refOperations.create,
    refName: options.refName ?? "refs/heads/agents/agent-1/work",
    oldOid: Buffer.from(options.oldOid ?? "0".repeat(64), "hex"),
    newOid: Buffer.from(options.newOid, "hex"),
    objects: [],
  };
}

describe("cumulative communication ledger", () => {
  test("reserves exact charges and rejects one byte over budget", () => {
    const ledger = new CumulativeLedger("run-1", "agent-1", 10);
    expect(ledger.reserve("tx-1", "1".repeat(64), 10)).toMatchObject({
      result: "accepted",
      budgetAfter: 0,
    });
    expect(ledger.reserve("tx-2", "2".repeat(64), 1)).toMatchObject({
      result: "rejected",
      budgetAfter: 0,
    });
  });

  test("is idempotent only for byte-identical transaction effects", () => {
    const ledger = new CumulativeLedger("run-1", "agent-1", 10);
    const first = ledger.reserve("tx-1", "1".repeat(64), 5);
    expect(ledger.reserve("tx-1", "1".repeat(64), 5)).toBe(first);
    expect(() => ledger.reserve("tx-1", "2".repeat(64), 5)).toThrow(/Conflicting/);
  });

  test("holds reservations against remaining budget until finalization or abort", () => {
    const ledger = new CumulativeLedger("run-1", "agent-1", 10);
    expect(ledger.prepare("tx-1", "1".repeat(64), 7)).toMatchObject({
      status: "RESERVED",
      accepted: true,
    });
    expect(ledger.remainingBytes).toBe(3);
    expect(ledger.prepare("tx-2", "2".repeat(64), 4).accepted).toBe(false);
    expect(ledger.abort("tx-1")).toMatchObject({ result: "rejected", budgetAfter: 10 });
    expect(ledger.remainingBytes).toBe(10);
  });

  test.each([
    { currentOid: "2".repeat(64), result: "accepted", remainingBytes: 3 },
    { currentOid: null, result: "rejected", remainingBytes: 10 },
  ])("recovers a durable reservation from the authoritative ref outcome", async (expected) => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-ledger-"));
    try {
      const statePath = join(root, "ledger.json");
      const transition = {
        refName: "refs/heads/agents/agent-1/work",
        oldOid: null,
        newOid: "2".repeat(64),
      };
      const initial = new CumulativeLedger("run-1", "agent-1", 10, statePath);
      initial.prepare("tx-1", "1".repeat(64), 7, transition);

      const recovered = new CumulativeLedger("run-1", "agent-1", 10, statePath);
      const refs = new InMemoryRefTransactionStore(
        expected.currentOid ? { [transition.refName]: expected.currentOid } : {},
      );
      const gateway = new SerializedAdmissionGateway(
        refs,
        new Map([["agent-1", recovered]]),
        async () => {},
      );
      await expect(gateway.recoverPending()).resolves.toMatchObject([{ result: expected.result }]);
      expect(recovered.remainingBytes).toBe(expected.remainingBytes);
      expect(new CumulativeLedger("run-1", "agent-1", 10, statePath).entries).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serializes ref and ledger admission with exact sender attribution", async () => {
    const refs = new InMemoryRefTransactionStore();
    const ledger = new CumulativeLedger("run-1", "agent-1", 1_000);
    const gateway = new SerializedAdmissionGateway(
      refs,
      new Map([["agent-1", ledger]]),
      async () => {},
    );
    const agent = {
      agentId: "agent-1",
      refNamespace: "refs/heads/agents/agent-1" as const,
      authenticatedAgent: 1,
    };
    const firstFrame = frame({ newOid: "1".repeat(64) });
    const first = await gateway.admit({ agent, frame: firstFrame, transactionId: "tx-1" });
    expect(first).toMatchObject({ refCommitted: true, reservationStatus: "FINALIZED" });
    expect(await refs.snapshot()).toEqual({
      "refs/heads/agents/agent-1/work": "1".repeat(64),
    });

    const stale = frame({ newOid: "2".repeat(64) });
    await expect(gateway.admit({ agent, frame: stale, transactionId: "tx-2" })).rejects.toThrow(
      /stale/,
    );
    await expect(
      gateway.admit({
        agent,
        frame: frame({ agent: 2, oldOid: "1".repeat(64), newOid: "3".repeat(64) }),
        transactionId: "tx-3",
      }),
    ).rejects.toThrow(/sender attribution/);
    expect(ledger.entries).toHaveLength(1);
  });

  test("durably aborts a reservation when quarantined object import fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-ledger-prepare-"));
    try {
      const statePath = join(root, "ledger.json");
      const ledger = new CumulativeLedger("run-1", "agent-1", 1_000, statePath);
      const gateway = new SerializedAdmissionGateway(
        new InMemoryRefTransactionStore(),
        new Map([["agent-1", ledger]]),
        async () => {},
        async () => {
          throw new Error("object import failed");
        },
      );
      const agent = {
        agentId: "agent-1",
        refNamespace: "refs/heads/agents/agent-1" as const,
        authenticatedAgent: 1,
      };

      await expect(
        gateway.admit({
          agent,
          frame: frame({ newOid: "1".repeat(64) }),
          transactionId: "tx-prepare-failure",
        }),
      ).rejects.toThrow(/object import failed/);

      expect(ledger.pendingReservations).toEqual([]);
      expect(ledger.entries).toMatchObject([
        { transactionId: "tx-prepare-failure", result: "rejected", budgetAfter: 1_000 },
      ]);
      expect(
        new CumulativeLedger("run-1", "agent-1", 1_000, statePath).pendingReservations,
      ).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("admits a new deterministic frame identity after durable restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-ledger-restart-"));
    try {
      const statePath = join(root, "ledger.json");
      const agent = {
        agentId: "agent-1",
        refNamespace: "refs/heads/agents/agent-1" as const,
        authenticatedAgent: 1,
      };
      const firstFrame = frame({ newOid: "1".repeat(64) });
      const firstDigest = sha256Hex(encodeGitAccountingFrame(firstFrame));
      const refs = new InMemoryRefTransactionStore();
      const initial = new SerializedAdmissionGateway(
        refs,
        new Map([["agent-1", new CumulativeLedger("run-1", "agent-1", 10_000, statePath)]]),
        async () => {},
      );
      await initial.admit({
        agent,
        frame: firstFrame,
        transactionId: `agent-1-push-${firstDigest}`,
      });

      const secondFrame = frame({
        oldOid: "1".repeat(64),
        newOid: "2".repeat(64),
      });
      const secondDigest = sha256Hex(encodeGitAccountingFrame(secondFrame));
      const restartedLedger = new CumulativeLedger("run-1", "agent-1", 10_000, statePath);
      const restarted = new SerializedAdmissionGateway(
        refs,
        new Map([["agent-1", restartedLedger]]),
        async () => {},
      );
      await expect(
        restarted.admit({
          agent,
          frame: secondFrame,
          transactionId: `agent-1-push-${secondDigest}`,
        }),
      ).resolves.toMatchObject({ refCommitted: true, reservationStatus: "FINALIZED" });
      expect(restartedLedger.entries.map((entry) => entry.transactionId)).toEqual([
        `agent-1-push-${firstDigest}`,
        `agent-1-push-${secondDigest}`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("charges exact frames per sender and rejects duplicate logical objects", () => {
    const content = Buffer.from("shared hypothesis\n");
    const object = {
      content,
      oid: gitObjectOid(gitObjectTypes.blob, content),
      type: gitObjectTypes.blob,
    };
    const logicalFrame = { ...frame({ newOid: "1".repeat(64) }), objects: [object] };
    const charge = gitAccountingCharge(logicalFrame);
    expect(charge).toBe(encodeGitAccountingFrame(logicalFrame).byteLength);

    for (const [index, agentId] of ["agent-1", "agent-2"].entries()) {
      const refName = `refs/heads/agents/${agentId}/work`;
      const senderFrame = {
        ...logicalFrame,
        authenticatedAgent: index + 1,
        refName,
      };
      const ledger = new CumulativeLedger("run-1", agentId, charge);
      expect(
        admitFrame({
          agent: {
            agentId,
            refNamespace: `refs/heads/agents/${agentId}` as const,
            authenticatedAgent: index + 1,
          },
          frame: senderFrame,
          ledger,
          transactionId: `tx-${index + 1}`,
        }),
      ).toMatchObject({ result: "accepted", budgetAfter: 0 });
    }

    expect(() => encodeGitAccountingFrame({ ...logicalFrame, objects: [object, object] })).toThrow(
      /Duplicate object OIDs/,
    );
  });
});
