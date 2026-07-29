import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { buildSandbox } from "./build.js";
import { runProcess } from "./process.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";
import { SANDBOX_IMAGE_TAG, type SandboxIdentity } from "./sandbox/contracts.js";

const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface PreflightReceipt {
  schemaVersion: 1;
  testedCommit: string;
  sourceClean: true;
  completedAt: string;
  sandbox: SandboxIdentity;
}

interface SourceState {
  testedCommit: string;
  sourceClean: boolean;
}

interface FixtureResult {
  status: string;
  sandbox: SandboxIdentity;
}

export interface PreflightDependencies {
  buildSandbox: (root: string) => Promise<SandboxIdentity>;
  runVerification: (root: string) => Promise<void>;
  runFixture: (root: string, output: string) => Promise<FixtureResult>;
  inspectSandbox: (root: string) => Promise<SandboxIdentity>;
  now: () => Date;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${name} must contain exactly ${sortedExpected.join(", ")}.`);
  }
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function decodeSandboxIdentity(value: unknown): SandboxIdentity {
  const sandbox = record(value, "Preflight sandbox");
  exactKeys(
    sandbox,
    ["imageTag", "imageId", "sourceDigest", "profileVersion"],
    "Preflight sandbox",
  );
  const imageTag = nonEmptyString(sandbox.imageTag, "Preflight sandbox imageTag");
  const imageId = nonEmptyString(sandbox.imageId, "Preflight sandbox imageId");
  const sourceDigest = nonEmptyString(sandbox.sourceDigest, "Preflight sandbox sourceDigest");
  if (imageTag !== SANDBOX_IMAGE_TAG) {
    throw new Error(`Preflight sandbox imageTag must be ${SANDBOX_IMAGE_TAG}.`);
  }
  if (!IMAGE_ID.test(imageId)) {
    throw new Error("Preflight sandbox imageId must be an immutable SHA-256 image ID.");
  }
  if (!SHA256.test(sourceDigest)) {
    throw new Error("Preflight sandbox sourceDigest must be a lowercase SHA-256 digest.");
  }
  if (sandbox.profileVersion !== 1) {
    throw new Error("Unsupported preflight sandbox profile version.");
  }
  return { imageTag, imageId, sourceDigest, profileVersion: 1 };
}

export function decodePreflightReceipt(value: unknown): PreflightReceipt {
  const receipt = record(value, "Preflight receipt");
  exactKeys(
    receipt,
    ["schemaVersion", "testedCommit", "sourceClean", "completedAt", "sandbox"],
    "Preflight receipt",
  );
  if (receipt.schemaVersion !== 1) {
    throw new Error("Unsupported preflight receipt schema version.");
  }
  const testedCommit = nonEmptyString(receipt.testedCommit, "Preflight testedCommit");
  if (!GIT_OBJECT_ID.test(testedCommit)) {
    throw new Error("Preflight testedCommit must be a lowercase Git object ID.");
  }
  if (receipt.sourceClean !== true) {
    throw new Error("Preflight sourceClean must be true.");
  }
  const completedAt = nonEmptyString(receipt.completedAt, "Preflight completedAt");
  if (!Number.isFinite(Date.parse(completedAt))) {
    throw new Error("Preflight completedAt must be an ISO 8601 timestamp.");
  }
  return {
    schemaVersion: 1,
    testedCommit,
    sourceClean: true,
    completedAt,
    sandbox: decodeSandboxIdentity(receipt.sandbox),
  };
}

async function runGit(root: string, args: readonly string[]): Promise<string> {
  const result = await runProcess("git", args, {
    cwd: root,
    env: {
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: process.env.PATH,
    },
  });
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new Error(
      `Git ${args[0] ?? "command"} failed: ${result.stderr.toString("utf8").trim() || "no error detail"}.`,
    );
  }
  return result.stdout.toString("utf8").trim();
}

export async function readSourceState(root = resolve(".")): Promise<SourceState> {
  const testedCommit = await runGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!GIT_OBJECT_ID.test(testedCommit)) {
    throw new Error("Git HEAD did not resolve to a lowercase commit object ID.");
  }
  const status = await runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  return { testedCommit, sourceClean: status.length === 0 };
}

function requireCleanSource(state: SourceState): void {
  if (!state.sourceClean) {
    throw new Error("Research preflight requires a clean committed source checkout.");
  }
}

export function preflightReceiptPath(root = resolve(".")): string {
  return join(resolve(root), "artifacts", "preflight.json");
}

export async function publishPreflightReceipt(
  destination: string,
  value: PreflightReceipt,
): Promise<void> {
  const receipt = decodePreflightReceipt(value);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readReceipt(path: string): Promise<PreflightReceipt> {
  try {
    return decodePreflightReceipt(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Research preflight receipt is missing or invalid: ${detail}`);
  }
}

async function makeTreeWritable(path: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await makeTreeWritable(child);
      } else if (!entry.isSymbolicLink()) {
        const metadata = await lstat(child);
        await chmod(child, metadata.mode | 0o200);
      }
    }),
  );
  const metadata = await lstat(path);
  await chmod(path, metadata.mode | 0o700);
}

async function removeTemporaryTree(path: string): Promise<void> {
  await makeTreeWritable(path);
  await rm(path, { recursive: true, force: true });
}

export async function readCurrentPreflight(root = resolve(".")): Promise<PreflightReceipt> {
  const receipt = await readReceipt(preflightReceiptPath(root));
  const source = await readSourceState(root);
  requireCleanSource(source);
  if (source.testedCommit !== receipt.testedCommit) {
    throw new Error(
      `Research preflight tested commit ${receipt.testedCommit} does not match current commit ${source.testedCommit}.`,
    );
  }
  return receipt;
}

export function assertPreflightSandbox(receipt: PreflightReceipt, actual: SandboxIdentity): void {
  const expected = receipt.sandbox;
  if (
    actual.imageTag !== expected.imageTag ||
    actual.imageId !== expected.imageId ||
    actual.sourceDigest !== expected.sourceDigest ||
    actual.profileVersion !== expected.profileVersion
  ) {
    throw new Error("Research preflight sandbox identity does not match the current sandbox.");
  }
}

async function runVerification(root: string): Promise<void> {
  const result = await runProcess("pnpm", ["verify"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new Error(
      `Full verification failed${result.signal === null ? ` with exit ${String(result.exitCode)}` : ` from ${result.signal}`}.`,
    );
  }
}

const DEFAULT_DEPENDENCIES: PreflightDependencies = {
  buildSandbox,
  runVerification,
  async runFixture(root, output) {
    const { runOfflinePuzzle } = await import("./offline.js");
    const result = await runOfflinePuzzle({ root, output, condition: "CR" });
    return { status: result.evaluation.status, sandbox: result.run.sandbox };
  },
  async inspectSandbox(root) {
    return (await createDockerCommandSandbox({ root })).identity;
  },
  now: () => new Date(),
};

export async function runPreflight(
  root = resolve("."),
  dependencies: PreflightDependencies = DEFAULT_DEPENDENCIES,
): Promise<PreflightReceipt> {
  const repositoryRoot = resolve(root);
  const destination = preflightReceiptPath(repositoryRoot);
  await rm(destination, { force: true });

  const sourceBefore = await readSourceState(repositoryRoot);
  requireCleanSource(sourceBefore);
  const sandbox = await dependencies.buildSandbox(repositoryRoot);
  await dependencies.runVerification(repositoryRoot);

  const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-preflight-"));
  let provisional: PreflightReceipt;
  try {
    const fixture = await dependencies.runFixture(
      repositoryRoot,
      join(temporaryRoot, "offline-fixture"),
    );
    if (fixture.status !== "scored") {
      throw new Error(`Research preflight fixture must score, received ${fixture.status}.`);
    }
    provisional = decodePreflightReceipt({
      schemaVersion: 1,
      testedCommit: sourceBefore.testedCommit,
      sourceClean: true,
      completedAt: dependencies.now().toISOString(),
      sandbox,
    });
    assertPreflightSandbox(provisional, fixture.sandbox);

    const sourceAfter = await readSourceState(repositoryRoot);
    requireCleanSource(sourceAfter);
    if (sourceAfter.testedCommit !== sourceBefore.testedCommit) {
      throw new Error("Research preflight source commit changed during verification.");
    }
    assertPreflightSandbox(provisional, await dependencies.inspectSandbox(repositoryRoot));
  } finally {
    await removeTemporaryTree(temporaryRoot);
  }
  await publishPreflightReceipt(destination, provisional);
  return provisional;
}
