import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import { HARNESS_PRODUCER_VERSION, HARNESS_ROOT } from "./config.js";

const retainedInputs = [
  {
    path: "artifacts/gate-a/inputs/sources/middlemarch.txt",
    artifactType: "retained-source",
  },
  {
    path: "artifacts/gate-a/inputs/sources/jane-eyre.txt",
    artifactType: "reference-source",
  },
  {
    path: "artifacts/gate-a/inputs/sources/moby-dick.txt",
    artifactType: "reference-source",
  },
  {
    path: "artifacts/gate-b/inputs/entity-review/instance-amber.json",
    artifactType: "entity-review",
  },
  {
    path: "artifacts/gate-b/qualified-feasibility-decision.json",
    artifactType: "gate-b-qualified-decision",
  },
] as const;

export async function verifyHarnessInputs(root = "."): Promise<Record<string, unknown>> {
  const inputs = [];
  for (const input of retainedInputs) {
    const content = await readFile(resolve(root, input.path));
    inputs.push({
      ...input,
      byteLength: content.byteLength,
      sha256: sha256Hex(content),
    });
  }
  const manifest = {
    schemaVersion: 1,
    producer: {
      name: "palimpsest-harness-inputs",
      version: HARNESS_PRODUCER_VERSION,
    },
    modelProviderPolicy: {
      externalRequestsAllowed: false,
      providerCredentialRequired: false,
    },
    inputs,
  };
  const output = resolve(root, HARNESS_ROOT, "inputs", "manifest.json");
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, canonicalJsonBytes(manifest));
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await verifyHarnessInputs();
  process.stdout.write(`${canonicalJsonBytes(manifest).toString("utf8")}\n`);
}
