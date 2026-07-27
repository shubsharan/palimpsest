import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import type { LedgerEntry, RefMap } from "./types.js";

const execFileAsync = promisify(execFile);

export async function createFreeze(options: {
  repository: string;
  bundlePath: string;
  runId: string;
  refs: RefMap;
  visibilityJournalDigest: string;
  ledgers: readonly LedgerEntry[];
  finalEventSequence: number;
  eventChainHead: string;
}): Promise<Record<string, unknown>> {
  await execFileAsync("git", [
    "-C",
    options.repository,
    "bundle",
    "create",
    options.bundlePath,
    "--all",
  ]);
  const bundle = await readFile(options.bundlePath);
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
