import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes, sha256Hex, validateValue } from "@palimpsest/contracts";

import { AGENT_IDS, HARNESS_ROOT } from "./config.js";

interface OutputEntry {
  path: string;
  byteLength: number;
  sha256: string;
}

interface BundleManifest {
  schemaVersion: 1;
  bundleId: string;
  outputs: OutputEntry[];
}

async function regularFiles(root: string, current = root): Promise<string[]> {
  const output: string[] = [];
  for (const name of (await readdir(current)).sort()) {
    const path = join(current, name);
    const metadata = await stat(path);
    if (metadata.isDirectory()) {
      output.push(...(await regularFiles(root, path)));
    } else if (metadata.isFile()) {
      output.push(relative(root, path).split(sep).join("/"));
    } else {
      throw new Error(`Bundle contains a non-regular entry: ${path}`);
    }
  }
  return output.sort();
}

async function validateRecord(
  bundleRoot: string,
  path: string,
  contractId: Parameters<typeof validateValue>[0],
): Promise<void> {
  const value = JSON.parse(await readFile(join(bundleRoot, path), "utf8"));
  const verdict = validateValue(contractId, value);
  if (!verdict.accepted) {
    throw new Error(`${path} violates ${contractId}: ${verdict.reason} at ${verdict.pointer}`);
  }
}

export async function preflightBundle(bundleRoot: string): Promise<BundleManifest> {
  const manifest = JSON.parse(
    await readFile(join(bundleRoot, "bundle-manifest.json"), "utf8"),
  ) as BundleManifest;
  const declaredPaths = manifest.outputs.map((entry) => entry.path);
  const actualPaths = (await regularFiles(bundleRoot)).filter(
    (path) => path !== "bundle-manifest.json",
  );
  if (canonicalJsonBytes(declaredPaths).compare(canonicalJsonBytes(actualPaths)) !== 0) {
    throw new Error("Bundle exact output set does not match bundle-manifest.json.");
  }
  for (const entry of manifest.outputs) {
    const content = await readFile(join(bundleRoot, entry.path));
    if (content.byteLength !== entry.byteLength || sha256Hex(content) !== entry.sha256) {
      throw new Error(`Bundle artifact digest mismatch: ${entry.path}`);
    }
  }
  const computedBundleId = sha256Hex(canonicalJsonBytes(manifest.outputs));
  if (computedBundleId !== manifest.bundleId) {
    throw new Error("Bundle identity does not match its exact declared outputs.");
  }

  await validateRecord(bundleRoot, "build-request.json", "instance-build-request");
  await validateRecord(bundleRoot, "public/manifest.json", "public-instance-manifest");
  await validateRecord(bundleRoot, "reference/manifest.json", "agent-reference-corpus-manifest");
  await validateRecord(bundleRoot, "sealed/oracle-manifest.json", "oracle-manifest");
  await validateRecord(bundleRoot, "trusted/difficulty.json", "difficulty-config");
  await validateRecord(bundleRoot, "trusted/scoring.json", "scoring-policy");
  for (const agentId of AGENT_IDS) {
    await validateRecord(bundleRoot, `private/${agentId}/shard-manifest.json`, "shard-manifest");
  }

  const publicText = (
    await Promise.all(
      (
        await regularFiles(join(bundleRoot, "public"))
      ).map((path) => readFile(join(bundleRoot, "public", path), "utf8")),
    )
  )
    .join("\n")
    .toLowerCase();
  for (const forbidden of ["middlemarch", "stationary-key", "prepared-plaintext"]) {
    if (publicText.includes(forbidden)) {
      throw new Error(`Public bundle leaks forbidden oracle marker: ${forbidden}`);
    }
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bundleRoot = process.argv[2] ?? resolve(HARNESS_ROOT, "declared");
  const result = await preflightBundle(bundleRoot);
  process.stdout.write(`${canonicalJsonBytes(result).toString("utf8")}\n`);
}
