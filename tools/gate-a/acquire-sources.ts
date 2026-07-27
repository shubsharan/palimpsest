import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import { gateASourceDefinitions } from "./config.js";

const sourceRoot = resolve("artifacts/gate-a/inputs/sources");

async function acquireSource(source: (typeof gateASourceDefinitions)[number]) {
  const response = await fetch(source.downloadUrl, {
    headers: { "user-agent": "palimpsest-gate-a-input-builder/1.0.0" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Source acquisition failed for ${source.sourceId}: HTTP ${response.status}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString("utf8");
  if (
    !text.includes("*** START OF THE PROJECT GUTENBERG EBOOK") ||
    !text.includes("Project Gutenberg License")
  ) {
    throw new Error(`Source ${source.sourceId} lacks the expected text and license markers.`);
  }
  await writeFile(resolve(sourceRoot, `${source.sourceId}.txt`), bytes);
  return {
    ...source,
    byteLength: bytes.length,
    contentType: response.headers.get("content-type") ?? "unknown",
    license: "Project Gutenberg License; catalog record states public domain in the USA",
    retrievedAt: "2026-07-26",
    sha256: sha256Hex(bytes),
  };
}

await mkdir(sourceRoot, { recursive: true });
const sources = [];
for (const definition of gateASourceDefinitions) {
  sources.push(await acquireSource(definition));
}
await writeFile(
  resolve(sourceRoot, "provenance.json"),
  canonicalJsonBytes({
    acquisitionBoundary: "trusted-pre-run",
    contractId: "gate-a-source-provenance",
    schemaVersion: 1,
    sources,
  }),
);
