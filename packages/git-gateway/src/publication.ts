import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import type { PublishedSnapshot, RefMap, SnapshotView } from "./types.js";

export function publishSnapshot(options: {
  runId: string;
  ordinal: number;
  refs: RefMap;
  visibilityJournalDigest: string;
  eventSequence: number;
}): PublishedSnapshot {
  const refMapDigest = sha256Hex(canonicalJsonBytes(options.refs));
  return {
    schemaVersion: 1,
    contractId: "published-snapshot",
    runId: options.runId,
    snapshotId: `publication-${String(options.ordinal).padStart(3, "0")}`,
    ordinal: options.ordinal,
    refMapDigest,
    visibilityJournalDigest: options.visibilityJournalDigest,
    eventSequence: options.eventSequence,
  };
}

export class SnapshotStore {
  readonly #snapshots = new Map<string, PublishedSnapshot>();
  readonly #views = new Map<string, SnapshotView>();
  #latestOrdinal = -1;

  add(snapshot: PublishedSnapshot, view?: SnapshotView): void {
    if (this.#snapshots.has(snapshot.snapshotId)) {
      throw new Error(`Published snapshot already exists: ${snapshot.snapshotId}`);
    }
    if (snapshot.ordinal <= this.#latestOrdinal) {
      throw new Error("Published snapshot ordinals must increase monotonically.");
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
