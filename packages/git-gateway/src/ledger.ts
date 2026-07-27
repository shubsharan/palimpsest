import type { LedgerEntry } from "./types.js";

export class CumulativeLedger {
  readonly #entries: LedgerEntry[] = [];
  readonly #effects = new Map<string, LedgerEntry>();

  constructor(
    readonly runId: string,
    readonly agentId: string,
    readonly budgetBytes: number,
  ) {}

  get entries(): readonly LedgerEntry[] {
    return this.#entries;
  }

  get remainingBytes(): number {
    return this.#entries.at(-1)?.budgetAfter ?? this.budgetBytes;
  }

  reserve(transactionId: string, frameDigest: string, chargeBytes: number): LedgerEntry {
    const prior = this.#effects.get(transactionId);
    if (prior) {
      if (prior.frameDigest !== frameDigest || prior.chargeBytes !== chargeBytes) {
        throw new Error(`Conflicting duplicate Git transaction: ${transactionId}`);
      }
      return prior;
    }
    if (!Number.isSafeInteger(chargeBytes) || chargeBytes < 0) {
      throw new Error("Git accounting charge must be a nonnegative safe integer.");
    }
    const before = this.remainingBytes;
    const accepted = chargeBytes <= before;
    const entry: LedgerEntry = Object.freeze({
      schemaVersion: 1,
      contractId: "push-ledger-entry",
      runId: this.runId,
      agentId: this.agentId,
      transactionId,
      frameDigest,
      chargeBytes,
      budgetBefore: before,
      budgetAfter: accepted ? before - chargeBytes : before,
      result: accepted ? "accepted" : "rejected",
    });
    this.#effects.set(transactionId, entry);
    this.#entries.push(entry);
    return entry;
  }
}
