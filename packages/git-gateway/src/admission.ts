import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  encodeGitAccountingFrame,
  gitAccountingCharge,
  type GitAccountingFrameV1,
} from "@palimpsest/git-accounting";
import { sha256Hex } from "@palimpsest/contracts";

import { CumulativeLedger } from "./ledger.js";
import { assertAuthorizedRef, assertFramePolicy } from "./policy.js";
import type {
  AdmissionResult,
  AuthenticatedAgent,
  LedgerEntry,
  RefMap,
  RefTransactionStore,
} from "./types.js";

const execFileAsync = promisify(execFile);

export function admitFrame(options: {
  agent: AuthenticatedAgent;
  frame: GitAccountingFrameV1;
  ledger: CumulativeLedger;
  transactionId: string;
}): LedgerEntry {
  assertAuthorizedRef(options.agent, options.frame.refName);
  if (
    options.agent.authenticatedAgent !== undefined &&
    options.frame.authenticatedAgent !== options.agent.authenticatedAgent
  ) {
    throw new Error("Git accounting sender attribution does not match authentication.");
  }
  const bytes = encodeGitAccountingFrame(options.frame);
  return options.ledger.reserve(
    options.transactionId,
    sha256Hex(bytes),
    gitAccountingCharge(options.frame),
  );
}

export class InMemoryRefTransactionStore implements RefTransactionStore {
  readonly #refs: RefMap;

  constructor(refs: RefMap = {}) {
    this.#refs = structuredClone(refs);
  }

  async snapshot(): Promise<RefMap> {
    return structuredClone(this.#refs);
  }

  async commit(refName: string, expectedOldOid: string | null, newOid: string): Promise<boolean> {
    if ((this.#refs[refName] ?? null) !== expectedOldOid) return false;
    this.#refs[refName] = newOid;
    return true;
  }
}

export class GitRefTransactionStore implements RefTransactionStore {
  constructor(readonly repository: string) {}

  async snapshot(): Promise<RefMap> {
    const { stdout } = await execFileAsync("git", [
      "-C",
      this.repository,
      "for-each-ref",
      "--format=%(refname) %(objectname)",
      "refs/heads",
    ]);
    return Object.fromEntries(
      stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf(" ");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
  }

  async commit(refName: string, expectedOldOid: string | null, newOid: string): Promise<boolean> {
    const before = await this.snapshot();
    if ((before[refName] ?? null) !== expectedOldOid) return false;
    await execFileAsync("git", [
      "-C",
      this.repository,
      "update-ref",
      refName,
      newOid,
      expectedOldOid ?? "0".repeat(64),
    ]);
    return true;
  }
}

export class SerializedAdmissionGateway {
  #tail: Promise<void> = Promise.resolve();

  constructor(
    readonly refs: RefTransactionStore,
    readonly ledgers: ReadonlyMap<string, CumulativeLedger>,
    readonly validateQuarantine: (frame: GitAccountingFrameV1) => Promise<void>,
  ) {}

  admit(options: {
    agent: AuthenticatedAgent;
    frame: GitAccountingFrameV1;
    transactionId: string;
  }): Promise<AdmissionResult> {
    const operation = this.#tail.then(() => this.#admitSerial(options));
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #admitSerial(options: {
    agent: AuthenticatedAgent;
    frame: GitAccountingFrameV1;
    transactionId: string;
  }): Promise<AdmissionResult> {
    const ledger = this.ledgers.get(options.agent.agentId);
    if (!ledger) throw new Error(`No communication ledger for ${options.agent.agentId}.`);
    const currentRefs = await this.refs.snapshot();
    assertFramePolicy({ agent: options.agent, frame: options.frame, currentRefs });
    await this.validateQuarantine(options.frame);
    const frameBytes = encodeGitAccountingFrame(options.frame);
    const reservation = ledger.prepare(
      options.transactionId,
      sha256Hex(frameBytes),
      gitAccountingCharge(options.frame),
    );
    if (!reservation.accepted) {
      return {
        entry: ledger.finalize(options.transactionId),
        refCommitted: false,
        reservationStatus: "ABORTED",
      };
    }
    const expectedOldOid = options.frame.oldOid.every((byte) => byte === 0)
      ? null
      : options.frame.oldOid.toString("hex");
    const newOid = options.frame.newOid.toString("hex");
    let committed: boolean;
    try {
      committed = await this.refs.commit(options.frame.refName, expectedOldOid, newOid);
    } catch (error) {
      const after = await this.refs.snapshot();
      if (after[options.frame.refName] === newOid) {
        return {
          entry: ledger.finalize(options.transactionId),
          refCommitted: true,
          reservationStatus: "FINALIZED",
        };
      }
      if ((after[options.frame.refName] ?? null) === expectedOldOid) {
        ledger.abort(options.transactionId);
      }
      throw error;
    }
    if (!committed) {
      return {
        entry: ledger.abort(options.transactionId),
        refCommitted: false,
        reservationStatus: "ABORTED",
      };
    }
    return {
      entry: ledger.finalize(options.transactionId),
      refCommitted: true,
      reservationStatus: "FINALIZED",
    };
  }
}
