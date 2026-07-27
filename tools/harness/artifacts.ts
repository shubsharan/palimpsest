import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import { attemptPath, type HarnessAttemptIdentity } from "./config.js";

export type AttemptClassification = "completed" | "failed" | "invalid";
export type AttemptFailurePhase = "run" | "grade" | "replay" | "complete";

interface AttemptReceipt {
  schemaVersion: 1;
  attemptId: string;
  declarationDigest: string;
  runId: string;
  startedAt: string;
  phase: "running";
}

interface OutputEntry {
  path: string;
  byteLength: number;
  sha256: string;
}

export interface TerminalAttempt {
  schemaVersion: 1;
  attemptId: string;
  declarationDigest: string;
  runId: string;
  startedAt: string;
  classification: AttemptClassification;
  outputs: OutputEntry[];
}

interface AttemptFailure {
  schemaVersion: 1;
  declarationDigest: string;
  runId: string;
  phase: AttemptFailurePhase;
  errorName: string;
  message: string;
}

function attemptId(identity: HarnessAttemptIdentity): string {
  return `harness/${identity.declarationDigest}/${identity.runId}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  await writeFile(temporary, canonicalJsonBytes(value), { flag: "wx" });
  await rename(temporary, path);
}

async function outputPaths(root: string, current = root): Promise<string[]> {
  const paths: string[] = [];
  for (const name of (await readdir(current)).sort()) {
    if (current === root && name === "terminal.json") {
      continue;
    }
    const path = join(current, name);
    const metadata = await stat(path);
    if (metadata.isDirectory()) {
      paths.push(...(await outputPaths(root, path)));
    } else if (metadata.isFile()) {
      paths.push(relative(root, path).split(sep).join("/"));
    } else {
      throw new Error(`Attempt output is not a regular file or directory: ${path}`);
    }
  }
  return paths.sort();
}

async function outputEntries(root: string): Promise<OutputEntry[]> {
  return Promise.all(
    (await outputPaths(root)).map(async (path) => {
      const bytes = await readFile(join(root, path));
      return {
        path,
        byteLength: bytes.byteLength,
        sha256: sha256Hex(bytes),
      };
    }),
  );
}

async function writeCurrent(
  root: string,
  identity: HarnessAttemptIdentity,
  path: string,
  status: "running" | AttemptClassification,
): Promise<void> {
  await atomicJson(join(root, "current.json"), {
    schemaVersion: 1,
    attemptId: attemptId(identity),
    declarationDigest: identity.declarationDigest,
    runId: identity.runId,
    attemptPath: path,
    status,
    evidence: false,
  });
}

export async function createAttempt(options: {
  root: string;
  identity: HarnessAttemptIdentity;
  startedAt: string;
}): Promise<string> {
  const { root, identity, startedAt } = options;
  const path = attemptPath(root, identity);
  await mkdir(dirname(path), { recursive: true });
  await mkdir(path, { recursive: false });
  const receipt: AttemptReceipt = {
    schemaVersion: 1,
    attemptId: attemptId(identity),
    declarationDigest: identity.declarationDigest,
    runId: identity.runId,
    startedAt,
    phase: "running",
  };
  await writeFile(join(path, "attempt.json"), canonicalJsonBytes(receipt), { flag: "wx" });
  await writeCurrent(root, identity, path, "running");
  return path;
}

export async function sealAttempt(options: {
  root: string;
  identity: HarnessAttemptIdentity;
  classification: AttemptClassification;
}): Promise<TerminalAttempt> {
  const { root, identity, classification } = options;
  const path = attemptPath(root, identity);
  const terminalPath = join(path, "terminal.json");
  if (await pathExists(terminalPath)) {
    throw new Error(`Attempt already has a terminal manifest: ${terminalPath}`);
  }
  const receipt = JSON.parse(await readFile(join(path, "attempt.json"), "utf8")) as AttemptReceipt;
  if (
    receipt.attemptId !== attemptId(identity) ||
    receipt.declarationDigest !== identity.declarationDigest ||
    receipt.runId !== identity.runId
  ) {
    throw new Error("Attempt receipt identity does not match the explicit attempt.");
  }
  const terminal: TerminalAttempt = {
    schemaVersion: 1,
    attemptId: receipt.attemptId,
    declarationDigest: receipt.declarationDigest,
    runId: receipt.runId,
    startedAt: receipt.startedAt,
    classification,
    outputs: await outputEntries(path),
  };
  await atomicJson(terminalPath, terminal);
  await writeCurrent(root, identity, path, classification);
  return terminal;
}

function failureRecord(
  identity: HarnessAttemptIdentity,
  phase: AttemptFailurePhase,
  error: unknown,
): AttemptFailure {
  return {
    schemaVersion: 1,
    declarationDigest: identity.declarationDigest,
    runId: identity.runId,
    phase,
    errorName: error instanceof Error ? error.name : "NonErrorFailure",
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function sealFailedAttempt(options: {
  root: string;
  identity: HarnessAttemptIdentity;
  phase: AttemptFailurePhase;
  error: unknown;
}): Promise<TerminalAttempt> {
  const { root, identity, phase, error } = options;
  const path = attemptPath(root, identity);
  const terminalPath = join(path, "terminal.json");
  if (await pathExists(terminalPath)) {
    const terminal = await verifyTerminalAttempt({ root, identity });
    await writeCurrent(root, identity, path, terminal.classification);
    return terminal;
  }
  const failurePath = join(path, "failure.json");
  const failure = failureRecord(identity, phase, error);
  if (await pathExists(failurePath)) {
    const prior = JSON.parse(await readFile(failurePath, "utf8")) as unknown;
    if (!canonicalJsonBytes(prior).equals(canonicalJsonBytes(failure))) {
      throw new Error("Attempt failure evidence conflicts with the existing failure record.");
    }
  } else {
    await atomicJson(failurePath, failure);
  }
  return sealAttempt({ root, identity, classification: "failed" });
}

export async function sealCurrentAttemptFailure(options: {
  root: string;
  runId: string;
  phase: AttemptFailurePhase;
  error: unknown;
}): Promise<TerminalAttempt | null> {
  const { root, runId, phase, error } = options;
  const currentPath = join(root, "current.json");
  if (!(await pathExists(currentPath))) return null;
  const current = JSON.parse(await readFile(currentPath, "utf8")) as Record<string, unknown>;
  if (
    current.runId !== runId ||
    current.status !== "running" ||
    typeof current.declarationDigest !== "string" ||
    typeof current.attemptPath !== "string"
  ) {
    return null;
  }
  const identity = { declarationDigest: current.declarationDigest, runId };
  if (current.attemptPath !== attemptPath(root, identity)) {
    throw new Error("Current attempt pointer does not match its declaration-bound path.");
  }
  return sealFailedAttempt({
    root,
    identity,
    phase,
    error,
  });
}

export async function verifyTerminalAttempt(options: {
  root: string;
  identity: HarnessAttemptIdentity;
}): Promise<TerminalAttempt> {
  const { root, identity } = options;
  const path = attemptPath(root, identity);
  const terminal = JSON.parse(
    await readFile(join(path, "terminal.json"), "utf8"),
  ) as TerminalAttempt;
  if (
    terminal.attemptId !== attemptId(identity) ||
    terminal.declarationDigest !== identity.declarationDigest ||
    terminal.runId !== identity.runId
  ) {
    throw new Error("Terminal manifest identity does not match the explicit attempt.");
  }
  const actual = await outputEntries(path);
  if (!canonicalJsonBytes(actual).equals(canonicalJsonBytes(terminal.outputs))) {
    throw new Error("Attempt directory does not match the terminal exact output set.");
  }
  return terminal;
}
