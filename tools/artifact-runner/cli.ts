import { resolve } from "node:path";

import {
  ArtifactRunError,
  createReferenceRequest,
  runReferenceProducer,
  type FailureMode,
} from "./index.js";

const modes = new Set<FailureMode>([
  "honest",
  "network-probe",
  "timeout",
  "producer-failure",
  "malformed-progress",
  "truncated-progress",
  "missing-output",
  "undeclared-output",
  "digest-mismatch",
  "length-mismatch",
  "disallowed-producer-version",
]);

function parseMode(): FailureMode {
  const index = process.argv.indexOf("--mode");
  const value = index >= 0 ? process.argv[index + 1] : "honest";
  if (!value || !modes.has(value as FailureMode)) {
    throw new Error(`Unsupported failure mode: ${String(value)}`);
  }
  return value as FailureMode;
}

try {
  const mode = parseMode();
  const request = await createReferenceRequest({
    deadlineMs: mode === "timeout" ? 50 : 5_000,
    message: "reference producer output\n",
  });
  const result = await runReferenceProducer({
    mode,
    request,
    storeRoot: resolve(".artifacts-tmp/reference-producer"),
  });
  process.stdout.write(`Promoted ${result.artifactDigest} at ${result.artifactPath}\n`);
} catch (error) {
  if (error instanceof ArtifactRunError) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
