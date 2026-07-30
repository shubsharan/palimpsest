import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decodeAttemptSummary } from "./artifacts.js";
import type { FrozenGitEnvironment, GitRepository, GitRepositoryId } from "./git.js";
import type { AgentId } from "./model.js";
import { collectCommittedFiles, collectFrozenCommittedFiles, observeOverlap } from "./overlap.js";
import { runProcess } from "./process.js";
import type { AttemptResult } from "./run.js";
import { TEST_TREE_SEAL, testAttemptSummary, testBuildManifest } from "./test-helpers.js";

const temporaryRoots: string[] = [];
const agentIds = ["agent-1", "agent-2", "agent-3"] as const satisfies readonly AgentId[];

async function git(cwd: string, ...args: string[]): Promise<void> {
  await runProcess("git", args, { cwd });
}

async function fixtureRepository(
  root: string,
  repositoryId: GitRepositoryId,
  agentIdsForRepository: readonly AgentId[],
  content: string,
): Promise<GitRepository> {
  const bare = join(root, `${repositoryId}.git`);
  const work = join(root, `work-${repositoryId}`);
  await git(root, "init", "--bare", "--initial-branch=main", bare);
  await git(root, "clone", bare, work);
  await git(work, "config", "user.name", "Fixture Agent");
  await git(work, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(work, "finding.txt"), content, "utf8");
  await git(work, "add", "finding.txt");
  await git(work, "commit", "-m", "add finding");
  await git(work, "push", "origin", "main");
  return { repositoryId, path: bare, agentIds: agentIdsForRepository };
}

function frozenEnvironment(
  root: string,
  communicationMode: FrozenGitEnvironment["communicationMode"],
  repositories: readonly GitRepository[],
): FrozenGitEnvironment {
  return {
    root,
    communicationMode,
    repositories,
    workspaces: agentIds.map((agentId) => ({
      agentId,
      path: join(root, "workspaces", agentId),
      repositoryId: communicationMode === "shared" ? "shared" : agentId,
    })),
    frozen: true,
    treeSeal: TEST_TREE_SEAL,
  };
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

  it("scans a shared repository once even though all agents use it", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-overlap-shared-"));
    temporaryRoots.push(root);
    const repository = await fixtureRepository(root, "shared", agentIds, "shared finding\n");
    const outputRoot = join(root, "materialized");

    const result = await collectFrozenCommittedFiles(
      frozenEnvironment(join(root, "frozen"), "shared", [repository]),
      outputRoot,
    );

    expect(result.committed).toHaveLength(1);
    expect(result.committed[0]).toMatchObject({ committedPath: "finding.txt" });
    expect(result.committed[0]?.contentPath).toContain(join(outputRoot, "shared"));
    expect(result.scan).toEqual({
      reachableObjectCount: 3,
      reachableBlobReferenceCount: 1,
      uniqueReachableBlobCount: 1,
      uniqueTextBlobCount: 1,
      repeatedTreeReferenceCount: 0,
      skippedNonTextBlobCount: 0,
    });
  });

  it("aggregates isolated repositories independently with agent-prefixed paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-overlap-isolated-"));
    temporaryRoots.push(root);
    const repositories = await Promise.all(
      agentIds.map((agentId) =>
        fixtureRepository(root, agentId, [agentId], "same independent finding\n"),
      ),
    );
    const outputRoot = join(root, "materialized");

    const result = await collectFrozenCommittedFiles(
      frozenEnvironment(join(root, "frozen"), "isolated", repositories),
      outputRoot,
    );
    const withText = await Promise.all(
      result.committed.map(async (entry) => ({
        ...entry,
        text: await readFile(entry.contentPath, "utf8"),
      })),
    );

    expect(withText.map((entry) => entry.committedPath)).toEqual(
      agentIds.map((agentId) => `${agentId}/finding.txt`),
    );
    expect(withText.map((entry) => entry.text)).toEqual(
      agentIds.map(() => "same independent finding\n"),
    );
    expect(new Set(withText.map((entry) => entry.committedBlobId)).size).toBe(1);
    expect(new Set(withText.map((entry) => entry.contentPath)).size).toBe(3);
    for (const agentId of agentIds) {
      expect(
        withText.find((entry) => entry.committedPath.startsWith(`${agentId}/`))?.contentPath,
      ).toContain(join(outputRoot, agentId));
    }
    expect(result.scan).toEqual({
      reachableObjectCount: 9,
      reachableBlobReferenceCount: 3,
      uniqueReachableBlobCount: 3,
      uniqueTextBlobCount: 3,
      repeatedTreeReferenceCount: 0,
      skippedNonTextBlobCount: 0,
    });
  });

  it("rejects overlap observation when the attempt uses the wrong paired-build variant", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-overlap-variant-"));
    temporaryRoots.push(root);
    const buildRoot = join(root, "build");
    await mkdir(buildRoot, { recursive: true });
    const manifest = testBuildManifest();
    await writeFile(join(buildRoot, "puzzle-build.json"), `${JSON.stringify(manifest)}\n`, "utf8");
    const attempt = decodeAttemptSummary(testAttemptSummary({ condition: "CS" }));
    const frozen: FrozenGitEnvironment = {
      ...attempt.frozen,
      root: join(root, "missing-frozen"),
      repositories: attempt.frozen.repositories.map((repository) => ({
        ...repository,
        path: join(root, "missing-frozen", `${repository.repositoryId}.git`),
      })),
      frozen: true,
    };
    const result: AttemptResult = {
      ...attempt,
      buildRoot,
      buildId: `build-${"a".repeat(64)}`,
      frozen,
      tracePath: join(root, "attempt", "trace.jsonl"),
      traceMetadataPath: join(root, "attempt", "trace.meta.json"),
    };

    await expect(observeOverlap(root, buildRoot, result)).rejects.toThrow(
      "Attempt build identity does not match the selected paired-build variant.",
    );
  });
});
