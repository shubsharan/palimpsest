import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";
import { describe, expect, test } from "vitest";

import { HARNESS_ROOT, type HarnessAttemptIdentity } from "../../tools/harness/config.js";
import { validateReplayArtifacts } from "../../tools/harness/replay.js";

const trusted = [
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

const projected = [
  ["public/metrics.json", "aggregate-score-report"],
  ["public/events.json", "sanitized-event-trace"],
  ["public/implementation.json", "implementation-status"],
  ["public/environment.json", "environment-versions"],
  ["public/claims.json", "claim-scope"],
  ["public/plots/aggregate-metrics.svg", "aggregate-score-plot"],
] as const;

async function fixture(root: string, identity: HarnessAttemptIdentity): Promise<string> {
  const attempt = resolve(
    root,
    HARNESS_ROOT,
    "attempts",
    identity.declarationDigest,
    identity.runId,
  );
  for (const [path] of [...trusted, ...projected]) {
    await mkdir(resolve(attempt, path, ".."), { recursive: true });
    await writeFile(resolve(attempt, path), Buffer.from(`fixture:${path}`));
  }
  const reference = async (path: string, artifactType: string) => {
    const bytes = Buffer.from(`fixture:${path}`);
    return { artifactType, byteLength: bytes.byteLength, sha256: sha256Hex(bytes) };
  };
  const replay = {
    schemaVersion: 1,
    contractId: "trusted-replay-bundle",
    runId: identity.runId,
    freezeId: "freeze-001",
    artifacts: await Promise.all(trusted.map(([path, type]) => reference(path, type))),
  };
  const replayDigest = sha256Hex(canonicalJsonBytes(replay));
  await mkdir(resolve(attempt, "replay"), { recursive: true });
  await writeFile(resolve(attempt, "replay/trusted-replay.json"), canonicalJsonBytes(replay));
  await writeFile(
    resolve(attempt, "replay/verdict.json"),
    canonicalJsonBytes({ schemaVersion: 1, runId: identity.runId, replayDigest, result: "pass" }),
  );
  await writeFile(
    resolve(attempt, "public/report.json"),
    canonicalJsonBytes({
      schemaVersion: 1,
      contractId: "public-report-bundle",
      runId: identity.runId,
      replayDigest,
      artifacts: await Promise.all(projected.map(([path, type]) => reference(path, type))),
      empiricalModelEvidence: false,
    }),
  );
  return attempt;
}

describe("explicit-attempt replay parity", () => {
  test("ignores mutable pointers and agrees on trusted and public digests", async () => {
    const root = process.env.VITEST_POOL_ID
      ? resolve(".tmp", `replay-${process.pid}-${process.env.VITEST_POOL_ID}`)
      : resolve(".tmp", `replay-${process.pid}`);
    const identity = { declarationDigest: "a".repeat(64), runId: "run-1" };
    await fixture(root, identity);
    await mkdir(resolve(root, HARNESS_ROOT), { recursive: true });
    await writeFile(
      resolve(root, HARNESS_ROOT, "current.json"),
      canonicalJsonBytes({ runId: "wrong-run", evidence: false }),
    );

    await expect(validateReplayArtifacts(identity, root)).resolves.toMatchObject({
      runId: "run-1",
    });
  });

  test("rejects a changed trusted file", async () => {
    const root = resolve(".tmp", `replay-tamper-${process.pid}`);
    const identity = { declarationDigest: "b".repeat(64), runId: "run-2" };
    const attempt = await fixture(root, identity);
    await writeFile(resolve(attempt, "grading/score-report.json"), "tampered");

    await expect(validateReplayArtifacts(identity, root)).rejects.toThrow(
      "digest projection disagrees",
    );
  });
});
