import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { canonicalJsonBytes } from "@palimpsest/contracts";
import {
  releaseManifestSnapshotPath,
  type AgentBridgeEvent,
  type AgentInvocationRequest,
} from "@palimpsest/run-control";

import { FIXTURE_ADAPTER_ID } from "./config.js";

const execFileAsync = promisify(execFile);
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_BARRIER_POLL_INTERVAL_MS = 1_000;
const DEFAULT_BARRIER_TIMEOUT_MS = 60_000;

export const FIXTURE_READY_PATH_ENV = "PALIMPSEST_FIXTURE_READY_PATH";
export const FIXTURE_RELEASE_PATH_ENV = "PALIMPSEST_FIXTURE_RELEASE_PATH";
export const FIXTURE_BARRIER_TIMEOUT_ENV = "PALIMPSEST_FIXTURE_BARRIER_TIMEOUT_MS";
export const FIXTURE_INITIAL_PUSH_COMPLETE_PATH_ENV =
  "PALIMPSEST_FIXTURE_INITIAL_PUSH_COMPLETE_PATH";
export const FIXTURE_COLLABORATION_PATH_ENV = "PALIMPSEST_FIXTURE_COLLABORATION_PATH";
export const FIXTURE_FINAL_PUSH_COMPLETE_PATH_ENV = "PALIMPSEST_FIXTURE_FINAL_PUSH_COMPLETE_PATH";
export const FIXTURE_FINALIZATION_PATH_ENV = "PALIMPSEST_FIXTURE_FINALIZATION_PATH";
export const FIXTURE_GIT_CREDENTIAL_ENV = "PALIMPSEST_GIT_CREDENTIAL";

export interface FixtureGitAuthentication {
  environment: NodeJS.ProcessEnv;
}

interface ReleaseArtifact {
  byteLength: number;
  sha256: string;
}

interface ReleaseManifest {
  schemaVersion: 1;
  releaseOrdinal: number;
  chapterIndexes: number[];
  chapters: ReleaseArtifact[];
}

export interface ObservedRelease {
  releaseOrdinal: number;
  chapters: Array<{
    chapterIndex: number;
    byteLength: number;
    sha256: string;
  }>;
}

interface ReleaseObservationOptions {
  timeoutMs: number;
  pollIntervalMs?: number;
}

export function createFixtureGitAuthentication(options: {
  agentId: string;
  endpoint: string;
  environment: Record<string, string | undefined>;
}): FixtureGitAuthentication {
  const endpoint = new URL(options.endpoint);
  const secret = options.environment[FIXTURE_GIT_CREDENTIAL_ENV];
  if (
    !/^agent-[1-9][0-9]*$/.test(options.agentId) ||
    endpoint.protocol !== "http:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    !/^[A-Za-z0-9_-]{43}$/.test(secret ?? "")
  ) {
    throw new Error(
      "Fixture Git authentication requires a credential-free HTTP endpoint and secret.",
    );
  }
  const token = Buffer.from(`${options.agentId}:${secret}`, "utf8").toString("base64");
  return {
    environment: {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${token}`,
    },
  };
}

async function git(
  repository: string,
  args: string[],
  authentication?: FixtureGitAuthentication,
): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...(authentication ? { env: authentication.environment } : {}),
  });
  return stdout.trim();
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertPositiveDuration(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function waitForMarker(path: string, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!(await pathExists(path))) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new Error(`Fixture marker wait timed out after ${timeoutMs} ms: ${path}`);
    }
    await sleep(Math.min(DEFAULT_BARRIER_POLL_INTERVAL_MS, remaining));
  }
}

async function atomicReadyMarker(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.tmp`);
  try {
    await writeFile(temporary, "ready\n", { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function waitForFixtureLaunchBarrier(options: {
  readyPath: string;
  releasePath: string;
  timeoutMs: number;
  pollIntervalMs?: number;
}): Promise<void> {
  assertPositiveDuration(options.timeoutMs, "Fixture launch barrier timeout");
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_BARRIER_POLL_INTERVAL_MS;
  assertPositiveDuration(pollIntervalMs, "Fixture launch barrier poll interval");
  if (!options.readyPath || !options.releasePath || options.readyPath === options.releasePath) {
    throw new Error("Fixture launch barrier requires distinct readiness and release paths.");
  }

  await atomicReadyMarker(options.readyPath);
  const deadline = performance.now() + options.timeoutMs;
  while (!(await pathExists(options.releasePath))) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new Error(`Fixture launch barrier timed out after ${options.timeoutMs} ms.`);
    }
    await sleep(Math.min(pollIntervalMs, remaining));
  }
}

export async function waitForConfiguredFixtureLaunchBarrier(
  environment: Record<string, string | undefined>,
  defaultTimeoutMs = DEFAULT_BARRIER_TIMEOUT_MS,
): Promise<void> {
  const readyPath = environment[FIXTURE_READY_PATH_ENV];
  const releasePath = environment[FIXTURE_RELEASE_PATH_ENV];
  if (!readyPath && !releasePath) return;
  if (!readyPath || !releasePath) {
    throw new Error(
      `Fixture launch barrier requires both ${FIXTURE_READY_PATH_ENV} and ${FIXTURE_RELEASE_PATH_ENV}.`,
    );
  }
  const configuredTimeout = environment[FIXTURE_BARRIER_TIMEOUT_ENV];
  if (configuredTimeout !== undefined && !/^[1-9][0-9]*$/.test(configuredTimeout)) {
    throw new Error(`${FIXTURE_BARRIER_TIMEOUT_ENV} must be a positive decimal integer.`);
  }
  const timeoutMs = configuredTimeout === undefined ? defaultTimeoutMs : Number(configuredTimeout);
  await waitForFixtureLaunchBarrier({ readyPath, releasePath, timeoutMs });
}

function parseManifest(bytes: Buffer, expectedOrdinal?: number): ReleaseManifest {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Fixture observed a malformed release manifest.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Fixture observed a non-object release manifest.");
  }
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== 1 ||
    !Number.isSafeInteger(manifest.releaseOrdinal) ||
    (expectedOrdinal !== undefined && manifest.releaseOrdinal !== expectedOrdinal) ||
    !Array.isArray(manifest.chapterIndexes) ||
    !Array.isArray(manifest.chapters) ||
    manifest.chapterIndexes.length === 0 ||
    manifest.chapterIndexes.length !== manifest.chapters.length
  ) {
    throw new Error("Fixture observed invalid release manifest geometry.");
  }
  return value as ReleaseManifest;
}

async function observeRelease(
  currentManifestPath: string,
  ordinal: number,
): Promise<ObservedRelease> {
  const snapshot = parseManifest(
    await readFile(releaseManifestSnapshotPath(currentManifestPath, ordinal)),
    ordinal,
  );
  const chapters = await Promise.all(
    snapshot.chapterIndexes.map(async (chapterIndex, index) => {
      if (!Number.isSafeInteger(chapterIndex) || chapterIndex < 0) {
        throw new Error("Fixture observed an invalid release chapter index.");
      }
      const expected = snapshot.chapters[index] as ReleaseArtifact;
      if (
        !Number.isSafeInteger(expected?.byteLength) ||
        expected.byteLength < 0 ||
        typeof expected.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(expected.sha256)
      ) {
        throw new Error("Fixture observed invalid release chapter evidence.");
      }
      const bytes = await readFile(
        join(dirname(currentManifestPath), `${String(chapterIndex).padStart(3, "0")}.txt`),
      );
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== expected.byteLength || digest !== expected.sha256) {
        throw new Error(`Fixture observed a chapter digest mismatch at release ${ordinal}.`);
      }
      return { chapterIndex, byteLength: bytes.byteLength, sha256: digest };
    }),
  );
  return { releaseOrdinal: ordinal, chapters };
}

export async function observeReleaseOrdinal(
  currentManifestPath: string,
  ordinal: number,
  options: ReleaseObservationOptions,
): Promise<ObservedRelease> {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new Error("Release observation ordinal must be a positive safe integer.");
  }
  assertPositiveDuration(options.timeoutMs, "Fixture release observation timeout");
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  assertPositiveDuration(pollIntervalMs, "Fixture release observation poll interval");

  const deadline = performance.now() + options.timeoutMs;
  while (true) {
    try {
      const current = parseManifest(await readFile(currentManifestPath));
      if (current.releaseOrdinal > ordinal) {
        throw new Error(
          `Fixture cannot retrospectively observe release ${ordinal} after release ${current.releaseOrdinal}.`,
        );
      }
      if (current.releaseOrdinal === ordinal) {
        return await observeRelease(currentManifestPath, ordinal);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new Error(`Fixture release observation timed out after ${options.timeoutMs} ms.`);
    }
    await sleep(Math.min(pollIntervalMs, remaining));
  }
}

export async function observeReleasedInputs(
  currentManifestPath: string,
  options: ReleaseObservationOptions & {
    expectedReleaseCount: number;
  },
): Promise<ObservedRelease[]> {
  if (!Number.isSafeInteger(options.expectedReleaseCount) || options.expectedReleaseCount < 1) {
    throw new Error("Expected release count must be a positive safe integer.");
  }
  const observed: ObservedRelease[] = [];
  for (let ordinal = 1; ordinal <= options.expectedReleaseCount; ordinal += 1) {
    observed.push(await observeReleaseOrdinal(currentManifestPath, ordinal, options));
  }
  return observed;
}

export async function commitReleaseAnalysis(options: {
  repository: string;
  agentId: string;
  observedReleases: readonly ObservedRelease[];
  authentication?: FixtureGitAuthentication;
}): Promise<string> {
  const { repository, agentId, observedReleases, authentication } = options;
  if (
    observedReleases.length < 1 ||
    observedReleases.length > 2 ||
    observedReleases.some((release, index) => release.releaseOrdinal !== index + 1)
  ) {
    throw new Error("Fixture analysis requires a contiguous release history beginning at one.");
  }
  const revision = observedReleases.length === 2;
  const notesPath = join(repository, "notes", `${agentId}.md`);
  await mkdir(dirname(notesPath), { recursive: true });
  await writeFile(
    notesPath,
    [
      `# ${agentId} observable work`,
      "",
      ...observedReleases.flatMap((release) => [
        `## Release ${release.releaseOrdinal}`,
        "",
        `Observed evidence: ${JSON.stringify(release)}`,
        "",
        release.releaseOrdinal === 1
          ? "Initial hypothesis: the substitution is stable within the first released chapter."
          : "Revised hypothesis: the second release supports one change point; retain stable and revised mappings.",
        "",
      ]),
    ].join("\n"),
  );
  await git(repository, ["add", `notes/${agentId}.md`], authentication);
  await git(
    repository,
    [
      "commit",
      "--quiet",
      "-m",
      revision ? `${agentId} revise after second release` : `${agentId} analyze first release`,
    ],
    authentication,
  );
  return git(repository, ["rev-parse", "HEAD"], authentication);
}

async function main(): Promise<void> {
  await waitForConfiguredFixtureLaunchBarrier(process.env);
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error("Fixture worker requires an invocation request path.");
  }
  const request = JSON.parse(await readFile(requestPath, "utf8")) as AgentInvocationRequest;
  if (request.adapterId !== FIXTURE_ADAPTER_ID) {
    throw new Error(`Fixture worker refuses adapter ${request.adapterId}.`);
  }
  const authentication = createFixtureGitAuthentication({
    agentId: request.agentId,
    endpoint: request.gitEndpoint,
    environment: process.env,
  });
  let ordinal = 0;
  const emit = (type: AgentBridgeEvent["type"], payload: Record<string, unknown>) => {
    const event: AgentBridgeEvent = {
      schemaVersion: 1,
      runId: request.runId,
      agentId: request.agentId,
      invocationId: request.invocationId,
      ordinal: ++ordinal,
      type,
      payload,
    };
    process.stdout.write(`${canonicalJsonBytes(event).toString("utf8")}\n`);
  };

  const firstRelease = await observeReleaseOrdinal(request.releasedInputManifestPath, 1, {
    timeoutMs: request.monotonicDeadlineMs,
  });
  emit("file.read", {
    path: "input/released/release-manifest.json",
    releaseOrdinal: firstRelease.releaseOrdinal,
    chapters: firstRelease.chapters,
  });

  emit("tool.started", { tool: "git.clone" });
  const repository = join(request.workspacePath, "repository");
  await mkdir(request.workspacePath, { recursive: true });
  await execFileAsync("git", ["clone", "--quiet", request.gitEndpoint, repository], {
    env: authentication.environment,
  });
  await git(repository, ["config", "user.name", `Palimpsest ${request.agentId}`], authentication);
  await git(
    repository,
    ["config", "user.email", `${request.agentId}@palimpsest.invalid`],
    authentication,
  );
  await git(repository, ["switch", "--quiet", "-c", `${request.agentId}-work`], authentication);
  emit("git.clone", { repository: "workspace/repository" });

  const initialTip = await commitReleaseAnalysis({
    repository,
    agentId: request.agentId,
    observedReleases: [firstRelease],
    authentication,
  });
  emit("git.commit", { phase: "release-1", tip: initialTip });
  await git(
    repository,
    ["push", "--quiet", "origin", `HEAD:${request.gitRefNamespace}/work`],
    authentication,
  );
  emit("git.push", {
    phase: "release-1",
    ref: `${request.gitRefNamespace}/work`,
    tip: initialTip,
  });

  const initialPushCompletePath = process.env[FIXTURE_INITIAL_PUSH_COMPLETE_PATH_ENV];
  const collaborationPath = process.env[FIXTURE_COLLABORATION_PATH_ENV];
  const finalPushCompletePath = process.env[FIXTURE_FINAL_PUSH_COMPLETE_PATH_ENV];
  const finalizationPath = process.env[FIXTURE_FINALIZATION_PATH_ENV];
  if (
    !initialPushCompletePath ||
    !collaborationPath ||
    !finalPushCompletePath ||
    !finalizationPath
  ) {
    throw new Error(
      "Fixture collaboration requires initial-push, collaboration, final-push, and finalization paths.",
    );
  }
  await atomicReadyMarker(initialPushCompletePath);
  await waitForMarker(collaborationPath, request.monotonicDeadlineMs);
  await git(
    repository,
    ["fetch", "--quiet", "origin", "+refs/heads/agents/*:refs/remotes/origin/agents/*"],
    authentication,
  );
  const peerRefs = await git(
    repository,
    ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes/origin/agents"],
    authentication,
  );
  const peerRefRecords = peerRefs.split("\n").filter(Boolean).sort();
  const peerSnapshotDigest = createHash("sha256")
    .update(canonicalJsonBytes(peerRefRecords))
    .digest("hex");
  emit("git.fetch", {
    snapshot: "collaboration",
    refNamespace: "refs/heads/agents",
    refCount: peerRefRecords.length,
    refDigest: peerSnapshotDigest,
  });

  const secondRelease = await observeReleaseOrdinal(request.releasedInputManifestPath, 2, {
    timeoutMs: request.monotonicDeadlineMs,
  });
  emit("file.read", {
    path: "input/released/release-manifest.json",
    releaseOrdinal: secondRelease.releaseOrdinal,
    chapters: secondRelease.chapters,
  });
  const tip = await commitReleaseAnalysis({
    repository,
    agentId: request.agentId,
    observedReleases: [firstRelease, secondRelease],
    authentication,
  });
  emit("git.commit", {
    phase: "release-2-peer-revision",
    predecessor: initialTip,
    peerSnapshotDigest,
    tip,
  });
  await git(
    repository,
    ["push", "--quiet", "origin", `HEAD:${request.gitRefNamespace}/work`],
    authentication,
  );
  emit("git.push", {
    phase: "release-2-peer-revision",
    ref: `${request.gitRefNamespace}/work`,
    tip,
  });
  await atomicReadyMarker(finalPushCompletePath);
  await waitForMarker(finalizationPath, request.monotonicDeadlineMs);
  await git(
    repository,
    ["fetch", "--quiet", "origin", "+refs/heads/agents/*:refs/remotes/origin/agents/*"],
    authentication,
  );
  emit("git.fetch", { snapshot: "frozen", refNamespace: "refs/heads/agents" });

  await mkdir(request.privateOutputPath, { recursive: true });
  await writeFile(
    join(request.privateOutputPath, "reconstruction.txt"),
    `${request.agentId} produced a deliberately incomplete fixture reconstruction.\n`,
  );
  await writeFile(join(request.privateOutputPath, "mapping.json"), "{}\n");
  await writeFile(
    join(request.privateOutputPath, "hypothesis.json"),
    `${JSON.stringify({ switchDetected: true, confidence: 0.5 })}\n`,
  );
  const solver = join(request.privateOutputPath, "solver.sh");
  await writeFile(
    solver,
    '#!/bin/sh\nset -eu\nmkdir -p "$2"\nprintf "fixture reconstruction\\n" > "$2/reconstruction.txt"\n',
    { mode: 0o755 },
  );
  emit("file.declared", {
    paths: ["hypothesis.json", "mapping.json", "reconstruction.txt", "solver.sh"],
  });
  emit("worker.completed", { classification: "completed", tip });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
