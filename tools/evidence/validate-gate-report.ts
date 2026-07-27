import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canonicalJsonBytes,
  parseJsonStrict,
  sha256Hex,
  validateGateReport,
} from "@palimpsest/contracts";

const path = process.argv.at(-1);
if (!path || path.startsWith("-") || path.endsWith("validate-gate-report.ts")) {
  throw new Error("Usage: pnpm evidence:gate-report -- <gate-report.json>");
}
const value = parseJsonStrict(await readFile(resolve(path), "utf8"));
if (value === null || typeof value !== "object" || Array.isArray(value)) {
  throw new Error("Gate report must be a JSON object.");
}
const verdict = validateGateReport(value);
if (!verdict.accepted) {
  throw new Error(`Invalid gate report: ${verdict.reason} at ${verdict.pointer}`);
}
const bytes = canonicalJsonBytes(value);
process.stdout.write(`Valid gate report (${bytes.length} bytes, sha256 ${sha256Hex(bytes)}).\n`);
