import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { canonicalJsonBytes } from "@palimpsest/contracts";

import type { LedgerEntry, LedgerReservation } from "./types.js";

interface LedgerState {
  schemaVersion: 1;
  runId: string;
  agentId: string;
  budgetBytes: number;
  entries: LedgerEntry[];
  reservations: LedgerReservation[];
}

export interface RefTransition {
  refName: string;
  oldOid: string | null;
  newOid: string;
}

export class CumulativeLedger {
  readonly #entries: LedgerEntry[] = [];
  readonly #effects = new Map<string, LedgerEntry>();
  readonly #reservations = new Map<string, LedgerReservation>();

  constructor(
    readonly runId: string,
    readonly agentId: string,
    readonly budgetBytes: number,
    readonly statePath?: string,
  ) {
    if (!statePath) return;
    if (existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as LedgerState;
      if (
        state.schemaVersion !== 1 ||
        state.runId !== runId ||
        state.agentId !== agentId ||
        state.budgetBytes !== budgetBytes
      ) {
        throw new Error(`Durable Git ledger identity mismatch: ${statePath}`);
      }
      for (const entry of state.entries) {
        this.#entries.push(Object.freeze(entry));
        this.#effects.set(entry.transactionId, this.#entries.at(-1)!);
      }
      for (const reservation of state.reservations) {
        this.#reservations.set(reservation.transactionId, reservation);
      }
      return;
    }
    this.#persist();
  }

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

  prepare(
    transactionId: string,
    frameDigest: string,
    chargeBytes: number,
    refTransition?: RefTransition,
  ): LedgerReservation {
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
        ...refTransition,
      };
    }
    const pending = this.#reservations.get(transactionId);
    if (pending) {
      if (pending.frameDigest !== frameDigest || pending.chargeBytes !== chargeBytes) {
        throw new Error(`Conflicting duplicate Git transaction: ${transactionId}`);
      }
      if (
        refTransition &&
        (pending.refName !== refTransition.refName ||
          pending.oldOid !== refTransition.oldOid ||
          pending.newOid !== refTransition.newOid)
      ) {
        throw new Error(`Conflicting duplicate Git ref transition: ${transactionId}`);
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
      ...refTransition,
    };
    this.#reservations.set(transactionId, reservation);
    this.#persist();
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
    this.#persist();
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

  recover(transactionId: string, currentOid: string | null): LedgerEntry {
    const reservation = this.#reservations.get(transactionId);
    if (!reservation) throw new Error(`Unknown Git reservation: ${transactionId}`);
    if (!reservation.refName || reservation.oldOid === undefined || !reservation.newOid) {
      throw new Error(`Git reservation lacks a recoverable ref transition: ${transactionId}`);
    }
    if (currentOid === reservation.newOid) return this.finalize(transactionId);
    if (currentOid === reservation.oldOid) return this.abort(transactionId);
    throw new Error(`Git reservation ref outcome is indeterminate: ${transactionId}`);
  }

  #persist(): void {
    if (!this.statePath) return;
    const state: LedgerState = {
      schemaVersion: 1,
      runId: this.runId,
      agentId: this.agentId,
      budgetBytes: this.budgetBytes,
      entries: [...this.#entries],
      reservations: [...this.#reservations.values()],
    };
    const temporary = `${this.statePath}.tmp-${process.pid}`;
    const handle = openSync(temporary, "w", 0o600);
    try {
      writeFileSync(handle, canonicalJsonBytes(state));
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporary, this.statePath);
    const directory = openSync(dirname(this.statePath), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
}
