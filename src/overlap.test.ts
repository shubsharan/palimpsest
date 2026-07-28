import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { collectCommittedFiles } from "./overlap.js";
import { runProcess } from "./process.js";

const temporaryRoots: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<void> {
  await runProcess("git", args, { cwd });
}

describe("reachable Git overlap input", () => {
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("preserves path and blob provenance across reachable history while materializing blobs once", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-overlap-git-"));
    temporaryRoots.push(root);
    const bare = join(root, "shared.git");
    const work = join(root, "work");

    await git(root, "init", "--bare", "--initial-branch=main", bare);
    await git(root, "clone", bare, work);
    await git(work, "config", "user.name", "Fixture Agent");
    await git(work, "config", "user.email", "fixture@example.invalid");

    const deletedFragment = "unique committed fragment retained through history\n";
    const historicalVersion = "historical version\n";
    await writeFile(join(work, "deleted.txt"), deletedFragment, "utf8");
    await writeFile(join(work, "duplicate.txt"), deletedFragment, "utf8");
    await writeFile(join(work, "evolving.txt"), historicalVersion, "utf8");
    await writeFile(join(work, "binary.bin"), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    await git(work, "add", ".");
    await git(work, "commit", "-m", "add historical overlap fixtures");

    await git(work, "rm", "deleted.txt", "duplicate.txt", "binary.bin");
    await writeFile(join(work, "evolving.txt"), "current version\n", "utf8");
    await writeFile(join(work, "current.txt"), "current text\n", "utf8");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "delete historical fixtures");
    await writeFile(join(work, "marker.txt"), "third commit marker\n", "utf8");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "retain current blobs in another tree");
    await git(work, "push", "origin", "main");
    expect(await readFile(join(work, "current.txt"), "utf8")).toBe("current text\n");

    const result = await collectCommittedFiles(bare, join(root, "materialized"));
    const withText = await Promise.all(
      result.committed.map(async (entry) => ({
        ...entry,
        text: await readFile(entry.contentPath, "utf8"),
      })),
    );

    const duplicateBlob = withText.filter((entry) => entry.text === deletedFragment);
    expect(duplicateBlob.map((entry) => entry.committedPath)).toEqual([
      "deleted.txt",
      "duplicate.txt",
    ]);
    expect(new Set(duplicateBlob.map((entry) => entry.committedBlobId)).size).toBe(1);
    expect(new Set(duplicateBlob.map((entry) => entry.contentPath)).size).toBe(1);

    const evolving = withText.filter((entry) => entry.committedPath === "evolving.txt");
    expect(evolving.map((entry) => entry.text).sort()).toEqual([
      "current version\n",
      historicalVersion,
    ]);
    expect(new Set(evolving.map((entry) => entry.committedBlobId)).size).toBe(2);
    expect(
      new Set(result.committed.map((entry) => `${entry.committedPath}\0${entry.committedBlobId}`))
        .size,
    ).toBe(result.committed.length);
    expect(withText.map((entry) => entry.text)).toContain("current text\n");
    expect(result.scan.reachableObjectCount).toBeGreaterThan(result.scan.uniqueReachableBlobCount);
    expect(result.scan.reachableBlobReferenceCount).toBeGreaterThan(
      result.scan.uniqueReachableBlobCount,
    );
    expect(result.scan).toMatchObject({
      reachableBlobReferenceCount: 9,
      uniqueReachableBlobCount: 6,
      uniqueTextBlobCount: 5,
      repeatedTreeReferenceCount: 3,
      skippedNonTextBlobCount: 1,
    });
    expect(result.scan.uniqueTextBlobCount).toBe(
      new Set(result.committed.map((entry) => entry.contentPath)).size,
    );
  });
});
