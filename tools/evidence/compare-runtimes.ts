import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  buildFixtureVerdicts,
  canonicalArchiveBytes,
  canonicalJsonBytes,
  sha256Hex,
} from "@palimpsest/contracts";

const fixturesRoot = new URL("../../packages/contracts/fixtures/", import.meta.url);

export async function buildRuntimeVerdicts(
  runtime: "typescript",
): Promise<Record<string, unknown>[]> {
  if (runtime !== "typescript") {
    throw new Error(`Unsupported runtime: ${runtime}`);
  }
  return buildFixtureVerdicts(fixturesRoot);
}

async function main(): Promise<void> {
  const typeScriptVerdicts = await buildRuntimeVerdicts("typescript");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)(
    "uv",
    [
      "run",
      "--project",
      "python",
      "python",
      "-m",
      "palimpsest.contracts.validation",
      "--fixture-verdicts",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const pythonVerdicts = JSON.parse(stdout);
  if (JSON.stringify(typeScriptVerdicts) !== JSON.stringify(pythonVerdicts)) {
    throw new Error("TypeScript and Python fixture verdicts differ.");
  }

  const archiveVerdicts = typeScriptVerdicts.filter((verdict) => verdict.archiveBase64 !== null);
  if (archiveVerdicts.length === 0) {
    throw new Error("No canonical archive fixtures were exercised.");
  }
  const evidence = canonicalJsonBytes({
    schemaVersion: 1,
    fixtureCount: typeScriptVerdicts.length,
    verdicts: typeScriptVerdicts,
  });
  const evidencePath = resolve("artifacts/milestone-1/contract-verdicts.json");
  if (process.argv.includes("--write")) {
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, evidence);
  } else {
    const recorded = await readFile(evidencePath).catch(() => undefined);
    if (!recorded?.equals(evidence)) {
      throw new Error(
        "Recorded contract verdict evidence is missing or stale; regenerate it with pnpm contracts:compare -- --write.",
      );
    }
  }
  process.stdout.write(
    `Cross-runtime fixtures agree (${typeScriptVerdicts.length} fixtures, evidence sha256 ${sha256Hex(evidence)}).\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

export { canonicalArchiveBytes };
