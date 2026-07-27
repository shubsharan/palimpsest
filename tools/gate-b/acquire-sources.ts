import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { sha256Hex } from "@palimpsest/contracts";

import { gateBModelRevision } from "./config.js";

const execFileAsync = promisify(execFile);
const shearerPath = resolve("artifacts/gate-b/inputs/sources/farm-mechanics.txt");
const shearerUrl = "https://www.gutenberg.org/cache/epub/39791/pg39791.txt";
const shearerSha256 = "c8b07a01d823bfddba73495f9448f7dfa58c3847e37ffb8c50fcb45f4a34ed51";
const modelRoot = resolve("artifacts/gate-b/inputs/models/distilroberta-base");
const requiredModelFiles = [
  "config.json",
  "merges.txt",
  "model.safetensors",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
] as const;

async function acquireShearer(): Promise<void> {
  let bytes = await readFile(shearerPath).catch(() => undefined);
  if (!bytes) {
    const response = await fetch(shearerUrl);
    if (!response.ok) {
      throw new Error(`Source acquisition failed with HTTP ${response.status}.`);
    }
    bytes = Buffer.from(await response.arrayBuffer());
    await mkdir(dirname(shearerPath), { recursive: true });
    await writeFile(shearerPath, bytes);
  }
  if (sha256Hex(bytes) !== shearerSha256) {
    throw new Error("Shearer source digest does not match the frozen Project Gutenberg edition.");
  }
}

async function acquireModel(): Promise<void> {
  const missing = [];
  for (const name of requiredModelFiles) {
    if (!(await readFile(resolve(modelRoot, name)).catch(() => undefined))) {
      missing.push(name);
    }
  }
  if (missing.length === 0) {
    return;
  }
  await mkdir(modelRoot, { recursive: true });
  await execFileAsync("hf", [
    "download",
    "distilbert/distilroberta-base",
    "--revision",
    gateBModelRevision,
    "--local-dir",
    modelRoot,
    ...requiredModelFiles,
  ]);
  for (const name of requiredModelFiles) {
    if (!(await readFile(resolve(modelRoot, name)).catch(() => undefined))) {
      throw new Error(`Model acquisition did not produce ${name}.`);
    }
  }
}

export async function acquireGateBInputs(): Promise<void> {
  await Promise.all([acquireShearer(), acquireModel()]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await acquireGateBInputs();
}
