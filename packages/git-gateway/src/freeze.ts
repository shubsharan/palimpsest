import { execFile } from "node:child_process";
import { access, link, open, readFile, unlink } from "node:fs/promises";
import { promisify } from "node:util";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import type { LedgerEntry, RefMap } from "./types.js";

const execFileAsync = promisify(execFile);

export interface ReceiveToken {
  arrivalSequence: number;
  complete(): void;
}

export class PushAdmissionWindow {
  #open = true;
  #nextArrivalSequence = 1;
  #pending = 0;
  #drainWaiters: Array<() => void> = [];

  get isOpen(): boolean {
    return this.#open;
  }

  get pendingReceives(): number {
    return this.#pending;
  }

  beginReceive(): ReceiveToken {
    if (!this.#open) throw new Error("Git push admission is closed.");
    const arrivalSequence = this.#nextArrivalSequence++;
    this.#pending += 1;
    let completed = false;
    return {
      arrivalSequence,
      complete: () => {
        if (completed) throw new Error("Git receive token already completed.");
        completed = true;
        this.#pending -= 1;
        if (this.#pending === 0) {
          for (const resolve of this.#drainWaiters.splice(0)) resolve();
        }
      },
    };
  }

  close(): void {
    if (!this.#open) throw new Error("Git push admission is already closed.");
    this.#open = false;
  }

  async drain(timeoutMs: number): Promise<void> {
    if (this.#open) throw new Error("Git push admission must close before draining.");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Git receive drain timeout must be a positive safe integer.");
    }
    if (this.#pending === 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Git receive drain exceeded its deadline."));
      }, timeoutMs);
      this.#drainWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

async function repositoryRefs(repository: string): Promise<RefMap> {
  const { stdout } = await execFileAsync("git", [
    "-C",
    repository,
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

export async function createFreeze(options: {
  repository: string;
  bundlePath: string;
  runId: string;
  refs: RefMap;
  visibilityJournalDigest: string;
  ledgers: readonly LedgerEntry[];
  finalEventSequence: number;
  eventChainHead: string;
  admissionWindow?: PushAdmissionWindow;
  drainTimeoutMs?: number;
}): Promise<Record<string, unknown>> {
  if (options.admissionWindow) {
    if (options.admissionWindow.isOpen) options.admissionWindow.close();
    await options.admissionWindow.drain(options.drainTimeoutMs ?? 30_000);
  }
  if (options.ledgers.some((ledger) => ledger.result === "accepted" && ledger.budgetAfter < 0)) {
    throw new Error("Cannot freeze an overdrawn Git ledger.");
  }
  const actualRefs = await repositoryRefs(options.repository);
  if (!canonicalJsonBytes(actualRefs).equals(canonicalJsonBytes(options.refs))) {
    throw new Error("Cannot freeze: authoritative Git refs do not match the declared ref map.");
  }
  await access(options.bundlePath).then(
    () => {
      throw new Error("Freeze bundle path already exists.");
    },
    () => undefined,
  );
  const temporaryBundle = `${options.bundlePath}.tmp-${process.pid}-${Date.now()}`;
  let bundle: Buffer;
  try {
    await execFileAsync("git", [
      "-C",
      options.repository,
      "bundle",
      "create",
      temporaryBundle,
      ...Object.keys(options.refs).sort(),
    ]);
    bundle = await readFile(temporaryBundle);
    const handle = await open(temporaryBundle, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryBundle, options.bundlePath);
  } finally {
    await unlink(temporaryBundle).catch(() => undefined);
  }
  const refMapDigest = sha256Hex(canonicalJsonBytes(options.refs));
  return {
    schemaVersion: 1,
    contractId: "freeze-snapshot",
    runId: options.runId,
    freezeId: `freeze-${refMapDigest.slice(0, 16)}`,
    refMapDigest,
    gitBundle: {
      artifactType: "git-bundle",
      byteLength: bundle.byteLength,
      sha256: sha256Hex(bundle),
    },
    visibilityJournalDigest: options.visibilityJournalDigest,
    ledgerDigest: sha256Hex(canonicalJsonBytes(options.ledgers)),
    finalEventSequence: options.finalEventSequence,
    eventChainHead: options.eventChainHead,
  };
}
