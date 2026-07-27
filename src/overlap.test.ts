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

  it("includes text deleted from every ref tip once while reporting repeated and binary blobs", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-overlap-git-"));
    temporaryRoots.push(root);
    const bare = join(root, "shared.git");
    const work = join(root, "work");

    await git(root, "init", "--bare", "--initial-branch=main", bare);
    await git(root, "clone", bare, work);
    await git(work, "config", "user.name", "Fixture Agent");
    await git(work, "config", "user.email", "fixture@example.invalid");

    const deletedFragment = "unique committed fragment retained through history\n";
    await writeFile(join(work, "deleted.txt"), deletedFragment, "utf8");
    await writeFile(join(work, "duplicate.txt"), deletedFragment, "utf8");
    await writeFile(join(work, "binary.bin"), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    await git(work, "add", ".");
    await git(work, "commit", "-m", "add historical overlap fixtures");

    await git(work, "rm", "deleted.txt", "duplicate.txt", "binary.bin");
    await writeFile(join(work, "current.txt"), "current text\n", "utf8");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "delete historical fixtures");
    await git(work, "push", "origin", "main");
    expect(await readFile(join(work, "current.txt"), "utf8")).toBe("current text\n");

    const result = await collectCommittedFiles(bare, join(root, "materialized"));
    const text = await Promise.all(
      Object.values(result.committed).map((path) => readFile(path, "utf8")),
    );

    expect(text.filter((value) => value === deletedFragment)).toHaveLength(1);
    expect(text).toContain("current text\n");
    expect(result.scan.reachableObjectCount).toBeGreaterThan(result.scan.uniqueReachableBlobCount);
    expect(result.scan.reachableBlobReferenceCount).toBeGreaterThan(
      result.scan.uniqueReachableBlobCount,
    );
    expect(result.scan.repeatedTreeReferenceCount).toBeGreaterThan(0);
    expect(result.scan.uniqueTextBlobCount).toBe(Object.keys(result.committed).length);
    expect(result.scan.skippedNonTextBlobCount).toBe(1);
  });
});
