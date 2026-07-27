import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { canonicalArchiveBytes } from "@palimpsest/contracts";

import {
  promoteBytes as promoteGateABytes,
  referenceBundle,
  referenceFile,
  writeCanonicalJson,
} from "../gate-a/artifacts.js";

export { referenceBundle, referenceFile, writeCanonicalJson };

export async function promoteGateBBytes(bytes: Buffer, artifactType: string) {
  return promoteGateABytes(bytes, artifactType, "artifacts/gate-b/by-digest");
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

export async function promoteGateBBundle(artifactType: string, roots: string[]) {
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
  return promoteGateBBytes(
    canonicalArchiveBytes({
      contractId: "canonical-archive",
      entries,
      schemaVersion: 1,
    }),
    artifactType,
  );
}
