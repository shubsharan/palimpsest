import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { integerFlag, numberFlag, parseFlags, requiredFlag, runPythonJson } from "./common.js";

export interface BuildPuzzleOptions {
  root: string;
  output: string;
  seed?: number;
  stageIntervalMs?: number;
  transitionStage?: number;
  changedTokenMass?: number;
}

export interface BuildPuzzleResult {
  buildId: string;
  buildPath: string;
  agentCount: number;
  stageCount: number;
  transitionStage: number;
}

function requireBuildResult(value: Record<string, unknown>): BuildPuzzleResult {
  const fields = ["buildId", "buildPath"] as const;
  for (const field of fields) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error(`Puzzle builder omitted ${field}.`);
    }
  }
  for (const field of ["agentCount", "stageCount", "transitionStage"] as const) {
    if (!Number.isSafeInteger(value[field])) throw new Error(`Puzzle builder omitted ${field}.`);
  }
  return value as unknown as BuildPuzzleResult;
}

export async function buildPuzzle(options: BuildPuzzleOptions): Promise<BuildPuzzleResult> {
  const root = resolve(options.root);
  const output = resolve(options.output);
  return requireBuildResult(
    await runPythonJson(root, "palimpsest.puzzle.build", [
      "--root",
      root,
      "--output",
      output,
      "--seed",
      String(options.seed ?? 0),
      "--stage-interval-ms",
      String(options.stageIntervalMs ?? 120_000),
      "--transition-stage",
      String(options.transitionStage ?? 4),
      "--changed-token-mass",
      String(options.changedTokenMass ?? 0.2),
    ]),
  );
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const result = await buildPuzzle({
    root: resolve("."),
    output: requiredFlag(flags, "--output"),
    seed: integerFlag(flags, "--seed", 0),
    stageIntervalMs: integerFlag(flags, "--stage-interval-ms", 120_000),
    transitionStage: integerFlag(flags, "--transition-stage", 4),
    changedTokenMass: numberFlag(flags, "--changed-token-mass", 0.2),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
