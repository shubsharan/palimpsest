import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateValue } from "@palimpsest/contracts";

import { referenceFile, writeCanonicalJson } from "../gate-a/artifacts.js";
import {
  FRONTIER_MAX_OUTPUT_TOKENS,
  FRONTIER_MODEL,
  FRONTIER_REASONING_EFFORT,
  FRONTIER_REASONING_SUMMARY,
  FRONTIER_RESPONSE_TIMEOUT_MS,
  REVEAL_EARLY_TOLERANCE_MS,
  REVEAL_INTERVAL_MS,
  REVEAL_LATE_TOLERANCE_MS,
  REVEAL_SLOT_COUNT,
} from "./config.js";

const requiredInputs = [
  {
    path: "artifacts/gate-a/inputs/sources/middlemarch.txt",
    artifactType: "gate-c-source",
  },
  {
    path: "artifacts/gate-b/inputs/entity-review/instance-amber.json",
    artifactType: "gate-c-entity-review",
  },
  {
    path: "artifacts/gate-b/qualified-feasibility-decision.json",
    artifactType: "gate-b-qualified-decision",
  },
] as const;

export async function verifyGateCInputs(): Promise<void> {
  await writeCanonicalJson(resolve("artifacts/gate-c/inputs/solver-policy.json"), {
    schemaVersion: 1,
    model: FRONTIER_MODEL,
    reasoningEffort: FRONTIER_REASONING_EFFORT,
    reasoningSummary: FRONTIER_REASONING_SUMMARY,
    maxOutputTokens: FRONTIER_MAX_OUTPUT_TOKENS,
    maximumResponseMs: FRONTIER_RESPONSE_TIMEOUT_MS,
    maximumRetries: 0,
    codeInterpreter: {
      containerMemory: "4g",
      networkPolicy: "disabled",
      incrementalUploads: true,
    },
    revealClock: {
      type: "monotonic",
      slotCount: REVEAL_SLOT_COUNT,
      intervalMs: REVEAL_INTERVAL_MS,
      earlyReleaseToleranceMs: REVEAL_EARLY_TOLERANCE_MS,
      retryableLatenessMs: REVEAL_LATE_TOLERANCE_MS,
    },
  });
  const inputs = [];
  for (const input of requiredInputs) {
    await readFile(input.path);
    inputs.push({
      path: input.path,
      ...(await referenceFile(input.path, input.artifactType)),
    });
  }
  inputs.push({
    path: "artifacts/gate-c/inputs/solver-policy.json",
    ...(await referenceFile("artifacts/gate-c/inputs/solver-policy.json", "gate-c-solver-policy")),
  });
  for (const [contractId, path] of [
    ["revision-instance", "artifacts/gate-c/calibration/private-instance.json"],
    ["reveal-plan", "artifacts/gate-c/calibration/reveal-plan.json"],
  ] as const) {
    const value = JSON.parse(await readFile(path, "utf8"));
    const verdict = validateValue(contractId, value);
    if (!verdict.accepted) {
      throw new Error(`${path} is invalid: ${verdict.reason} at ${verdict.pointer}.`);
    }
  }
  await writeCanonicalJson(resolve("artifacts/gate-c/inputs/input-manifest.json"), {
    schemaVersion: 1,
    profileId: "partial-rekey-literary-v1",
    inputs,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyGateCInputs();
}
