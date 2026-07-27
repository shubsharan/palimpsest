import type { LedgerEntry, LedgerReservation } from "./types.js";

export class CumulativeLedger {
  readonly #entries: LedgerEntry[] = [];
  readonly #effects = new Map<string, LedgerEntry>();
  readonly #reservations = new Map<string, LedgerReservation>();

  constructor(
    readonly runId: string,
    readonly agentId: string,
    readonly budgetBytes: number,
  ) {}

  get entries(): readonly LedgerEntry[] {
    return this.#entries;
  }

  get remainingBytes(): number {
    const committed = this.#entries
      .filter((entry) => entry.result === "accepted")
      .reduce((total, entry) => total + entry.chargeBytes, 0);
    const reserved = [...this.#reservations.values()]
      .filter((reservation) => reservation.status === "RESERVED" && reservation.accepted)
      .reduce((total, reservation) => total + reservation.chargeBytes, 0);
    return this.budgetBytes - committed - reserved;
  }

  get pendingReservations(): readonly LedgerReservation[] {
    return [...this.#reservations.values()]
      .filter((reservation) => reservation.status === "RESERVED")
      .map((reservation) => ({ ...reservation }));
  }

  prepare(transactionId: string, frameDigest: string, chargeBytes: number): LedgerReservation {
    const prior = this.#effects.get(transactionId);
    if (prior) {
      if (prior.frameDigest !== frameDigest || prior.chargeBytes !== chargeBytes) {
        throw new Error(`Conflicting duplicate Git transaction: ${transactionId}`);
      }
      return {
        transactionId,
        frameDigest,
        chargeBytes,
        budgetBefore: prior.budgetBefore,
        budgetAfter: prior.budgetAfter,
        accepted: prior.result === "accepted",
        status: prior.result === "accepted" ? "FINALIZED" : "ABORTED",
      };
    }
    const pending = this.#reservations.get(transactionId);
    if (pending) {
      if (pending.frameDigest !== frameDigest || pending.chargeBytes !== chargeBytes) {
        throw new Error(`Conflicting duplicate Git transaction: ${transactionId}`);
      }
      return { ...pending };
    }
    if (!Number.isSafeInteger(chargeBytes) || chargeBytes < 0) {
      throw new Error("Git accounting charge must be a nonnegative safe integer.");
    }
    const before = this.remainingBytes;
    const accepted = chargeBytes <= before;
    const reservation: LedgerReservation = {
      transactionId,
      frameDigest,
      chargeBytes,
      budgetBefore: before,
      budgetAfter: accepted ? before - chargeBytes : before,
      accepted,
      status: "RESERVED",
    };
    this.#reservations.set(transactionId, reservation);
    return { ...reservation };
  }

  finalize(transactionId: string): LedgerEntry {
    const prior = this.#effects.get(transactionId);
    if (prior) return prior;
    const reservation = this.#reservations.get(transactionId);
    if (!reservation) {
      throw new Error(`Unknown Git reservation: ${transactionId}`);
    }
    reservation.status = reservation.accepted ? "FINALIZED" : "ABORTED";
    const entry: LedgerEntry = Object.freeze({
      schemaVersion: 1,
      contractId: "push-ledger-entry",
      runId: this.runId,
      agentId: this.agentId,
      transactionId,
      frameDigest: reservation.frameDigest,
      chargeBytes: reservation.chargeBytes,
      budgetBefore: reservation.budgetBefore,
      budgetAfter: reservation.budgetAfter,
      result: reservation.accepted ? "accepted" : "rejected",
    });
    this.#effects.set(transactionId, entry);
    this.#entries.push(entry);
    this.#reservations.delete(transactionId);
    return entry;
  }

  abort(transactionId: string): LedgerEntry {
    const prior = this.#effects.get(transactionId);
    if (prior) return prior;
    const reservation = this.#reservations.get(transactionId);
    if (!reservation) throw new Error(`Unknown Git reservation: ${transactionId}`);
    reservation.accepted = false;
    reservation.budgetAfter = reservation.budgetBefore;
    reservation.status = "ABORTED";
    return this.finalize(transactionId);
  }

  reserve(transactionId: string, frameDigest: string, chargeBytes: number): LedgerEntry {
    this.prepare(transactionId, frameDigest, chargeBytes);
    return this.finalize(transactionId);
  }
}
