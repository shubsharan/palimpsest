import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import { assertSafeCapability } from "./policy.js";
import type { CanonicalFetchTuple, PublishedSnapshot, SnapshotView } from "./types.js";

const execFileAsync = promisify(execFile);

export interface CapturedFetch {
  snapshot: PublishedSnapshot;
  view?: SnapshotView;
  capturedAtConnectionStart: true;
}

export function captureFetchSnapshot(
  snapshot: PublishedSnapshot,
  view?: SnapshotView,
): CapturedFetch {
  return {
    snapshot: structuredClone(snapshot),
    ...(view ? { view: structuredClone(view) } : {}),
    capturedAtConnectionStart: true,
  };
}

export function canonicalFetchTuple(options: {
  captured: CapturedFetch;
  wants: readonly string[];
  haves: readonly string[];
  capabilities: readonly string[];
}): CanonicalFetchTuple {
  const view = options.captured.view;
  if (!view) throw new Error("Captured fetch has no immutable snapshot view.");
  const allowed = new Set(view.allowedOids);
  const wants = [...new Set(options.wants)].sort();
  const haves = [...new Set(options.haves)].sort();
  if (wants.some((oid) => !Object.values(view.refs).includes(oid))) {
    throw new Error("Fetch wants must be advertised by the captured snapshot.");
  }
  if (haves.some((oid) => !allowed.has(oid))) {
    throw new Error("Fetch haves must be visible in the captured snapshot.");
  }
  const capabilityProfile = [...new Set(options.capabilities)].sort();
  capabilityProfile.forEach(assertSafeCapability);
  const body = {
    snapshotId: options.captured.snapshot.snapshotId,
    wants,
    haves,
    capabilityProfile,
  };
  return { ...body, digest: sha256Hex(canonicalJsonBytes(body)) };
}

export async function materializeSnapshotRepository(options: {
  sourceRepository: string;
  destination: string;
  refs: Readonly<Record<string, string>>;
}): Promise<SnapshotView> {
  if (Object.keys(options.refs).length === 0) {
    throw new Error("A published Git snapshot must advertise at least one ref.");
  }
  const destinationParent = dirname(options.destination);
  await mkdir(destinationParent, { recursive: true });
  const temporaryRoot = await mkdtemp(join(destinationParent, ".palimpsest-snapshot-"));
  const bundle = join(temporaryRoot, "snapshot.bundle");
  const staged = join(temporaryRoot, "repository.git");
  try {
    await execFileAsync("git", [
      "-C",
      options.sourceRepository,
      "bundle",
      "create",
      bundle,
      ...Object.keys(options.refs).sort(),
    ]);
    await execFileAsync("git", ["clone", "--quiet", "--bare", bundle, staged]);
    for (const [refName, expectedOid] of Object.entries(options.refs)) {
      const { stdout } = await execFileAsync("git", ["-C", staged, "rev-parse", refName]);
      if (stdout.trim() !== expectedOid) {
        throw new Error(`Materialized snapshot ref mismatch: ${refName}.`);
      }
    }
    await execFileAsync("git", ["-C", staged, "config", "uploadpack.allowAnySHA1InWant", "false"]);
    await execFileAsync("git", [
      "-C",
      staged,
      "config",
      "uploadpack.allowReachableSHA1InWant",
      "false",
    ]);
    const { stdout } = await execFileAsync("git", [
      "-C",
      staged,
      "rev-list",
      "--objects",
      "--no-object-names",
      "--all",
    ]);
    const allowedOids = [...new Set(stdout.trim().split("\n").filter(Boolean))].sort();
    await rename(staged, options.destination);
    return { refs: structuredClone(options.refs), allowedOids, repository: options.destination };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
