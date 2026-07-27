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
  canonicalUploadPackAdvertisement,
  canonicalUploadPackResponse,
  captureFetchSnapshot,
  createFreeze,
  materializeSnapshotRepository,
  parseUploadPackRequest,
  publishSnapshot,
} from "../src/index.js";

const execFileAsync = promisify(execFile);

function decodeSidebandPack(response: Buffer): Buffer {
  expect(response.subarray(0, 8).toString("ascii")).toBe("0008NAK\n");
  const chunks: Buffer[] = [];
  let offset = 8;
  while (offset < response.byteLength) {
    const length = Number.parseInt(response.subarray(offset, offset + 4).toString("ascii"), 16);
    offset += 4;
    if (length === 0) break;
    const payload = response.subarray(offset, offset + length - 4);
    expect(payload[0]).toBe(1);
    chunks.push(payload.subarray(1));
    offset += length - 4;
  }
  expect(offset).toBe(response.byteLength);
  return Buffer.concat(chunks);
}

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
  test("links each immutable snapshot to its predecessor and binds the link in its digest", () => {
    const first = publishSnapshot({
      runId: "run-lineage",
      ordinal: 1,
      refs: { "refs/heads/main": "a".repeat(64) },
      predecessorSnapshotId: null,
      visibilityJournalDigest: "b".repeat(64),
      eventSequence: 4,
    });
    const second = publishSnapshot({
      runId: "run-lineage",
      ordinal: 2,
      refs: { "refs/heads/main": "c".repeat(64) },
      predecessorSnapshotId: first.snapshotId,
      visibilityJournalDigest: "d".repeat(64),
      eventSequence: 8,
    });
    const wrongPredecessor = publishSnapshot({
      runId: "run-lineage",
      ordinal: 2,
      refs: { "refs/heads/main": "c".repeat(64) },
      predecessorSnapshotId: "publication-untrusted",
      visibilityJournalDigest: "d".repeat(64),
      eventSequence: 8,
    });

    expect(first.predecessorSnapshotId).toBeNull();
    expect(second.predecessorSnapshotId).toBe(first.snapshotId);
    expect(second.snapshotDigest).not.toBe(wrongPredecessor.snapshotDigest);

    const store = new SnapshotStore();
    store.add(first);
    expect(() => store.add(wrongPredecessor)).toThrow(/predecessor/);
    store.add(second);
    expect(() =>
      new SnapshotStore().add({
        ...first,
        predecessorSnapshotId: "publication-untrusted",
      }),
    ).toThrow(/snapshot digest/);
  });

  test("rejects missing or impossible predecessor links at construction", () => {
    expect(() =>
      publishSnapshot({
        runId: "run-lineage",
        ordinal: 1,
        refs: {},
        predecessorSnapshotId: "publication-000",
        visibilityJournalDigest: "a".repeat(64),
        eventSequence: 1,
      }),
    ).toThrow(/first published snapshot/);
    expect(() =>
      publishSnapshot({
        runId: "run-lineage",
        ordinal: 2,
        refs: {},
        visibilityJournalDigest: "a".repeat(64),
        eventSequence: 2,
      }),
    ).toThrow(/identify its predecessor/);
  });

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

  test("emits one canonical protocol-v0 advertisement from the published ref map", async () => {
    const fixture = await fixtureRepository();
    await git(fixture.repository, ["update-ref", "refs/heads/a-first", fixture.mainOid]);
    await git(fixture.repository, ["update-ref", "refs/heads/z-last", fixture.mainOid]);
    const refs = {
      "refs/heads/z-last": fixture.mainOid,
      "refs/heads/main": fixture.mainOid,
      "refs/heads/a-first": fixture.mainOid,
    };
    const view = await materializeSnapshotRepository({
      sourceRepository: fixture.repository,
      destination: join(fixture.root, "advertised.git"),
      refs,
    });
    const snapshot = publishSnapshot({
      runId: "run-advertisement",
      ordinal: 1,
      refs,
      visibilityJournalDigest: "c".repeat(64),
      eventSequence: 1,
    });
    const captured = captureFetchSnapshot(snapshot, view);
    const first = canonicalUploadPackAdvertisement(captured);
    const second = canonicalUploadPackAdvertisement(captured);
    expect(second.equals(first)).toBe(true);
    const text = first.toString("utf8");
    expect(text).toContain("# service=git-upload-pack\n");
    expect(text).toContain(
      "\0agent=palimpsest-gateway/1 object-format=sha256 side-band-64k symref=HEAD:refs/heads/main\n",
    );
    expect(text.indexOf(`${fixture.mainOid} refs/heads/a-first\n`)).toBeLessThan(
      text.indexOf(`${fixture.mainOid} refs/heads/main\n`),
    );
    expect(text.indexOf(`${fixture.mainOid} refs/heads/main\n`)).toBeLessThan(
      text.indexOf(`${fixture.mainOid} refs/heads/z-last\n`),
    );
    expect(text).not.toContain("thin-pack");
    expect(text).not.toContain("allow-tip-sha1-in-want");
  });

  test("regenerates identical sorted no-reuse pack bytes from different source packing", async () => {
    const fixture = await fixtureRepository();
    const refs = { "refs/heads/main": fixture.mainOid };
    const firstView = await materializeSnapshotRepository({
      sourceRepository: fixture.repository,
      destination: join(fixture.root, "first.git"),
      refs,
    });
    await execFileAsync("git", [
      "-C",
      fixture.repository,
      "repack",
      "-Adf",
      "--window=50",
      "--depth=50",
    ]);
    const secondView = await materializeSnapshotRepository({
      sourceRepository: fixture.repository,
      destination: join(fixture.root, "second.git"),
      refs,
    });
    const snapshot = publishSnapshot({
      runId: "run-pack",
      ordinal: 1,
      refs,
      visibilityJournalDigest: "d".repeat(64),
      eventSequence: 1,
    });
    const firstCaptured = captureFetchSnapshot(snapshot, firstView);
    const secondCaptured = captureFetchSnapshot(snapshot, secondView);
    const firstTuple = canonicalFetchTuple({
      captured: firstCaptured,
      wants: [fixture.mainOid, fixture.mainOid],
      haves: [],
      capabilities: ["side-band-64k", "object-format=sha256", "agent=git/2.48.1"],
    });
    const secondTuple = canonicalFetchTuple({
      captured: secondCaptured,
      wants: [fixture.mainOid],
      haves: [],
      capabilities: ["agent=git/2.48.1", "object-format=sha256", "side-band-64k"],
    });
    expect(secondTuple).toEqual(firstTuple);

    const firstResponse = await canonicalUploadPackResponse({
      captured: firstCaptured,
      tuple: firstTuple,
    });
    const repeatedResponse = await canonicalUploadPackResponse({
      captured: firstCaptured,
      tuple: firstTuple,
    });
    const repackedResponse = await canonicalUploadPackResponse({
      captured: secondCaptured,
      tuple: secondTuple,
    });
    expect(repeatedResponse.equals(firstResponse)).toBe(true);
    expect(repackedResponse.equals(firstResponse)).toBe(true);

    const pack = decodeSidebandPack(firstResponse);
    const packPath = join(fixture.root, "canonical.pack");
    await writeFile(packPath, pack);
    await execFileAsync("git", ["-C", fixture.repository, "index-pack", packPath]);
    const { stdout } = await execFileAsync("git", [
      "-C",
      fixture.repository,
      "verify-pack",
      "-v",
      join(fixture.root, "canonical.idx"),
    ]);
    const packedOidOrder = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => /^[0-9a-f]{64}$/.test(fields[0] ?? "") && /^\d+$/.test(fields[4] ?? ""))
      .sort((left, right) => Number(left[4]) - Number(right[4]))
      .map((fields) => fields[0]);
    expect(packedOidOrder).toEqual([...firstView.allowedOids].sort());
  });

  test("parses protocol-v0 upload-pack packets into a canonical request", () => {
    const oid = "a".repeat(64);
    const have = "b".repeat(64);
    const packet = (payload: string) => {
      const length = Buffer.byteLength(payload) + 4;
      return `${length.toString(16).padStart(4, "0")}${payload}`;
    };
    const parsed = parseUploadPackRequest(
      Buffer.from(
        [
          packet(`want ${oid} multi_ack_detailed side-band-64k thin-pack ofs-delta\n`),
          "0000",
          packet(`have ${have}\n`),
          packet("done\n"),
        ].join(""),
      ),
    );
    expect(parsed).toEqual({
      wants: [oid],
      haves: [have],
      capabilities: ["multi_ack_detailed", "ofs-delta", "side-band-64k", "thin-pack"],
    });
    expect(() => parseUploadPackRequest(Buffer.from(packet("want not-an-oid\n")))).toThrow(
      /invalid want/,
    );
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
      finalReleasedShards: ["agent-1", "agent-2", "agent-3"].map((agentId) => ({
        agentId,
        manifest: {
          artifactType: "released-shard-manifest",
          byteLength: 1,
          sha256: "3".repeat(64),
        },
      })),
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
