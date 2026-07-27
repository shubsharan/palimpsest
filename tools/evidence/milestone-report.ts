import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import {
  ArtifactRunError,
  createReferenceRequest,
  networkSandboxForCurrentPlatform,
  runReferenceProducer,
  type FailureMode,
} from "../artifact-runner/index.js";

const failureModes: FailureMode[] = [
  "timeout",
  "producer-failure",
  "malformed-progress",
  "truncated-progress",
  "missing-output",
  "undeclared-output",
  "digest-mismatch",
  "length-mismatch",
  "disallowed-producer-version",
];

async function promotedCount(storeRoot: string): Promise<number> {
  return (await readdir(join(storeRoot, "promoted")).catch(() => [])).length;
}

async function generateEvidence(): Promise<Buffer> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-milestone-1-"));
  try {
    const honestStore = join(temporaryRoot, "honest");
    const honestRequest = await createReferenceRequest({ message: "milestone 1 evidence\n" });
    const first = await runReferenceProducer({
      mode: "honest",
      request: honestRequest,
      storeRoot: honestStore,
    });
    const second = await runReferenceProducer({
      mode: "honest",
      request: honestRequest,
      storeRoot: honestStore,
    });
    if (first.artifactDigest !== second.artifactDigest) {
      throw new Error("Repeated honest attempts produced different artifact digests.");
    }
    const networkProbe = await runReferenceProducer({
      mode: "network-probe",
      request: honestRequest,
      storeRoot: join(temporaryRoot, "network-probe"),
    });

    const failures = [];
    for (const mode of failureModes) {
      const storeRoot = join(temporaryRoot, mode);
      const request = await createReferenceRequest({
        deadlineMs: mode === "timeout" ? 50 : 5_000,
        message: `failure evidence: ${mode}\n`,
      });
      try {
        await runReferenceProducer({ mode, request, storeRoot });
        throw new Error(`${mode} unexpectedly promoted an artifact.`);
      } catch (error) {
        if (!(error instanceof ArtifactRunError)) {
          throw error;
        }
        failures.push({
          mode,
          failureCode: error.code,
          promotedArtifacts: await promotedCount(storeRoot),
        });
      }
    }

    const retryStore = join(temporaryRoot, "retry");
    const retryRequest = await createReferenceRequest({ message: "retry evidence\n" });
    await runReferenceProducer({
      mode: "undeclared-output",
      request: retryRequest,
      storeRoot: retryStore,
    }).catch((error) => {
      if (!(error instanceof ArtifactRunError)) {
        throw error;
      }
    });
    const retry = await runReferenceProducer({
      mode: "honest",
      request: retryRequest,
      storeRoot: retryStore,
    });

    return canonicalJsonBytes({
      schemaVersion: 1,
      milestoneId: "milestone-1-foundation",
      environment: honestRequest.environment,
      networkIsolation: networkSandboxForCurrentPlatform().label,
      honest: {
        requestDigest: first.requestDigest,
        artifactDigest: first.artifactDigest,
        archiveByteLength: first.manifest.archive.byteLength,
        repeatedArtifactDigest: second.artifactDigest,
      },
      networkProbe: {
        artifactDigest: networkProbe.artifactDigest,
        networkAccess: "denied",
      },
      failures,
      retry: {
        requestDigest: retry.requestDigest,
        artifactDigest: retry.artifactDigest,
        freshAttemptCount: 2,
      },
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const destination = resolve("artifacts/milestone-1/promotion-evidence.json");
await mkdir(dirname(destination), { recursive: true });
const bytes = await generateEvidence();
const staging = `${destination}.tmp`;
await writeFile(staging, bytes);
await rename(staging, destination);
process.stdout.write(`Wrote ${destination} (${bytes.length} bytes, sha256 ${sha256Hex(bytes)}).\n`);
