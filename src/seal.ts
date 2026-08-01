import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { contentDigest } from "./canonical.js";

export interface TreeSeal {
  schemaVersion: 1;
  digest: string;
  fileCount: number;
  byteCount: number;
}

type TreeEntry =
  | { path: string; type: "directory" }
  | { path: string; type: "symlink"; target: string }
  | {
      path: string;
      type: "file";
      byteLength: number;
      executable: boolean;
      sha256: string;
    };

function portablePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function treeEntries(
  root: string,
  directory: string,
  entries: TreeEntry[],
): Promise<{ fileCount: number; byteCount: number }> {
  let fileCount = 0;
  let byteCount = 0;
  const children = await readdir(directory);
  children.sort();
  for (const name of children) {
    const path = join(directory, name);
    const relativePath = portablePath(root, path);
    const metadata = await lstat(path);
    if (metadata.isDirectory()) {
      entries.push({ path: relativePath, type: "directory" });
      const nested = await treeEntries(root, path, entries);
      fileCount += nested.fileCount;
      byteCount += nested.byteCount;
    } else if (metadata.isFile()) {
      entries.push({
        path: relativePath,
        type: "file",
        byteLength: metadata.size,
        executable: (metadata.mode & 0o111) !== 0,
        sha256: await fileDigest(path),
      });
      fileCount += 1;
      byteCount += metadata.size;
    } else if (metadata.isSymbolicLink()) {
      entries.push({ path: relativePath, type: "symlink", target: await readlink(path) });
    } else {
      throw new Error(`Artifact tree contains unsupported entry ${relativePath}.`);
    }
    if (!Number.isSafeInteger(fileCount) || !Number.isSafeInteger(byteCount)) {
      throw new Error("Artifact tree size exceeds the safe integer range.");
    }
  }
  return { fileCount, byteCount };
}

export async function sealTree(root: string): Promise<TreeSeal> {
  const resolvedRoot = resolve(root);
  const metadata = await lstat(resolvedRoot);
  if (!metadata.isDirectory()) {
    throw new Error(`Artifact tree root is not a directory: ${resolvedRoot}`);
  }
  const entries: TreeEntry[] = [];
  const totals = await treeEntries(resolvedRoot, resolvedRoot, entries);
  return {
    schemaVersion: 1,
    digest: contentDigest({ schemaVersion: 1, entries }),
    ...totals,
  };
}

export async function verifyTree(
  root: string,
  expected: TreeSeal,
  name = "Artifact tree",
): Promise<void> {
  const actual = await sealTree(root);
  if (
    actual.digest !== expected.digest ||
    actual.fileCount !== expected.fileCount ||
    actual.byteCount !== expected.byteCount
  ) {
    throw new Error(`${name} has drifted.`);
  }
}
