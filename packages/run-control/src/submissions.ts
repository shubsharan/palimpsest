import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import type { PrivateSubmission } from "./types.js";

async function outputPaths(root: string, current = root): Promise<string[]> {
  const paths: string[] = [];
  for (const name of (await readdir(current)).sort()) {
    const path = join(current, name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Private submission output must not be a symbolic link: ${path}`);
    }
    if (metadata.isDirectory()) {
      paths.push(...(await outputPaths(root, path)));
    } else if (metadata.isFile() && name !== "manifest.json") {
      paths.push(relative(root, path).split(sep).join("/"));
    } else if (!metadata.isFile()) {
      throw new Error(`Private submission output must be a regular file: ${path}`);
    }
  }
  return paths.sort();
}

export async function sealPrivateSubmission(options: {
  root: string;
  agentId: string;
  runId: string;
  freezeId: string;
  releasedShardDigest: string;
}): Promise<PrivateSubmission> {
  const outputs = await Promise.all(
    (await outputPaths(options.root)).map(async (path) => {
      const content = await readFile(join(options.root, path));
      return { path, byteLength: content.byteLength, sha256: sha256Hex(content) };
    }),
  );
  const manifest = {
    schemaVersion: 1 as const,
    contractId: "private-deliverable-manifest" as const,
    runId: options.runId,
    agentId: options.agentId,
    freezeId: options.freezeId,
    releasedShardDigest: options.releasedShardDigest,
    outputs,
  };
  await writeFile(join(options.root, "manifest.json"), canonicalJsonBytes(manifest));
  return manifest;
}
