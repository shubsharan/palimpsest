import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { CumulativeLedger, SnapshotStore, createFreeze } from "@palimpsest/git-gateway";
import { EventChain, sealPrivateSubmission } from "@palimpsest/run-control";
import { describe, expect, test } from "vitest";

import {
  createAttempt,
  sealAttempt,
  verifyTerminalAttempt,
} from "../../tools/harness/artifacts.js";
import { buildHarnessBundle } from "../../tools/harness/build.js";
import { HARNESS_ROOT } from "../../tools/harness/config.js";
import { gradeAttempt } from "../../tools/harness/grade.js";
import { validateReplayArtifacts } from "../../tools/harness/replay.js";

const declarationDigest = "a".repeat(64);
const execFileAsync = promisify(execFile);

describe("harness failure injection", () => {
  test("a failed build promotes no declared bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-build-failure-"));
    await expect(buildHarnessBundle(root)).rejects.toThrow();
    await expect(access(join(root, HARNESS_ROOT, "declared"))).rejects.toThrow();
  });

  test("event, admission, and publication conflicts preserve prior state", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-event-failure-"));
    const eventPath = join(root, "events.jsonl");
    const chain = new EventChain("run-1", eventPath);
    const input = {
      producer: "fixture",
      effectId: "effect-1",
      eventType: "fixture.effect",
      monotonicElapsedNs: "1",
      payload: { accepted: true },
    };
    const first = await chain.append(input);
    await expect(chain.append({ ...input, payload: { accepted: false } })).rejects.toThrow(
      "Conflicting duplicate",
    );
    expect(chain.events).toEqual([first]);
    await expect(EventChain.resume("wrong-run", eventPath)).rejects.toThrow("different run");

    const ledger = new CumulativeLedger("run-1", "agent-1", 5);
    const accepted = ledger.reserve("tx-1", "1".repeat(64), 5);
    expect(ledger.reserve("tx-2", "2".repeat(64), 1)).toMatchObject({
      result: "rejected",
      budgetAfter: 0,
    });
    expect(ledger.entries[0]).toBe(accepted);
    expect(() => ledger.reserve("tx-1", "3".repeat(64), 5)).toThrow("Conflicting duplicate");

    const snapshots = new SnapshotStore();
    const snapshot = {
      schemaVersion: 1 as const,
      contractId: "published-snapshot" as const,
      runId: "run-1",
      snapshotId: "publication-001",
      ordinal: 1,
      refMapDigest: "4".repeat(64),
      visibilityJournalDigest: "5".repeat(64),
      eventSequence: 1,
    };
    snapshots.add(snapshot);
    expect(() => snapshots.add({ ...snapshot, ordinal: 2 })).toThrow("already exists");
    expect(snapshots.get(snapshot.snapshotId)).toEqual(snapshot);
  });

  test("freeze and submission failures promote no success-shaped artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-freeze-failure-"));
    const bundlePath = join(root, "frozen.bundle");
    await expect(
      createFreeze({
        repository: join(root, "missing.git"),
        bundlePath,
        runId: "run-1",
        refs: {},
        visibilityJournalDigest: "1".repeat(64),
        ledgers: [],
        finalEventSequence: 1,
        eventChainHead: "2".repeat(64),
      }),
    ).rejects.toThrow();
    await expect(access(bundlePath)).rejects.toThrow();

    const output = join(root, "private-output");
    await mkdir(output);
    const outside = join(root, "outside.txt");
    await writeFile(outside, "secret\n");
    await symlink(outside, join(output, "escape.txt"));
    await expect(
      sealPrivateSubmission({
        root: output,
        agentId: "agent-1",
        runId: "run-1",
        freezeId: "freeze-1",
        releasedShardDigest: "3".repeat(64),
      }),
    ).rejects.toThrow("symbolic link");
    await expect(access(join(output, "manifest.json"))).rejects.toThrow();
  });

  test("a missing solver promotes no execution or score artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-solver-failure-"));
    const attempt = join(root, "attempt");
    const bundle = join(root, "bundle");
    await mkdir(join(attempt, "agents", "agent-1", "private-output"), { recursive: true });
    await mkdir(join(bundle, "sealed"), { recursive: true });
    await mkdir(join(bundle, "private", "agent-1", "chapters"), { recursive: true });
    await writeFile(join(bundle, "sealed", "prepared.txt"), "target\n");
    await writeFile(join(bundle, "private", "agent-1", "chapters", "010.txt"), "candidate\n");

    await expect(
      execFileAsync("uv", [
        "run",
        "--offline",
        "--frozen",
        "--project",
        "python",
        "python",
        "-m",
        "palimpsest.solver.executor",
        "--run-id",
        "failed-solver",
        "--attempt",
        attempt,
        "--bundle",
        bundle,
      ]),
    ).rejects.toThrow();
    await expect(access(join(attempt, "grading", "solver-executions.json"))).rejects.toThrow();
    await expect(access(join(attempt, "grading", "score-report.json"))).rejects.toThrow();
  });

  test("terminal attempts reject grading, replay gaps, and late promotion", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-promotion-failure-"));
    const identity = { declarationDigest, runId: "failed-1" };
    const harnessRoot = join(root, HARNESS_ROOT);
    const attempt = await createAttempt({
      root: harnessRoot,
      identity,
      startedAt: "2026-07-27T00:00:00.000Z",
    });
    await writeFile(join(attempt, "failure.json"), "{}");
    await sealAttempt({ root: harnessRoot, identity, classification: "invalid" });

    await expect(gradeAttempt(identity, root)).rejects.toThrow("terminal attempt");
    await expect(validateReplayArtifacts(identity, root)).rejects.toThrow();
    await writeFile(join(attempt, "late-success.json"), "{}");
    await expect(verifyTerminalAttempt({ root: harnessRoot, identity })).rejects.toThrow(
      "exact output set",
    );
  });
});
