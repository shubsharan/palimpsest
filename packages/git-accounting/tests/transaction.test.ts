import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import {
  VisibilityJournal,
  buildLogicalTransaction,
  encodeGitAccountingFrame,
  refOperations,
  validateTreeEntries,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function git(repository: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

async function repositoryWithCommit(): Promise<{ repository: string; tip: string }> {
  const repository = await mkdtemp(join(tmpdir(), "palimpsest-git-transaction-"));
  temporaryDirectories.push(repository);
  await execFileAsync("git", ["init", "--quiet", "--object-format=sha256", repository]);
  await git(repository, ["config", "user.name", "Palimpsest Evidence"]);
  await git(repository, ["config", "user.email", "evidence@palimpsest.invalid"]);
  await writeFile(join(repository, "belief.txt"), "first\n");
  await git(repository, ["add", "belief.txt"]);
  await git(repository, ["commit", "--quiet", "-m", "first"]);
  return { repository, tip: await git(repository, ["rev-parse", "HEAD"]) };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("logical Git transaction reconstruction", () => {
  test("charges the complete new real-Git closure", async () => {
    const { repository, tip } = await repositoryWithCommit();
    const transaction = await buildLogicalTransaction({
      authenticatedAgent: 1,
      newOid: tip,
      operation: refOperations.create,
      publicationSlot: 0,
      refName: "refs/heads/agents/agent-1/work",
      repository,
      slotStartJournal: new VisibilityJournal(),
    });
    expect(transaction.objects.map((object) => object.type).sort()).toEqual([1, 2, 3]);
    expect(transaction.objects.map((object) => object.oid.toString("hex"))).toContain(tip);
    expect(encodeGitAccountingFrame(transaction).length).toBeGreaterThan(0);
  });

  test("subtracts ever-visible ancestors and preserves cumulative journal state", async () => {
    const { repository, tip: firstTip } = await repositoryWithCommit();
    const first = await buildLogicalTransaction({
      authenticatedAgent: 1,
      newOid: firstTip,
      operation: refOperations.create,
      publicationSlot: 0,
      refName: "refs/heads/agents/agent-1/work",
      repository,
      slotStartJournal: new VisibilityJournal(),
    });
    const journal = new VisibilityJournal().withAcceptedObjects([first.objects]);

    await writeFile(join(repository, "belief.txt"), "second\n");
    await git(repository, ["add", "belief.txt"]);
    await git(repository, ["commit", "--quiet", "-m", "second"]);
    const secondTip = await git(repository, ["rev-parse", "HEAD"]);
    const second = await buildLogicalTransaction({
      authenticatedAgent: 1,
      newOid: secondTip,
      oldOid: firstTip,
      operation: refOperations.update,
      publicationSlot: 1,
      refName: "refs/heads/agents/agent-1/work",
      repository,
      slotStartJournal: journal,
    });

    const secondOids = new Set(second.objects.map((object) => object.oid.toString("hex")));
    for (const object of first.objects) {
      expect(secondOids.has(object.oid.toString("hex"))).toBe(false);
    }
    expect(journal.withAcceptedObjects([second.objects]).values().length).toBe(
      first.objects.length + second.objects.length,
    );
  });

  test("same-slot candidates pay independently against one frozen journal", async () => {
    const left = Buffer.alloc(32, 1);
    const right = Buffer.alloc(32, 2);
    const shared = {
      content: Buffer.from("shared"),
      oid: Buffer.alloc(32, 3),
      type: 3 as const,
    };
    const slotStart = new VisibilityJournal([left.toString("hex"), right.toString("hex")]);
    expect(slotStart.has(shared.oid)).toBe(false);
    const next = slotStart.withAcceptedObjects([[shared], [shared]]);
    expect(next.values()).toHaveLength(3);
    expect(slotStart.has(shared.oid)).toBe(false);
  });

  test("rejects unsafe modes, paths, and case collisions", () => {
    expect(() =>
      validateTreeEntries([{ mode: "120000", type: "blob", oid: "1".repeat(64), path: "link" }]),
    ).toThrowError(/Unsupported Git tree mode/);
    expect(() =>
      validateTreeEntries([
        { mode: "100644", type: "blob", oid: "1".repeat(64), path: "../secret" },
      ]),
    ).toThrowError(/Unsafe Git tree path/);
    expect(() =>
      validateTreeEntries([
        { mode: "100644", type: "blob", oid: "1".repeat(64), path: "Note.txt" },
        { mode: "100644", type: "blob", oid: "2".repeat(64), path: "note.txt" },
      ]),
    ).toThrowError(/Case-colliding Git tree path/);
  });

  test("logical frames are invariant under native repacking choices", async () => {
    const { repository, tip } = await repositoryWithCommit();
    const options = {
      authenticatedAgent: 1,
      newOid: tip,
      operation: refOperations.create,
      publicationSlot: 0,
      refName: "refs/heads/agents/agent-1/work",
      repository,
      slotStartJournal: new VisibilityJournal(),
    } as const;
    const loose = encodeGitAccountingFrame(await buildLogicalTransaction(options));
    await git(repository, ["repack", "-adf", "--window=0", "--depth=0"]);
    const undeltified = encodeGitAccountingFrame(await buildLogicalTransaction(options));
    await git(repository, ["repack", "-adf", "--window=50", "--depth=50"]);
    const deltified = encodeGitAccountingFrame(await buildLogicalTransaction(options));
    expect(undeltified).toEqual(loose);
    expect(deltified).toEqual(loose);
  });
});
