import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceFileError } from "./contracts.js";
import { resolveWorkspacePath, resolveWorkspaceRegularFile } from "./workspace.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-workspace-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("sandbox workspace containment", () => {
  it("resolves a missing output path beneath the canonical workspace", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "out"), { recursive: true });

    await expect(
      resolveWorkspacePath(workspace, "out/answer.txt", "Reviewer outputPath"),
    ).resolves.toBe(join(workspace, "out", "answer.txt"));
  });

  it.each([
    ["", "absolute"],
    [resolve("/absolute.txt"), "absolute"],
    ["../outside.txt", "outside"],
    ["nested/../../outside.txt", "outside"],
  ] as const)("rejects uncontained path %j as %s", async (path, failure) => {
    const root = await temporaryRoot();
    const workspace = join(root, "workspace");
    await mkdir(workspace);

    await expect(
      resolveWorkspacePath(workspace, path, "Reviewer outputPath"),
    ).rejects.toMatchObject({
      name: "WorkspaceFileError",
      failure,
    });
  });

  it("rejects an output whose existing parent symlink escapes the workspace", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await Promise.all([mkdir(workspace), mkdir(outside)]);
    await symlink(outside, join(workspace, "linked"));

    await expect(
      resolveWorkspacePath(workspace, "linked/answer.txt", "Reviewer outputPath"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceFileError>>({
        name: "WorkspaceFileError",
        failure: "outside",
      }),
    );
  });

  it("accepts a regular file reached through a contained symlink", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "workspace");
    const target = join(workspace, "files", "answer.txt");
    await mkdir(join(workspace, "files"), { recursive: true });
    await writeFile(target, "answer");
    await symlink(target, join(workspace, "answer.txt"));

    await expect(
      resolveWorkspaceRegularFile(workspace, "answer.txt", "Reviewer output"),
    ).resolves.toBe(target);
  });

  it.each([
    ["missing.txt", "missing"],
    ["directory", "not-regular"],
    ["escaped.txt", "outside"],
  ] as const)("classifies invalid regular-file candidate %s as %s", async (path, failure) => {
    const root = await temporaryRoot();
    const workspace = join(root, "workspace");
    const outside = join(root, "outside.txt");
    await mkdir(join(workspace, "directory"), { recursive: true });
    await writeFile(outside, "outside");
    await symlink(outside, join(workspace, "escaped.txt"));

    await expect(
      resolveWorkspaceRegularFile(workspace, path, "Reviewer output"),
    ).rejects.toMatchObject({
      name: "WorkspaceFileError",
      failure,
    });
  });
});
