import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { canonicalJsonBytes, sha256Hex, validateValue } from "@palimpsest/contracts";

import { attemptPath } from "./config.js";
import { HARNESS_ROOT, type HarnessAttemptIdentity } from "./config.js";

const execFileAsync = promisify(execFile);

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

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
  if (await pathExists(resolve(attempt, "terminal.json"))) {
    throw new Error("A terminal attempt cannot be graded again.");
  }
  const runManifest = JSON.parse(await readFile(resolve(attempt, "run-manifest.json"), "utf8"));
  const runVerdict = validateValue("run-manifest", runManifest);
  if (!runVerdict.accepted) {
    throw new Error(`Run manifest is invalid: ${runVerdict.reason} at ${runVerdict.pointer}`);
  }
  const bundleManifest = await readFile(resolve(bundle, "bundle-manifest.json"));
  if (
    runManifest.runId !== identity.runId ||
    runManifest.declarationDigest !== identity.declarationDigest ||
    runManifest.instance?.byteLength !== bundleManifest.byteLength ||
    runManifest.instance?.sha256 !== sha256Hex(bundleManifest)
  ) {
    throw new Error("Grading inputs do not bind the explicit attempt and declared bundle.");
  }
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
  if (executions.length !== 3) {
    throw new Error("Grading requires exactly three clean-solver executions.");
  }
  for (const execution of executions) {
    const verdict = validateValue("solver-execution", execution);
    if (!verdict.accepted) {
      throw new Error(`Solver execution is invalid: ${verdict.reason} at ${verdict.pointer}`);
    }
    if ((execution as Record<string, unknown>).runId !== identity.runId) {
      throw new Error("Solver execution does not match the explicit attempt.");
    }
  }
  const score = JSON.parse(await readFile(resolve(attempt, "grading/score-report.json"), "utf8"));
  const verdict = validateValue("score-report", score);
  if (!verdict.accepted) {
    throw new Error(`Score report is invalid: ${verdict.reason} at ${verdict.pointer}`);
  }
  if (score.runId !== identity.runId) {
    throw new Error("Score report does not match the explicit attempt.");
  }
  return score as Record<string, unknown>;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${canonicalJsonBytes(await gradeAttempt(identityFromArgs())).toString("utf8")}\n`,
  );
}
