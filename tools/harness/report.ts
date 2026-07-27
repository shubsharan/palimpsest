import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes, sha256Hex, validateValue } from "@palimpsest/contracts";

import { sealAttempt, verifyTerminalAttempt, type AttemptClassification } from "./artifacts.js";
import { attemptPath, HARNESS_ROOT, type HarnessAttemptIdentity } from "./config.js";
import { identityFromArgs } from "./grade.js";
import { preflightBundle } from "./preflight.js";
import { validateReplayArtifacts } from "./replay.js";

function declarationDigest(value: Record<string, unknown>): string {
  return sha256Hex(canonicalJsonBytes(value));
}

function validScheduleEvidence(run: Record<string, unknown>): boolean {
  const policy = run.schedulePolicy as Record<string, unknown> | undefined;
  const observations = run.scheduleObservations;
  if (
    !policy ||
    !Array.isArray(observations) ||
    !Number.isSafeInteger(policy.toleranceMs) ||
    typeof policy.toleranceMs !== "number"
  ) {
    return false;
  }
  const expected = new Set([
    "reveal:1",
    "reveal:2",
    "publication:1",
    "push-close",
    "freeze",
    "finalization",
  ]);
  for (const value of observations) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const observation = value as Record<string, unknown>;
    const boundary = observation.boundary as Record<string, unknown> | undefined;
    if (!boundary || typeof boundary.kind !== "string") return false;
    const key =
      typeof boundary.ordinal === "number" ? `${boundary.kind}:${boundary.ordinal}` : boundary.kind;
    if (
      !expected.delete(key) ||
      typeof observation.driftMs !== "number" ||
      !Number.isFinite(observation.driftMs) ||
      Math.abs(observation.driftMs) > policy.toleranceMs
    ) {
      return false;
    }
  }
  return expected.size === 0;
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
  await writeFile(path, canonicalJsonBytes(report));
  return report;
}

export async function checkPredeclaration(root = "."): Promise<Record<string, unknown>> {
  const expectedWithInputs = await buildPredeclaration(root);
  const expected = { ...expectedWithInputs };
  delete expected.declarationInputs;
  const actual = JSON.parse(
    await readFile(resolve(root, HARNESS_ROOT, "predeclaration.json"), "utf8"),
  );
  if (!canonicalJsonBytes(actual).equals(canonicalJsonBytes(expected))) {
    throw new Error("Frozen offline harness predeclaration does not match current inputs.");
  }
  const verdict = validateValue("offline-harness-report", actual);
  if (!verdict.accepted) {
    throw new Error(`Frozen predeclaration is invalid: ${verdict.reason} at ${verdict.pointer}`);
  }
  return actual;
}

export async function completeAttempt(
  identity: HarnessAttemptIdentity,
  root = ".",
  options: { priorIdentity?: HarnessAttemptIdentity } = {},
): Promise<Record<string, unknown>> {
  const attempt = attemptPath(resolve(root, HARNESS_ROOT), identity);
  const required = [
    "run-manifest.json",
    "run-result.json",
    "live.jsonl",
    "git/freeze.json",
    "git/frozen.bundle",
    "git/ledgers.json",
    "git/publication.json",
    "submissions.json",
    "grading/solver-executions.json",
    "grading/score-report.json",
    "replay/trusted-replay.json",
    "replay/verdict.json",
    "public/report.json",
  ];
  await Promise.all(required.map((path) => readFile(resolve(attempt, path))));
  const predeclaration = await checkPredeclaration(root);
  if (predeclaration.declarationDigest !== identity.declarationDigest) {
    throw new Error("Completion identity does not match the frozen predeclaration.");
  }
  await validateReplayArtifacts(identity, root);
  const run = JSON.parse(await readFile(resolve(attempt, "run-result.json"), "utf8"));
  if (run.runId !== identity.runId || run.declarationDigest !== identity.declarationDigest) {
    throw new Error("Run result does not match the explicit completion identity.");
  }
  const externalModelRequestCount = run.externalModelRequestCount;
  if (!Number.isInteger(externalModelRequestCount) || externalModelRequestCount < 0) {
    throw new Error("Run result has an invalid external model request count.");
  }
  const executions = JSON.parse(
    await readFile(resolve(attempt, "grading/solver-executions.json"), "utf8"),
  ) as Record<string, unknown>[];
  const imageLock = JSON.parse(
    await readFile(resolve(root, "containers/images.lock.json"), "utf8"),
  );
  const container = run.containerEvidence;
  const ledgers = JSON.parse(
    await readFile(resolve(attempt, "git/ledgers.json"), "utf8"),
  ) as Record<string, unknown>[];
  const expectedLifecycle = [
    "PREPARED",
    "STARTING",
    "RUNNING",
    "PUSH_CLOSED",
    "DRAINING",
    "FROZEN",
    "FINALIZING",
    "SUBMITTED",
  ];
  let priorTerminalBytes: Buffer | undefined;
  let priorTerminalDigest: string | undefined;
  if (options.priorIdentity) {
    if (
      options.priorIdentity.declarationDigest !== identity.declarationDigest ||
      options.priorIdentity.runId === identity.runId
    ) {
      throw new Error("Isolation evidence requires a different run under the same declaration.");
    }
    const terminal = await verifyTerminalAttempt({
      root: resolve(root, HARNESS_ROOT),
      identity: options.priorIdentity,
    });
    await validateReplayArtifacts(options.priorIdentity, root);
    priorTerminalBytes = canonicalJsonBytes(terminal);
    priorTerminalDigest = sha256Hex(priorTerminalBytes);
  }
  const isolation = {
    realGit: true,
    processNetworkSandbox:
      container?.fixtureNetworkMode === "internal" &&
      container?.cleanSolverNetworkMode === "none" &&
      executions.length === 3 &&
      executions.every((execution) => execution.networkDisabled === true),
    digestPinnedContainerImages:
      typeof imageLock.baseImage === "string" &&
      /@sha256:[0-9a-f]{64}$/.test(imageLock.baseImage) &&
      container?.fixtureImageId === imageLock.fixtureAgent?.imageId &&
      container?.solverImageId === imageLock.cleanSolver?.imageId,
    authenticatedSmartHttpGateway: container?.authenticatedSmartHttpGateway === true,
    commonLaunchBarrier:
      typeof run.launchEpochMs === "number" &&
      Number.isFinite(run.launchEpochMs) &&
      run.launchEpochMs >= 0 &&
      canonicalJsonBytes(run.lifecycleStates).equals(canonicalJsonBytes(expectedLifecycle)),
    monotonicAbsoluteSchedule: validScheduleEvidence(run),
    transactionalGitAdmission:
      container?.hiddenPerAgentQuarantineRefs === true &&
      container?.transactionalGitAdmission === true &&
      ledgers.length === 3 &&
      ledgers.every((ledger) => ledger.result === "accepted"),
    repeatedAttemptIsolation: priorTerminalBytes !== undefined,
  };
  const passing =
    externalModelRequestCount === 0 && Object.values(isolation).every((value) => value === true);
  const result = externalModelRequestCount === 0 ? (passing ? "pass" : "rework") : "invalid";
  const report = {
    schemaVersion: 1,
    contractId: "offline-harness-report",
    state: "completed",
    declarationDigest: identity.declarationDigest,
    runId: identity.runId,
    result,
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
    externalModelRequestCount,
    liveModelValidationAuthorized: passing,
    empiricalModelEvidence: false,
  };
  const verdict = validateValue("offline-harness-report", report);
  if (!verdict.accepted) {
    throw new Error(`Completion report is invalid: ${verdict.reason} at ${verdict.pointer}`);
  }
  await writeFile(
    resolve(attempt, "completion-evidence.json"),
    canonicalJsonBytes({
      schemaVersion: 1,
      isolation,
      required,
      priorAttempt: options.priorIdentity
        ? {
            declarationDigest: options.priorIdentity.declarationDigest,
            runId: options.priorIdentity.runId,
            terminalSha256: priorTerminalDigest,
          }
        : null,
    }),
  );
  await writeFile(resolve(attempt, "offline-harness-report.json"), canonicalJsonBytes(report));
  if (options.priorIdentity && priorTerminalBytes) {
    const after = canonicalJsonBytes(
      await verifyTerminalAttempt({
        root: resolve(root, HARNESS_ROOT),
        identity: options.priorIdentity,
      }),
    );
    if (!after.equals(priorTerminalBytes)) {
      throw new Error("The second attempt changed the first terminal attempt.");
    }
  }
  const classification: AttemptClassification =
    result === "pass" ? "completed" : result === "invalid" ? "invalid" : "failed";
  await sealAttempt({
    root: resolve(root, HARNESS_ROOT),
    identity,
    classification,
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
