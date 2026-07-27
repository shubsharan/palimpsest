import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes } from "@palimpsest/contracts";

import { buildHarnessBundle } from "./build.js";
import type { HarnessAttemptIdentity } from "./config.js";
import { gradeAttempt } from "./grade.js";
import { verifyHarnessInputs } from "./inputs.js";
import { replayAttempt } from "./replay.js";
import { completeAttempt, writePredeclaration } from "./report.js";
import { runOfflineHarness } from "./run.js";

type CompleteOptions = { priorIdentity?: HarnessAttemptIdentity };

interface OfflineStages {
  verifyInputs(root: string): Promise<unknown>;
  buildBundle(root: string): Promise<unknown>;
  writePredeclaration(root: string): Promise<unknown>;
  runAttempt(options: { root: string; runId: string }): Promise<HarnessAttemptIdentity>;
  grade(identity: HarnessAttemptIdentity, root: string): Promise<unknown>;
  replay(identity: HarnessAttemptIdentity, root: string): Promise<unknown>;
  complete(
    identity: HarnessAttemptIdentity,
    root: string,
    options?: CompleteOptions,
  ): Promise<Record<string, unknown>>;
}

export interface ComposedOfflineOptions {
  runIds?: readonly [string, string];
  stages?: OfflineStages;
}

const defaultStages: OfflineStages = {
  verifyInputs: verifyHarnessInputs,
  buildBundle: buildHarnessBundle,
  writePredeclaration,
  runAttempt: runOfflineHarness,
  grade: gradeAttempt,
  replay: replayAttempt,
  complete: completeAttempt,
};

function freshRunIds(): readonly [string, string] {
  const nonce = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  return [`offline-${nonce}-a`, `offline-${nonce}-b`];
}

async function executeAttempt(
  stages: OfflineStages,
  root: string,
  runId: string,
  priorIdentity?: HarnessAttemptIdentity,
): Promise<{ identity: HarnessAttemptIdentity; report: Record<string, unknown> }> {
  const identity = await stages.runAttempt({ root, runId });
  await stages.grade(identity, root);
  await stages.replay(identity, root);
  const report = await stages.complete(identity, root, priorIdentity ? { priorIdentity } : {});
  if (report.externalModelRequestCount !== 0) {
    throw new Error("Offline harness attempted an external model request.");
  }
  return { identity, report };
}

export async function runComposedOfflineHarness(
  root = ".",
  options: ComposedOfflineOptions = {},
): Promise<Record<string, unknown>> {
  const stages = options.stages ?? defaultStages;
  const runIds = options.runIds ?? freshRunIds();
  if (runIds[0] === runIds[1]) {
    throw new Error("Composed isolation verification requires two distinct run IDs.");
  }
  await stages.verifyInputs(root);
  await stages.buildBundle(root);
  await stages.writePredeclaration(root);
  const first = await executeAttempt(stages, root, runIds[0]);
  if (first.report.result !== "rework" || first.report.liveModelValidationAuthorized !== false) {
    throw new Error("The first attempt must remain unauthorized until retry isolation is proven.");
  }
  const second = await executeAttempt(stages, root, runIds[1], first.identity);
  if (second.report.result !== "pass" || second.report.liveModelValidationAuthorized !== true) {
    throw new Error("The second isolated attempt did not satisfy the completion predicates.");
  }
  return second.report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${canonicalJsonBytes(await runComposedOfflineHarness()).toString("utf8")}\n`,
  );
}
