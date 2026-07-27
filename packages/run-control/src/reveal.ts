import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

interface ReleaseArtifact {
  artifactType: "cipher-chapter";
  byteLength: number;
  sha256: string;
}

interface ReleaseManifest {
  schemaVersion: 1;
  releaseOrdinal: number;
  chapterIndexes: number[];
  chapters: ReleaseArtifact[];
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseReleaseManifest(bytes: Buffer, expectedOrdinal?: number): ReleaseManifest {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Release manifest must contain valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Release manifest must be an object.");
  }
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== 1 ||
    !Number.isSafeInteger(manifest.releaseOrdinal) ||
    (expectedOrdinal !== undefined && manifest.releaseOrdinal !== expectedOrdinal) ||
    !Array.isArray(manifest.chapterIndexes) ||
    !Array.isArray(manifest.chapters) ||
    manifest.chapterIndexes.length === 0 ||
    manifest.chapterIndexes.length !== manifest.chapters.length
  ) {
    throw new Error("Release manifest does not match the requested ordinal and chapter set.");
  }
  const indexes = manifest.chapterIndexes;
  const chapters = manifest.chapters;
  for (let index = 0; index < indexes.length; index += 1) {
    const chapterIndex = indexes[index];
    const artifact = chapters[index];
    if (
      !Number.isSafeInteger(chapterIndex) ||
      (chapterIndex as number) < 0 ||
      (index > 0 && (indexes[index - 1] as number) >= (chapterIndex as number)) ||
      !artifact ||
      typeof artifact !== "object" ||
      Array.isArray(artifact)
    ) {
      throw new Error("Release manifest contains invalid chapter ordering.");
    }
    const record = artifact as Record<string, unknown>;
    if (
      record.artifactType !== "cipher-chapter" ||
      !Number.isSafeInteger(record.byteLength) ||
      (record.byteLength as number) < 0 ||
      typeof record.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(record.sha256)
    ) {
      throw new Error("Release manifest contains invalid chapter evidence.");
    }
  }
  return value as ReleaseManifest;
}

async function readIfPresent(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicReplace(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function releaseManifestSnapshotPath(currentManifestPath: string, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new Error("Release manifest snapshot ordinal must be a positive safe integer.");
  }
  return join(
    dirname(currentManifestPath),
    ".release-manifests",
    `${String(ordinal).padStart(2, "0")}.json`,
  );
}

export async function releaseAgentShard(options: {
  bundleRoot: string;
  agentId: string;
  destination: string;
  ordinal: number;
}): Promise<string> {
  const { bundleRoot, agentId, destination, ordinal } = options;
  if (ordinal < 1 || ordinal > 2) {
    throw new Error("Offline fixture release ordinal must be 1 or 2.");
  }
  if (!/^agent-[1-9][0-9]*$/.test(agentId)) {
    throw new Error("Offline fixture release requires a valid agent identifier.");
  }

  const source = join(bundleRoot, "private", agentId);
  const releaseRoot = join(destination, "released");
  const currentManifestPath = join(releaseRoot, "release-manifest.json");
  const sourceManifestPath = join(
    source,
    "releases",
    String(ordinal).padStart(2, "0"),
    "manifest.json",
  );
  const manifestBytes = await readFile(sourceManifestPath);
  const manifest = parseReleaseManifest(manifestBytes, ordinal);
  const currentBytes = await readIfPresent(currentManifestPath);
  const currentOrdinal = currentBytes ? parseReleaseManifest(currentBytes).releaseOrdinal : 0;

  if (currentOrdinal === ordinal) {
    if (!currentBytes?.equals(manifestBytes)) {
      throw new Error(`Release ordinal ${ordinal} collides with different manifest bytes.`);
    }
    return currentManifestPath;
  }
  if (ordinal !== currentOrdinal + 1) {
    throw new Error(`Release ordinal ${currentOrdinal + 1} must be published next.`);
  }

  const preparedChapters = await Promise.all(
    manifest.chapterIndexes.map(async (chapterIndex, index) => {
      const name = `${String(chapterIndex).padStart(3, "0")}.txt`;
      const bytes = await readFile(join(source, "chapters", name));
      const expected = manifest.chapters[index] as ReleaseArtifact;
      if (bytes.byteLength !== expected.byteLength || sha256(bytes) !== expected.sha256) {
        throw new Error(`Release chapter ${name} does not match its declared byte evidence.`);
      }
      return { name, bytes };
    }),
  );
  await mkdir(releaseRoot, { recursive: true });
  for (const chapter of preparedChapters) {
    await atomicReplace(join(releaseRoot, chapter.name), chapter.bytes);
  }
  await atomicReplace(releaseManifestSnapshotPath(currentManifestPath, ordinal), manifestBytes);

  // The manifest is the commit marker: every referenced byte is visible before this rename.
  await atomicReplace(currentManifestPath, manifestBytes);
  return currentManifestPath;
}
