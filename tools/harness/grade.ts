import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { canonicalJsonBytes, validateValue } from "@palimpsest/contracts";

import { attemptPath } from "./config.js";
import { HARNESS_ROOT, type HarnessAttemptIdentity } from "./config.js";

const execFileAsync = promisify(execFile);

export function identityFromArgs(): HarnessAttemptIdentity {
  const digestIndex = process.argv.indexOf("--declaration-digest");
  const runIndex = process.argv.indexOf("--run-id");
  const declarationDigest = process.argv[digestIndex + 1];
  const runId = process.argv[runIndex + 1];
  if (digestIndex < 0 || runIndex < 0 || !declarationDigest || !runId) {
    throw new Error("--declaration-digest and --run-id are required.");
  }
  return { declarationDigest, runId };
}

export async function gradeAttempt(
  identity: HarnessAttemptIdentity,
  root = ".",
): Promise<Record<string, unknown>> {
  const attempt = attemptPath(resolve(root, HARNESS_ROOT), identity);
  const bundle = resolve(root, HARNESS_ROOT, "declared");
  await execFileAsync(
    "uv",
    [
      "run",
      "--offline",
      "--frozen",
      "--project",
      "python",
      "python",
      "-m",
      "palimpsest.solver.executor",
      "--run-id",
      identity.runId,
      "--attempt",
      attempt,
      "--bundle",
      bundle,
    ],
    { cwd: resolve(root), maxBuffer: 32 * 1024 * 1024 },
  );
  await execFileAsync(
    "uv",
    [
      "run",
      "--offline",
      "--frozen",
      "--project",
      "python",
      "python",
      "-m",
      "palimpsest.grading.score_report",
      "--run-id",
      identity.runId,
      "--attempt",
      attempt,
      "--bundle",
      bundle,
    ],
    { cwd: resolve(root), maxBuffer: 32 * 1024 * 1024 },
  );
  const executions = JSON.parse(
    await readFile(resolve(attempt, "grading/solver-executions.json"), "utf8"),
  ) as unknown[];
  for (const execution of executions) {
    const verdict = validateValue("solver-execution", execution);
    if (!verdict.accepted) {
      throw new Error(`Solver execution is invalid: ${verdict.reason} at ${verdict.pointer}`);
    }
  }
  const score = JSON.parse(await readFile(resolve(attempt, "grading/score-report.json"), "utf8"));
  const verdict = validateValue("score-report", score);
  if (!verdict.accepted) {
    throw new Error(`Score report is invalid: ${verdict.reason} at ${verdict.pointer}`);
  }
  return score as Record<string, unknown>;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${canonicalJsonBytes(await gradeAttempt(identityFromArgs())).toString("utf8")}\n`,
  );
}
