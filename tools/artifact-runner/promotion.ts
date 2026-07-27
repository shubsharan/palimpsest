import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import {
  canonicalArchiveBytes,
  canonicalJsonBytes,
  sha256Hex,
  validateValue,
} from "@palimpsest/contracts";

import { runProducerProcess } from "./subprocess.js";
import {
  ArtifactRunError,
  type ArtifactResponseManifest,
  type OutputManifestEntry,
  type PromotionResult,
  type ReferenceRequest,
  type RunReferenceProducerOptions,
} from "./types.js";

interface ActualOutput extends OutputManifestEntry {
  sourcePath: string;
}

async function listOutputs(root: string, current = root): Promise<ActualOutput[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const outputs: ActualOutput[] = [];
  for (const entry of entries) {
    const sourcePath = join(current, entry.name);
    const stat = await lstat(sourcePath);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new ArtifactRunError("unsafe_output", `Producer wrote an unsafe entry: ${entry.name}`);
    }
    if (stat.isDirectory()) {
      outputs.push(...(await listOutputs(root, sourcePath)));
      continue;
    }
    const bytes = await readFile(sourcePath);
    outputs.push({
      byteLength: bytes.length,
      path: relative(root, sourcePath).split(sep).join("/"),
      sha256: sha256Hex(bytes),
      sourcePath,
    });
  }
  outputs.sort((left, right) => left.path.localeCompare(right.path));
  return outputs;
}

function verifyManifest(
  request: ReferenceRequest,
  requestDigest: string,
  manifest: ArtifactResponseManifest,
  outputs: ActualOutput[],
): void {
  const verdict = validateValue("artifact-response-manifest", manifest);
  if (!verdict.accepted) {
    throw new ArtifactRunError(
      "malformed_progress",
      `Response manifest is invalid at ${verdict.pointer}.`,
    );
  }
  if (manifest.requestDigest !== requestDigest) {
    throw new ArtifactRunError(
      "digest_mismatch",
      "Response manifest names a different request digest.",
    );
  }
  if (
    manifest.producer.name !== request.producer.name ||
    !request.producer.allowedVersions.includes(manifest.producer.version)
  ) {
    throw new ArtifactRunError(
      "producer_version",
      "Response manifest uses a disallowed producer version.",
    );
  }
  if (
    !canonicalJsonBytes(manifest.immutableInputs).equals(
      canonicalJsonBytes(request.immutableInputs),
    ) ||
    !canonicalJsonBytes(manifest.environment).equals(canonicalJsonBytes(request.environment))
  ) {
    throw new ArtifactRunError(
      "digest_mismatch",
      "Response manifest does not preserve the request inputs and environment.",
    );
  }

  const declared = [...manifest.outputs].sort((left, right) => left.path.localeCompare(right.path));
  const actualPaths = new Set(outputs.map((entry) => entry.path));
  const declaredPaths = new Set(declared.map((entry) => entry.path));
  const missing = declared.find((entry) => !actualPaths.has(entry.path));
  if (missing) {
    throw new ArtifactRunError("missing_output", `Declared output is missing: ${missing.path}`);
  }
  const undeclared = outputs.find((entry) => !declaredPaths.has(entry.path));
  if (undeclared) {
    throw new ArtifactRunError(
      "undeclared_output",
      `Producer wrote an undeclared output: ${undeclared.path}`,
    );
  }
  if (declaredPaths.size !== declared.length) {
    throw new ArtifactRunError(
      "unsafe_output",
      "Response manifest contains duplicate output paths.",
    );
  }

  for (const expected of declared) {
    const actual = outputs.find((entry) => entry.path === expected.path);
    if (!actual) {
      throw new ArtifactRunError("missing_output", `Declared output is missing: ${expected.path}`);
    }
    if (actual.byteLength !== expected.byteLength) {
      throw new ArtifactRunError("length_mismatch", `Output length differs: ${expected.path}`);
    }
    if (actual.sha256 !== expected.sha256) {
      throw new ArtifactRunError("digest_mismatch", `Output digest differs: ${expected.path}`);
    }
  }
}

async function buildArchive(outputs: ActualOutput[]): Promise<Buffer> {
  const entries = await Promise.all(
    outputs.map(async (entry) => ({
      path: entry.path,
      kind: "file" as const,
      contentBase64: (await readFile(entry.sourcePath)).toString("base64"),
    })),
  );
  return canonicalArchiveBytes({ schemaVersion: 1, contractId: "canonical-archive", entries });
}

async function promote(
  storeRoot: string,
  attemptId: string,
  manifest: ArtifactResponseManifest,
  outputs: ActualOutput[],
): Promise<{ artifactDigest: string; artifactPath: string }> {
  const archive = await buildArchive(outputs);
  if (
    archive.length !== manifest.archive.byteLength ||
    sha256Hex(archive) !== manifest.archive.sha256
  ) {
    throw new ArtifactRunError(
      "digest_mismatch",
      "Canonical archive does not match the response manifest.",
    );
  }

  const artifactDigest = sha256Hex(archive);
  const promotedRoot = join(storeRoot, "promoted");
  const artifactPath = join(promotedRoot, artifactDigest);
  const staging = join(storeRoot, `.promotion-${attemptId}`);
  await mkdir(join(staging, "outputs"), { recursive: true });
  for (const output of outputs) {
    const destination = join(staging, "outputs", ...output.path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(output.sourcePath, destination);
  }
  await writeFile(join(staging, "manifest.json"), canonicalJsonBytes(manifest));
  await writeFile(join(staging, "artifact.tar"), archive);

  await mkdir(promotedRoot, { recursive: true });
  try {
    await rename(staging, artifactPath);
  } catch (error) {
    const existingArchive = await readFile(join(artifactPath, "artifact.tar")).catch(
      () => undefined,
    );
    const existingManifest = await readFile(join(artifactPath, "manifest.json")).catch(
      () => undefined,
    );
    if (
      existingArchive?.equals(archive) &&
      existingManifest?.equals(canonicalJsonBytes(manifest))
    ) {
      await rm(staging, { recursive: true, force: true });
    } else {
      throw new ArtifactRunError(
        "promotion_io",
        "Atomic artifact promotion failed.",
        String(error),
      );
    }
  }
  return { artifactDigest, artifactPath };
}

function failureFrom(error: unknown): ArtifactRunError {
  if (error instanceof ArtifactRunError) {
    return error;
  }
  return new ArtifactRunError("promotion_io", "Unexpected artifact runner failure.", String(error));
}

export async function runReferenceProducer(
  options: RunReferenceProducerOptions,
): Promise<PromotionResult> {
  const attemptId = randomUUID();
  const attemptRoot = join(options.storeRoot, "attempts", attemptId);
  const outputPath = join(attemptRoot, "output");
  await mkdir(outputPath, { recursive: true });
  const requestBytes = canonicalJsonBytes(options.request);
  const requestDigest = sha256Hex(requestBytes);
  const requestPath = join(attemptRoot, "request.json");
  await writeFile(requestPath, requestBytes);

  try {
    const processResult = await runProducerProcess({
      deadlineMs: options.request.deadlineMs,
      mode: options.mode,
      outputPath,
      requestPath,
    });
    const terminal = processResult.records.at(-1);
    const manifest = terminal?.responseManifest;
    if (!manifest) {
      throw new ArtifactRunError(
        "truncated_progress",
        "Producer did not emit a response manifest.",
      );
    }
    const outputs = await listOutputs(outputPath);
    verifyManifest(options.request, requestDigest, manifest, outputs);
    const promoted = await promote(options.storeRoot, attemptId, manifest, outputs);
    await rm(outputPath, { recursive: true, force: true });
    await writeFile(
      join(attemptRoot, "attempt.json"),
      canonicalJsonBytes({
        schemaVersion: 1,
        attemptId,
        requestDigest,
        status: "promoted",
        artifactDigest: promoted.artifactDigest,
      }),
    );
    return {
      ...promoted,
      attemptId,
      manifest,
      requestDigest,
    };
  } catch (error) {
    const failure = failureFrom(error);
    await rm(outputPath, { recursive: true, force: true });
    await writeFile(
      join(attemptRoot, "attempt.json"),
      canonicalJsonBytes({
        schemaVersion: 1,
        attemptId,
        requestDigest,
        status: "failed",
        failure: {
          code: failure.code,
          message: failure.message,
        },
      }),
    );
    if (failure.diagnostics) {
      await writeFile(join(attemptRoot, "stderr.log"), failure.diagnostics);
    }
    throw failure;
  }
}
