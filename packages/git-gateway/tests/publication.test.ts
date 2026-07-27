import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, test } from "vitest";

import {
  PushAdmissionWindow,
  SnapshotStore,
  canonicalFetchTuple,
  captureFetchSnapshot,
  createFreeze,
  materializeSnapshotRepository,
  publishSnapshot,
} from "../src/index.js";

const execFileAsync = promisify(execFile);

async function git(repository: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args]);
  return stdout.trim();
}

async function fixtureRepository(): Promise<{
  root: string;
  repository: string;
  mainOid: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-publication-"));
  const work = join(root, "work");
  const repository = join(root, "repository.git");
  await execFileAsync("git", ["init", "--quiet", "--object-format=sha256", work]);
  await git(work, ["config", "user.name", "Fixture"]);
  await git(work, ["config", "user.email", "fixture@invalid"]);
  await writeFile(join(work, "README.md"), "visible\n");
  await git(work, ["add", "README.md"]);
  await git(work, ["commit", "--quiet", "-m", "genesis"]);
  await git(work, ["branch", "-M", "main"]);
  await execFileAsync("git", ["clone", "--quiet", "--bare", work, repository]);
  return { root, repository, mainOid: await git(repository, ["rev-parse", "refs/heads/main"]) };
}

describe("immutable publication snapshots", () => {
  test("captures one complete ref map for a connection", () => {
    const snapshot = publishSnapshot({
      runId: "run-1",
      ordinal: 1,
      refs: { "refs/heads/main": "a".repeat(64) },
      visibilityJournalDigest: "b".repeat(64),
      eventSequence: 4,
    });
    const store = new SnapshotStore();
    store.add(snapshot);
    const captured = captureFetchSnapshot(store.get(snapshot.snapshotId));
    snapshot.ordinal = 9;
    expect(captured.snapshot.ordinal).toBe(1);
    expect(() => store.add(captured.snapshot)).toThrow(/already exists/);
  });

  test("materializes an immutable fetch repository and canonical request tuple", async () => {
    const fixture = await fixtureRepository();
    const refs = { "refs/heads/main": fixture.mainOid };
    const repository = join(fixture.root, "published.git");
    const view = await materializeSnapshotRepository({
      sourceRepository: fixture.repository,
      destination: repository,
      refs,
    });
    const snapshot = publishSnapshot({
      runId: "run-1",
      ordinal: 1,
      refs,
      visibilityJournalDigest: "b".repeat(64),
      eventSequence: 4,
    });
    const store = new SnapshotStore();
    store.add(snapshot, view);
    const captured = captureFetchSnapshot(
      store.get(snapshot.snapshotId),
      store.view(snapshot.snapshotId),
    );
    const tuple = canonicalFetchTuple({
      captured,
      wants: [fixture.mainOid],
      haves: [],
      capabilities: ["agent=git/2.48.1", "object-format=sha256"],
    });
    expect(tuple.digest).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      Promise.resolve().then(() =>
        canonicalFetchTuple({
          captured,
          wants: ["f".repeat(64)],
          haves: [],
          capabilities: ["object-format=sha256"],
        }),
      ),
    ).rejects.toThrow(/advertised/);
    expect(await git(repository, ["show-ref", "--hash", "refs/heads/main"])).toBe(fixture.mainOid);
  });

  test("closes pushes, drains admitted receives, and freezes only the declared refs", async () => {
    const fixture = await fixtureRepository();
    const refs = { "refs/heads/main": fixture.mainOid };
    const window = new PushAdmissionWindow();
    const receive = window.beginReceive();
    const freeze = createFreeze({
      repository: fixture.repository,
      bundlePath: join(fixture.root, "frozen.bundle"),
      runId: "run-1",
      refs,
      visibilityJournalDigest: "1".repeat(64),
      ledgers: [],
      finalEventSequence: 1,
      eventChainHead: "2".repeat(64),
      admissionWindow: window,
      drainTimeoutMs: 1_000,
    });
    expect(window.isOpen).toBe(false);
    expect(window.pendingReceives).toBe(1);
    receive.complete();
    await expect(freeze).resolves.toMatchObject({
      contractId: "freeze-snapshot",
      runId: "run-1",
    });
    expect(() => window.beginReceive()).toThrow(/closed/);
  });
});
