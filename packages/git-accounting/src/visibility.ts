import { createHash } from "node:crypto";

import { FrameValidationError } from "./binary.js";
import { GIT_SHA256_OID_BYTES, type LogicalGitObject } from "./types.js";

function normalizeOidHex(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new FrameValidationError("oid", `Invalid Git SHA-256 OID: ${value}.`);
  }
  return value;
}

export class VisibilityJournal {
  readonly #oids: Set<string>;

  constructor(oids: Iterable<string> = []) {
    this.#oids = new Set(Array.from(oids, normalizeOidHex));
  }

  has(oid: Buffer | string): boolean {
    const value = Buffer.isBuffer(oid) ? oid.toString("hex") : oid;
    return this.#oids.has(normalizeOidHex(value));
  }

  values(): string[] {
    return [...this.#oids].sort();
  }

  digest(): string {
    const hash = createHash("sha256");
    hash.update(Buffer.from("PalimpsestVisibilityJournalV1\0", "ascii"));
    for (const oid of this.values()) {
      const bytes = Buffer.from(oid, "hex");
      if (bytes.length !== GIT_SHA256_OID_BYTES) {
        throw new FrameValidationError("oid", `Invalid journal OID width: ${oid}.`);
      }
      hash.update(bytes);
    }
    return hash.digest("hex");
  }

  withAcceptedObjects(objectGroups: Iterable<Iterable<LogicalGitObject>>): VisibilityJournal {
    const next = new Set(this.#oids);
    for (const objects of objectGroups) {
      for (const object of objects) {
        next.add(normalizeOidHex(object.oid.toString("hex")));
      }
    }
    return new VisibilityJournal(next);
  }
}
