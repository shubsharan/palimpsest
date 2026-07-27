import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { canonicalJsonBytes, sha256Hex, validateValue } from "@palimpsest/contracts";
import { EventChain } from "@palimpsest/run-control";

import { verifyTerminalAttempt } from "./artifacts.js";
import { attemptPath, HARNESS_ROOT, type HarnessAttemptIdentity } from "./config.js";
import { identityFromArgs } from "./grade.js";

const execFileAsync = promisify(execFile);

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

const trustedArtifacts = [
  ["run-manifest.json", "run-manifest"],
  ["live.jsonl", "run-event-stream"],
  ["git/publication.json", "published-snapshot"],
  ["git/ledgers.json", "git-ledgers"],
  ["git/freeze.json", "freeze-snapshot"],
  ["git/frozen.bundle", "git-bundle"],
  ["submissions.json", "private-submissions"],
  ["grading/solver-executions.json", "solver-executions"],
  ["grading/score-report.json", "score-report"],
] as const;

const publicArtifacts = [
  ["public/metrics.json", "aggregate-score-report"],
  ["public/events.json", "sanitized-event-trace"],
  ["public/implementation.json", "implementation-status"],
  ["public/environment.json", "environment-versions"],
  ["public/claims.json", "claim-scope"],
  ["public/plots/aggregate-metrics.svg", "aggregate-score-plot"],
] as const;

async function artifact(path: string, artifactType: string): Promise<Record<string, unknown>> {
  const bytes = await readFile(path);
  return { artifactType, byteLength: bytes.byteLength, sha256: sha256Hex(bytes) };
}

export async function validateReplayArtifacts(
  identity: HarnessAttemptIdentity,
  root = ".",
): Promise<Record<string, unknown>> {
  const attempt = attemptPath(resolve(root, HARNESS_ROOT), identity);
  const replay = JSON.parse(await readFile(resolve(attempt, "replay/trusted-replay.json"), "utf8"));
  const verdict = JSON.parse(await readFile(resolve(attempt, "replay/verdict.json"), "utf8"));
  const publicReport = JSON.parse(await readFile(resolve(attempt, "public/report.json"), "utf8"));
  for (const [contractId, value] of [
    ["trusted-replay-bundle", replay],
    ["public-report-bundle", publicReport],
  ] as const) {
    const validation = validateValue(contractId, value);
    if (!validation.accepted) {
      throw new Error(`${contractId} is invalid: ${validation.reason} at ${validation.pointer}`);
    }
  }
  if (
    replay.runId !== identity.runId ||
    verdict.runId !== identity.runId ||
    publicReport.runId !== identity.runId
  ) {
    throw new Error("Replay artifacts do not match the explicit attempt identity.");
  }
  const expectedTrusted = await Promise.all(
    trustedArtifacts.map(([path, type]) => artifact(resolve(attempt, path), type)),
  );
  if (!canonicalJsonBytes(replay.artifacts).equals(canonicalJsonBytes(expectedTrusted))) {
    throw new Error("TypeScript replay digest projection disagrees with trusted attempt files.");
  }
  const replayDigest = sha256Hex(canonicalJsonBytes(replay));
  if (verdict.replayDigest !== replayDigest || publicReport.replayDigest !== replayDigest) {
    throw new Error("Replay digest does not bind the verdict and public report.");
  }
  const expectedPublic = await Promise.all(
    publicArtifacts.map(([path, type]) => artifact(resolve(attempt, path), type)),
  );
  if (!canonicalJsonBytes(publicReport.artifacts).equals(canonicalJsonBytes(expectedPublic))) {
    throw new Error("Public report digest projection disagrees with redacted files.");
  }
  return replay as Record<string, unknown>;
}

export async function replayAttempt(
  identity: HarnessAttemptIdentity,
  root = ".",
): Promise<Record<string, unknown>> {
  const attempt = attemptPath(resolve(root, HARNESS_ROOT), identity);
  const sealed = await pathExists(resolve(attempt, "terminal.json"));
  if (sealed) {
    await verifyTerminalAttempt({ root: resolve(root, HARNESS_ROOT), identity });
  }
  const events = await EventChain.resume(identity.runId, resolve(attempt, "live.jsonl"));
  const replayed = events.events.find((event) => event.effectId === "lifecycle-replayed");
  await events.append({
    producer: "replay",
    effectId: "lifecycle-replayed",
    eventType: "lifecycle.transition",
    monotonicElapsedNs: replayed?.monotonicElapsedNs ?? String(events.events.length * 1_000_000),
    payload: { state: "REPLAYED" },
  });
  const scored = events.events.find((event) => event.effectId === "lifecycle-scored");
  await events.append({
    producer: "grading",
    effectId: "lifecycle-scored",
    eventType: "lifecycle.transition",
    monotonicElapsedNs: scored?.monotonicElapsedNs ?? String(events.events.length * 1_000_000),
    payload: { state: "SCORED" },
  });
  await execFileAsync(
    "uv",
    [
      "run",
      "--offline",
      "--frozen",
      "--project",
      "python",
      "python",
      "-m",
      "palimpsest.replay.harness",
      "--run-id",
      identity.runId,
      "--attempt",
      attempt,
    ],
    { cwd: resolve(root), maxBuffer: 32 * 1024 * 1024 },
  );
  const replay = await validateReplayArtifacts(identity, root);
  if (sealed) {
    await verifyTerminalAttempt({ root: resolve(root, HARNESS_ROOT), identity });
  }
  return replay;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${canonicalJsonBytes(await replayAttempt(identityFromArgs())).toString("utf8")}\n`,
  );
}
