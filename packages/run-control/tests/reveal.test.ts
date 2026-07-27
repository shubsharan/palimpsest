import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { releaseAgentShard, releaseManifestSnapshotPath } from "../src/reveal.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-reveal-"));
  temporaryRoots.push(root);
  return root;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeBundle(root: string): Promise<{
  bundleRoot: string;
  destination: string;
  secondChapterPath: string;
}> {
  const bundleRoot = join(root, "bundle");
  const source = join(bundleRoot, "private", "agent-1");
  const destination = join(root, "agent-input");
  const chapters = [
    { index: 10, bytes: Buffer.from("first ciphertext\n") },
    { index: 11, bytes: Buffer.from("second ciphertext\n") },
  ];
  await Promise.all([
    mkdir(join(source, "chapters"), { recursive: true }),
    mkdir(join(source, "releases", "01"), { recursive: true }),
    mkdir(join(source, "releases", "02"), { recursive: true }),
  ]);
  await writeFile(
    join(source, "shard-manifest.json"),
    JSON.stringify({ schemaVersion: 1, agentId: "agent-1", chapterIndexes: [10, 11] }),
  );
  await Promise.all(
    chapters.map(({ index, bytes }) =>
      writeFile(join(source, "chapters", `${String(index).padStart(3, "0")}.txt`), bytes),
    ),
  );
  for (const ordinal of [1, 2]) {
    const released = chapters.slice(0, ordinal);
    await writeFile(
      join(source, "releases", String(ordinal).padStart(2, "0"), "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        releaseOrdinal: ordinal,
        chapterIndexes: released.map(({ index }) => index),
        chapters: released.map(({ bytes }) => ({
          artifactType: "cipher-chapter",
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
        })),
      }),
    );
  }
  return {
    bundleRoot,
    destination,
    secondChapterPath: join(source, "chapters", "011.txt"),
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("progressive agent release", () => {
  test("rejects a release gap before publishing a manifest", async () => {
    const paths = await writeBundle(await temporaryRoot());

    await expect(releaseAgentShard({ ...paths, agentId: "agent-1", ordinal: 2 })).rejects.toThrow(
      /ordinal 1/,
    );
    await expect(
      readFile(join(paths.destination, "released", "release-manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("publishes referenced chapter bytes before atomically advancing the manifest", async () => {
    const paths = await writeBundle(await temporaryRoot());
    const current = await releaseAgentShard({ ...paths, agentId: "agent-1", ordinal: 1 });
    const firstManifest = await readFile(current);

    expect(JSON.parse(firstManifest.toString("utf8"))).toMatchObject({ releaseOrdinal: 1 });
    await expect(readFile(join(paths.destination, "released", "010.txt"), "utf8")).resolves.toBe(
      "first ciphertext\n",
    );
    await expect(
      readFile(join(paths.destination, "released", "shard-manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await unlink(paths.secondChapterPath);
    await expect(releaseAgentShard({ ...paths, agentId: "agent-1", ordinal: 2 })).rejects.toThrow();

    expect(await readFile(current)).toEqual(firstManifest);
    await expect(readFile(releaseManifestSnapshotPath(current, 2))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("retains immutable per-ordinal manifests while the atomic pointer advances", async () => {
    const paths = await writeBundle(await temporaryRoot());
    const current = await releaseAgentShard({ ...paths, agentId: "agent-1", ordinal: 1 });
    await releaseAgentShard({ ...paths, agentId: "agent-1", ordinal: 2 });

    expect(JSON.parse(await readFile(current, "utf8"))).toMatchObject({ releaseOrdinal: 2 });
    expect(
      JSON.parse(await readFile(releaseManifestSnapshotPath(current, 1), "utf8")),
    ).toMatchObject({ releaseOrdinal: 1 });
    expect(
      JSON.parse(await readFile(releaseManifestSnapshotPath(current, 2), "utf8")),
    ).toMatchObject({ releaseOrdinal: 2 });
    await expect(readFile(join(paths.destination, "released", "011.txt"), "utf8")).resolves.toBe(
      "second ciphertext\n",
    );
    await expect(
      readFile(join(paths.destination, "released", "shard-manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
