import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { canonicalArchiveBytes, canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

export interface ArtifactReference {
  artifactType: string;
  byteLength: number;
  sha256: string;
}

export async function writeCanonicalJson(path: string, value: unknown): Promise<Buffer> {
  const bytes = canonicalJsonBytes(value);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return bytes;
}

export async function referenceFile(
  path: string,
  artifactType: string,
): Promise<ArtifactReference> {
  const bytes = await readFile(path);
  return {
    artifactType,
    byteLength: bytes.length,
    sha256: sha256Hex(bytes),
  };
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const paths: string[] = [];
  for (const name of (await readdir(current)).sort()) {
    if (
      name === ".DS_Store" ||
      name === ".cache" ||
      name === ".pytest_cache" ||
      name === ".ruff_cache" ||
      name === "__pycache__" ||
      name.endsWith(".pyc")
    ) {
      continue;
    }
    const path = join(current, name);
    const metadata = await stat(path);
    if (metadata.isDirectory()) {
      paths.push(...(await listFiles(root, path)));
    } else if (metadata.isFile()) {
      paths.push(relative(root, path).split(sep).join("/"));
    }
  }
  return paths;
}

export async function referenceBundle(
  artifactType: string,
  roots: string[],
): Promise<ArtifactReference> {
  const entries = [];
  for (const root of [...roots].sort()) {
    const metadata = await stat(root);
    if (metadata.isFile()) {
      entries.push({
        contentBase64: (await readFile(root)).toString("base64"),
        kind: "file" as const,
        path: root.split(sep).join("/"),
      });
      continue;
    }
    for (const path of await listFiles(root)) {
      entries.push({
        contentBase64: (await readFile(join(root, path))).toString("base64"),
        kind: "file" as const,
        path: join(root, path).split(sep).join("/"),
      });
    }
  }
  const bytes = canonicalArchiveBytes({
    contractId: "canonical-archive",
    entries,
    schemaVersion: 1,
  });
  return {
    artifactType,
    byteLength: bytes.length,
    sha256: sha256Hex(bytes),
  };
}

export async function promoteBytes(
  bytes: Buffer,
  artifactType: string,
  root = "artifacts/gate-a/by-digest",
): Promise<ArtifactReference> {
  const sha256 = sha256Hex(bytes);
  const destination = join(root, sha256);
  await mkdir(root, { recursive: true });
  const existing = await readFile(destination).catch(() => undefined);
  if (existing) {
    if (!existing.equals(bytes)) {
      throw new Error(`Digest store collision at ${destination}.`);
    }
  } else {
    const staging = join(root, `.${sha256}.${process.pid}.tmp`);
    await writeFile(staging, bytes);
    try {
      await rename(staging, destination);
    } catch (error) {
      const raced = await readFile(destination).catch(() => undefined);
      if (!raced?.equals(bytes)) {
        throw error;
      }
      await rm(staging, { force: true });
    }
  }
  return { artifactType, byteLength: bytes.length, sha256 };
}
