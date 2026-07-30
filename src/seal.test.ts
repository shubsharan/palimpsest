import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sealTree, verifyTree } from "./seal.js";

const roots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-tree-seal-"));
  roots.push(root);
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested", "artifact.txt"), "original\n");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("artifact tree seals", () => {
  it("round-trips an unchanged tree", async () => {
    const root = await fixture();
    const seal = await sealTree(root);

    await expect(verifyTree(root, seal)).resolves.toBeUndefined();
    expect(seal).toMatchObject({ schemaVersion: 1, fileCount: 1, byteCount: 9 });
  });

  it.each(["change", "addition", "deletion", "symlink", "mode"] as const)(
    "detects %s drift",
    async (kind) => {
      const root = await fixture();
      const seal = await sealTree(root);
      const artifact = join(root, "nested", "artifact.txt");
      if (kind === "change") await writeFile(artifact, "changed\n");
      if (kind === "addition") await writeFile(join(root, "added.txt"), "added\n");
      if (kind === "deletion") await unlink(artifact);
      if (kind === "symlink") await symlink("nested/artifact.txt", join(root, "link.txt"));
      if (kind === "mode") await chmod(artifact, 0o755);

      await expect(verifyTree(root, seal)).rejects.toThrow(/has drifted/);
    },
  );
});
