import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import type { PublishedSnapshot, RefMap, SnapshotView } from "./types.js";

type PublishedSnapshotIdentity = Omit<PublishedSnapshot, "snapshotDigest">;

export function publishedSnapshotDigest(snapshot: PublishedSnapshotIdentity): string {
  return sha256Hex(canonicalJsonBytes(snapshot));
}

export function publishSnapshot(options: {
  runId: string;
  ordinal: number;
  refs: RefMap;
  predecessorSnapshotId?: string | null;
  visibilityJournalDigest: string;
  eventSequence: number;
}): PublishedSnapshot {
  if (!Number.isSafeInteger(options.ordinal) || options.ordinal < 1) {
    throw new Error("Published snapshot ordinal must be a positive safe integer.");
  }
  const predecessorSnapshotId = options.predecessorSnapshotId ?? null;
  if (options.ordinal === 1 && predecessorSnapshotId !== null) {
    throw new Error("The first published snapshot must not have a predecessor.");
  }
  if (options.ordinal > 1 && predecessorSnapshotId === null) {
    throw new Error("A later published snapshot must identify its predecessor.");
  }
  const refMapDigest = sha256Hex(canonicalJsonBytes(options.refs));
  const identity: PublishedSnapshotIdentity = {
    schemaVersion: 1,
    contractId: "published-snapshot",
    runId: options.runId,
    snapshotId: `publication-${String(options.ordinal).padStart(3, "0")}`,
    ordinal: options.ordinal,
    predecessorSnapshotId,
    refMapDigest,
    visibilityJournalDigest: options.visibilityJournalDigest,
    eventSequence: options.eventSequence,
  };
  return { ...identity, snapshotDigest: publishedSnapshotDigest(identity) };
}

export class SnapshotStore {
  readonly #snapshots = new Map<string, PublishedSnapshot>();
  readonly #views = new Map<string, SnapshotView>();
  #latestOrdinal = -1;

  add(snapshot: PublishedSnapshot, view?: SnapshotView): void {
    const { snapshotDigest, ...identity } = snapshot;
    if (publishedSnapshotDigest(identity) !== snapshotDigest) {
      throw new Error("Published snapshot identity does not match its snapshot digest.");
    }
    const expectedSnapshotId = `publication-${String(snapshot.ordinal).padStart(3, "0")}`;
    if (snapshot.snapshotId !== expectedSnapshotId) {
      throw new Error("Published snapshot ID does not match its ordinal.");
    }
    if (this.#snapshots.has(snapshot.snapshotId)) {
      throw new Error(`Published snapshot already exists: ${snapshot.snapshotId}`);
    }
    const latestSnapshot = [...this.#snapshots.values()].at(-1);
    const expectedOrdinal = this.#latestOrdinal < 0 ? 1 : this.#latestOrdinal + 1;
    if (snapshot.ordinal !== expectedOrdinal) {
      throw new Error("Published snapshot ordinals must be contiguous and start at one.");
    }
    const expectedPredecessor = latestSnapshot?.snapshotId ?? null;
    if (snapshot.predecessorSnapshotId !== expectedPredecessor) {
      throw new Error("Published snapshot predecessor does not match the latest snapshot.");
    }
    if (view) {
      const digest = sha256Hex(canonicalJsonBytes(view.refs));
      if (digest !== snapshot.refMapDigest) {
        throw new Error("Published snapshot view does not match its ref-map digest.");
      }
      for (const [refName, oid] of Object.entries(view.refs)) {
        if (!refName.startsWith("refs/heads/") || !/^[0-9a-f]{64}$/.test(oid)) {
          throw new Error(`Published snapshot contains an invalid ref: ${refName}.`);
        }
      }
      const allowed = [...new Set(view.allowedOids)].sort();
      if (allowed.some((oid) => !/^[0-9a-f]{64}$/.test(oid))) {
        throw new Error("Published snapshot contains an invalid allowed object.");
      }
      this.#views.set(snapshot.snapshotId, {
        refs: structuredClone(view.refs),
        allowedOids: allowed,
        ...(view.repository ? { repository: view.repository } : {}),
      });
    }
    this.#snapshots.set(snapshot.snapshotId, structuredClone(snapshot));
    this.#latestOrdinal = snapshot.ordinal;
  }

  get(snapshotId: string): PublishedSnapshot {
    const snapshot = this.#snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Unknown published snapshot: ${snapshotId}`);
    }
    return structuredClone(snapshot);
  }

  values(): PublishedSnapshot[] {
    return [...this.#snapshots.values()].map((snapshot) => structuredClone(snapshot));
  }

  view(snapshotId: string): SnapshotView {
    const view = this.#views.get(snapshotId);
    if (!view) throw new Error(`Published snapshot has no fetch view: ${snapshotId}`);
    return structuredClone(view);
  }
}
