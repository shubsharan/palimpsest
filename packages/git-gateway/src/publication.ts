import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import type { PublishedSnapshot, RefMap } from "./types.js";

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

  add(snapshot: PublishedSnapshot): void {
    if (this.#snapshots.has(snapshot.snapshotId)) {
      throw new Error(`Published snapshot already exists: ${snapshot.snapshotId}`);
    }
    this.#snapshots.set(snapshot.snapshotId, structuredClone(snapshot));
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
}
