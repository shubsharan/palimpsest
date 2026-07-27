import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes, sha256Hex, validateValue } from "@palimpsest/contracts";

import { sealAttempt, verifyTerminalAttempt } from "./artifacts.js";
import {
  attemptPath,
  HARNESS_ROOT,
  type HarnessAttemptIdentity,
} from "./config.js";
import { identityFromArgs } from "./grade.js";
import { preflightBundle } from "./preflight.js";

function declarationDigest(value: Record<string, unknown>): string {
  return sha256Hex(canonicalJsonBytes(value));
}

export async function buildPredeclaration(root = "."): Promise<Record<string, unknown>> {
  const bundle = await preflightBundle(resolve(root, HARNESS_ROOT, "declared"));
  const inputs = JSON.parse(
    await readFile(resolve(root, HARNESS_ROOT, "inputs", "manifest.json"), "utf8"),
  );
  const declaration = {
    schemaVersion: 1,
    contractId: "offline-harness-report",
    state: "predeclared",
    declarationDigest: "",
    runId: "pending",
    result: "pending",
    completedStages: ["build"],
    externalModelRequestCount: 0,
    liveModelValidationAuthorized: false,
    empiricalModelEvidence: false,
  };
  const digestInputs = {
    schemaVersion: 1,
    bundleId: bundle.bundleId,
    inputManifestDigest: sha256Hex(canonicalJsonBytes(inputs)),
    adapterId: "fixture-agent-v1",
    modelProviderPolicy: "external-requests-forbidden",
  };
  declaration.declarationDigest = declarationDigest(digestInputs);
  const verdict = validateValue("offline-harness-report", declaration);
  if (!verdict.accepted) {
    throw new Error(`Predeclaration is invalid: ${verdict.reason} at ${verdict.pointer}`);
  }
  return { ...declaration, declarationInputs: digestInputs };
}

export async function writePredeclaration(root = "."): Promise<Record<string, unknown>> {
  const value = await buildPredeclaration(root);
  const report = { ...value };
  delete report.declarationInputs;
  const path = resolve(root, HARNESS_ROOT, "predeclaration.json");
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, canonicalJsonBytes(value));
  return value;
}

export async function checkPredeclaration(root = "."): Promise<Record<string, unknown>> {
  const expected = await buildPredeclaration(root);
  const actual = JSON.parse(
    await readFile(resolve(root, HARNESS_ROOT, "predeclaration.json"), "utf8"),
  );
  if (!canonicalJsonBytes(actual).equals(canonicalJsonBytes(expected))) {
    throw new Error("Frozen offline harness predeclaration does not match current inputs.");
  }
  return actual;
}

export async function completeAttempt(
  identity: HarnessAttemptIdentity,
  root = ".",
): Promise<Record<string, unknown>> {
  const attempt = attemptPath(resolve(root, HARNESS_ROOT), identity);
  const required = [
    "run-result.json",
    "git/freeze.json",
    "submissions.json",
    "grading/solver-executions.json",
    "grading/score-report.json",
    "replay/trusted-replay.json",
    "replay/verdict.json",
    "public/report.json",
  ];
  await Promise.all(required.map((path) => readFile(resolve(attempt, path))));
  const run = JSON.parse(await readFile(resolve(attempt, "run-result.json"), "utf8"));
  const isolation = {
    realGit: true,
    processNetworkSandbox: true,
    digestPinnedContainerImages: false,
    authenticatedSmartHttpGateway: true,
    repeatedAttemptIsolation: false,
  };
  const passing =
    run.externalModelRequestCount === 0 &&
    Object.values(isolation).every((value) => value === true);
  const report = {
    schemaVersion: 1,
    contractId: "offline-harness-report",
    state: "completed",
    declarationDigest: identity.declarationDigest,
    runId: identity.runId,
    result: passing ? "pass" : "rework",
    completedStages: [
      "build",
      "launch",
      "reveal",
      "collaborate",
      "freeze",
      "submit",
      "clean-execute",
      "score",
      "replay",
      "redact",
    ],
    externalModelRequestCount: 0,
    liveModelValidationAuthorized: passing,
    empiricalModelEvidence: false,
  };
  const verdict = validateValue("offline-harness-report", report);
  if (!verdict.accepted) {
    throw new Error(`Completion report is invalid: ${verdict.reason} at ${verdict.pointer}`);
  }
  await writeFile(
    resolve(attempt, "completion-evidence.json"),
    canonicalJsonBytes({ schemaVersion: 1, isolation, required }),
  );
  await writeFile(resolve(attempt, "offline-harness-report.json"), canonicalJsonBytes(report));
  await sealAttempt({
    root: resolve(root, HARNESS_ROOT),
    identity,
    classification: passing ? "completed" : "failed",
  });
  await verifyTerminalAttempt({ root: resolve(root, HARNESS_ROOT), identity });
  return report;
}

async function main(): Promise<void> {
  if (process.argv.includes("--predeclare")) {
    process.stdout.write(`${canonicalJsonBytes(await writePredeclaration()).toString("utf8")}\n`);
    return;
  }
  if (process.argv.includes("--check")) {
    process.stdout.write(`${canonicalJsonBytes(await checkPredeclaration()).toString("utf8")}\n`);
    return;
  }
  if (process.argv.includes("--complete")) {
    process.stdout.write(
      `${canonicalJsonBytes(await completeAttempt(identityFromArgs())).toString("utf8")}\n`,
    );
    return;
  }
  throw new Error("Select --predeclare, --check, or --complete.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
