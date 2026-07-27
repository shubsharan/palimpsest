import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import { assertSafeCapability } from "./policy.js";
import type { CanonicalFetchTuple, PublishedSnapshot, SnapshotView } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_PACKET_LENGTH = 65_520;
const MAX_SIDEBAND_CHUNK = MAX_PACKET_LENGTH - 5;

export const CANONICAL_UPLOAD_PACK_CAPABILITIES = [
  "agent=palimpsest-gateway/1",
  "object-format=sha256",
  "side-band-64k",
] as const;

export interface CapturedFetch {
  snapshot: PublishedSnapshot;
  view?: SnapshotView;
  capturedAtConnectionStart: true;
}

export interface ParsedUploadPackRequest {
  wants: readonly string[];
  haves: readonly string[];
  capabilities: readonly string[];
}

function packetLine(payload: string | Buffer): Buffer {
  const bytes = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const length = bytes.byteLength + 4;
  if (length > MAX_PACKET_LENGTH) {
    throw new Error("Git protocol packet exceeds the canonical packet-length limit.");
  }
  return Buffer.concat([Buffer.from(length.toString(16).padStart(4, "0"), "ascii"), bytes]);
}

function assertCapturedView(captured: CapturedFetch): SnapshotView & { repository: string } {
  const view = captured.view;
  if (!view?.repository) {
    throw new Error("Captured fetch has no materialized repository.");
  }
  if (sha256Hex(canonicalJsonBytes(view.refs)) !== captured.snapshot.refMapDigest) {
    throw new Error("Captured fetch ref map does not match the published snapshot.");
  }
  return { ...view, repository: view.repository };
}

async function runGitBinary(options: {
  repository: string;
  args: readonly string[];
  input: Buffer;
}): Promise<Buffer> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      "git",
      [
        "-c",
        "core.multiPackIndex=false",
        "-c",
        "pack.useBitmaps=false",
        "-C",
        options.repository,
        ...options.args,
      ],
      {
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          LC_ALL: "C",
          TZ: "UTC",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on("error", rejectRun);
    child.once("error", rejectRun);
    child.once("close", (code) => {
      if (code === 0) {
        resolveRun(Buffer.concat(stdout));
        return;
      }
      rejectRun(
        new Error(
          `Canonical Git pack generation failed with exit ${String(code)}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
        ),
      );
    });
    child.stdin.end(options.input);
  });
}

/**
 * Generates the complete smart-HTTP protocol-v0 advertisement from the
 * immutable published ref map. No repository configuration or process state
 * can add capabilities, pseudo-refs, or hidden refs to these bytes.
 */
export function canonicalUploadPackAdvertisement(captured: CapturedFetch): Buffer {
  const view = assertCapturedView(captured);
  const refs = Object.entries(view.refs).sort(([left], [right]) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  if (refs.length === 0) {
    throw new Error("A canonical Git advertisement requires at least one published ref.");
  }
  const headRef = view.refs["refs/heads/main"] ? "refs/heads/main" : refs[0]![0];
  const headOid = view.refs[headRef]!;
  const capabilities = [...CANONICAL_UPLOAD_PACK_CAPABILITIES, `symref=HEAD:${headRef}`].join(" ");
  return Buffer.concat([
    packetLine("# service=git-upload-pack\n"),
    Buffer.from("0000", "ascii"),
    packetLine(`${headOid} HEAD\0${capabilities}\n`),
    ...refs.map(([refName, oid]) => packetLine(`${oid} ${refName}\n`)),
    Buffer.from("0000", "ascii"),
  ]);
}

/**
 * Regenerates a canonical protocol-v0 upload-pack response. The object list is
 * the sorted unsigned-OID closure of the advertised wants. Git receives that
 * exact order and is forced to recompress every object with one worker and no
 * delta search or object reuse. Haves remain part of the normalized tuple but
 * the fixed profile deliberately returns a complete pack, avoiding thin-pack
 * and negotiation-dependent representation.
 */
export async function canonicalUploadPackResponse(options: {
  captured: CapturedFetch;
  tuple: CanonicalFetchTuple;
}): Promise<Buffer> {
  const view = assertCapturedView(options.captured);
  const canonicalTuple = canonicalFetchTuple({
    captured: options.captured,
    wants: options.tuple.wants,
    haves: options.tuple.haves,
    capabilities: options.tuple.capabilityProfile,
  });
  if (canonicalTuple.digest !== options.tuple.digest) {
    throw new Error("Canonical fetch tuple digest does not match its normalized fields.");
  }

  const { stdout } = await execFileAsync(
    "git",
    [
      "-c",
      "core.multiPackIndex=false",
      "-c",
      "pack.useBitmaps=false",
      "-C",
      view.repository,
      "rev-list",
      "--objects",
      "--no-object-names",
      ...canonicalTuple.wants,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        LC_ALL: "C",
        TZ: "UTC",
      },
    },
  );
  const allowed = new Set(view.allowedOids);
  const objectOids = [...new Set(stdout.trim().split("\n").filter(Boolean))].sort();
  if (objectOids.length === 0 || objectOids.some((oid) => !allowed.has(oid))) {
    throw new Error("Canonical fetch object closure escapes the captured snapshot.");
  }
  const pack = await runGitBinary({
    repository: view.repository,
    args: [
      "pack-objects",
      "--stdout",
      "--compression=9",
      "--window=0",
      "--depth=0",
      "--threads=1",
      "--no-reuse-object",
    ],
    input: Buffer.from(`${objectOids.join("\n")}\n`, "ascii"),
  });
  const prefix = packetLine("NAK\n");
  if (!canonicalTuple.capabilityProfile.includes("side-band-64k")) {
    return Buffer.concat([prefix, pack]);
  }
  const sideband: Buffer[] = [];
  for (let offset = 0; offset < pack.byteLength; offset += MAX_SIDEBAND_CHUNK) {
    sideband.push(
      packetLine(
        Buffer.concat([
          Buffer.from([1]),
          pack.subarray(offset, Math.min(offset + MAX_SIDEBAND_CHUNK, pack.byteLength)),
        ]),
      ),
    );
  }
  return Buffer.concat([prefix, ...sideband, Buffer.from("0000", "ascii")]);
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
  capabilityProfile.forEach(assertSafeFetchCapability);
  const body = {
    snapshotId: options.captured.snapshot.snapshotId,
    wants,
    haves,
    capabilityProfile,
  };
  return { ...body, digest: sha256Hex(canonicalJsonBytes(body)) };
}

function assertSafeFetchCapability(name: string): void {
  try {
    assertSafeCapability(name);
    return;
  } catch {
    // Upload-pack has a larger read-only capability surface than receive-pack.
  }
  if (
    [
      "deepen-not",
      "deepen-relative",
      "deepen-since",
      "include-tag",
      "multi_ack",
      "multi_ack_detailed",
      "no-done",
      "no-progress",
      "ofs-delta",
      "shallow",
      "side-band",
      "thin-pack",
    ].includes(name)
  ) {
    return;
  }
  throw new Error(`Git fetch capability is not permitted: ${name}`);
}

export function parseUploadPackRequest(body: Buffer): ParsedUploadPackRequest {
  const wants: string[] = [];
  const haves: string[] = [];
  const capabilities: string[] = [];
  let offset = 0;
  let sawWant = false;

  while (offset < body.length) {
    if (offset + 4 > body.length) {
      throw new Error("Upload-pack request ends inside a packet length.");
    }
    const lengthText = body.subarray(offset, offset + 4).toString("ascii");
    if (!/^[0-9a-f]{4}$/i.test(lengthText)) {
      throw new Error("Upload-pack request contains an invalid packet length.");
    }
    const length = Number.parseInt(lengthText, 16);
    offset += 4;
    if (length === 0 || length === 1 || length === 2) continue;
    if (length < 4 || offset + length - 4 > body.length) {
      throw new Error("Upload-pack request contains a truncated packet.");
    }
    const payload = body
      .subarray(offset, offset + length - 4)
      .toString("utf8")
      .replace(/\n$/, "");
    offset += length - 4;

    if (payload.startsWith("want ")) {
      const [request, capabilityText] = payload.split("\0", 2);
      const [command, oid, ...inlineCapabilities] = request!.split(" ");
      if (command !== "want" || !oid || !/^[0-9a-f]{64}$/.test(oid)) {
        throw new Error("Upload-pack request contains an invalid want.");
      }
      wants.push(oid);
      if (!sawWant) {
        const declared = capabilityText?.split(" ").filter(Boolean) ?? inlineCapabilities;
        capabilities.push(...declared);
      } else if (capabilityText || inlineCapabilities.length > 0) {
        throw new Error("Only the first upload-pack want may declare capabilities.");
      }
      sawWant = true;
      continue;
    }
    if (payload.startsWith("have ")) {
      const oid = payload.slice(5);
      if (!/^[0-9a-f]{64}$/.test(oid)) {
        throw new Error("Upload-pack request contains an invalid have.");
      }
      haves.push(oid);
      continue;
    }
    if (
      payload === "done" ||
      payload.startsWith("deepen ") ||
      payload.startsWith("deepen-since ") ||
      payload.startsWith("deepen-not ") ||
      payload.startsWith("shallow ")
    ) {
      continue;
    }
    throw new Error(`Upload-pack request contains an unsupported command: ${payload}.`);
  }

  if (wants.length === 0) {
    throw new Error("Upload-pack request must contain at least one want.");
  }
  return {
    wants: [...new Set(wants)].sort(),
    haves: [...new Set(haves)].sort(),
    capabilities: [...new Set(capabilities)].sort(),
  };
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
    const { stdout: actualRefsText } = await execFileAsync("git", [
      "-C",
      staged,
      "for-each-ref",
      "--format=%(refname)",
    ]);
    const actualRefs = actualRefsText.trim().split("\n").filter(Boolean).sort();
    const expectedRefs = Object.keys(options.refs).sort();
    if (
      actualRefs.length !== expectedRefs.length ||
      actualRefs.some((refName, index) => refName !== expectedRefs[index])
    ) {
      throw new Error("Materialized snapshot contains refs outside the published ref map.");
    }
    await execFileAsync("git", ["-C", staged, "config", "uploadpack.allowAnySHA1InWant", "false"]);
    await execFileAsync("git", [
      "-C",
      staged,
      "config",
      "uploadpack.allowReachableSHA1InWant",
      "false",
    ]);
    await execFileAsync("git", ["-C", staged, "config", "uploadpack.allowTipSHA1InWant", "false"]);
    await execFileAsync("git", ["-C", staged, "config", "uploadpack.allowFilter", "false"]);
    await execFileAsync("git", ["-C", staged, "config", "core.multiPackIndex", "false"]);
    await execFileAsync("git", ["-C", staged, "config", "pack.useBitmaps", "false"]);
    await execFileAsync("git", ["-C", staged, "config", "pack.threads", "1"]);
    await execFileAsync("git", ["-C", staged, "config", "pack.compression", "9"]);
    await execFileAsync("git", ["-C", staged, "config", "pack.window", "0"]);
    await execFileAsync("git", ["-C", staged, "config", "pack.depth", "0"]);
    const advertisedRefs = Object.keys(options.refs).sort();
    const headRef = options.refs["refs/heads/main"] ? "refs/heads/main" : advertisedRefs[0]!;
    await execFileAsync("git", ["-C", staged, "symbolic-ref", "HEAD", headRef]);
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
