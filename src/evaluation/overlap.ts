import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { loadFixturePackage, selectFixtureVariant } from "../fixture/package.js";
import { requiredFlag } from "../flags.js";
import { runGit, type GitRepository } from "../git.js";
import { runProcessBuffer, runPythonJson } from "../python.js";
import {
  appendRunAnalysis,
  loadRunRecord,
  validateRunRecordTrace,
  type OriginOverlapAnalysis,
  type OverlapFinding,
  type OverlapScanMetadata,
  type OverlapRunAnalysis,
} from "../run/record.js";
import { verifyTree } from "../seal.js";

const DEFAULT_MINIMUM_WORDS = 32;

interface ReachableBlob {
  readonly path: string;
  readonly objectId: string;
  readonly content: Buffer;
}

interface GitHistoryScan {
  readonly blobs: readonly ReachableBlob[];
  readonly metadata: OverlapScanMetadata;
}

function lines(value: string): readonly string[] {
  return value.trim() === "" ? [] : value.trimEnd().split("\n");
}

function parseBatchTypes(output: Buffer): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const line of lines(output.toString("utf8"))) {
    const [objectId, type] = line.split(" ");
    if (objectId === undefined || type === undefined) {
      throw new Error("git cat-file returned malformed object metadata.");
    }
    result.set(objectId, type);
  }
  return result;
}

async function objectTypes(repositoryPath: string, objectIds: readonly string[]) {
  if (objectIds.length === 0) return new Map<string, string>();
  const result = await runProcessBuffer(
    "git",
    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    { cwd: repositoryPath, input: `${objectIds.join("\n")}\n` },
  );
  return parseBatchTypes(result.stdout);
}

function parseTreeBlobs(output: string): readonly { path: string; objectId: string }[] {
  if (output === "") return [];
  return output
    .split("\0")
    .filter((entry) => entry !== "")
    .flatMap((entry) => {
      const tab = entry.indexOf("\t");
      if (tab < 0) throw new Error("git ls-tree returned malformed provenance.");
      const [mode, type, objectId] = entry.slice(0, tab).split(" ");
      if (mode === undefined || type === undefined || objectId === undefined) {
        throw new Error("git ls-tree returned malformed object metadata.");
      }
      return type === "blob" ? [{ path: entry.slice(tab + 1), objectId }] : [];
    });
}

function isTextBlob(content: Buffer): boolean {
  if (content.includes(0)) return false;
  return Buffer.from(content.toString("utf8"), "utf8").equals(content);
}

async function scanReachableHistory(repository: GitRepository): Promise<GitHistoryScan> {
  const objectLines = lines(
    (await runGit(["rev-list", "--objects", "--all"], repository.path)).stdout,
  );
  const objectIds = [...new Set(objectLines.map((line) => line.split(" ", 1)[0]!).values())];
  const types = await objectTypes(repository.path, objectIds);
  const blobIds = objectIds.filter((objectId) => types.get(objectId) === "blob");
  const commits = lines((await runGit(["rev-list", "--all"], repository.path)).stdout);
  const treeReferences: { path: string; objectId: string }[] = [];
  for (const commit of commits) {
    treeReferences.push(
      ...parseTreeBlobs(
        (await runGit(["ls-tree", "-r", "--full-tree", "-z", commit], repository.path)).stdout,
      ),
    );
  }
  const uniqueReferences = new Map(
    treeReferences.map((item) => [`${item.path}\0${item.objectId}`, item] as const),
  );
  const uniqueTreeReferenceCount = uniqueReferences.size;
  const referencedIds = new Set([...uniqueReferences.values()].map(({ objectId }) => objectId));
  for (const objectId of blobIds) {
    if (!referencedIds.has(objectId)) {
      const path = `@object/${objectId}`;
      uniqueReferences.set(`${path}\0${objectId}`, { path, objectId });
    }
  }
  const contents = new Map<string, Buffer>();
  for (const objectId of blobIds) {
    contents.set(
      objectId,
      (
        await runProcessBuffer("git", ["cat-file", "blob", objectId], {
          cwd: repository.path,
        })
      ).stdout,
    );
  }
  const textIds = new Set(
    [...contents].filter(([, content]) => isTextBlob(content)).map(([objectId]) => objectId),
  );
  const blobs = [...uniqueReferences.values()]
    .filter(({ objectId }) => textIds.has(objectId))
    .sort((left, right) =>
      left.path === right.path
        ? left.objectId.localeCompare(right.objectId)
        : left.path.localeCompare(right.path),
    )
    .map(({ path, objectId }) => ({ path, objectId, content: contents.get(objectId)! }));
  return {
    blobs,
    metadata: {
      reachableObjectCount: objectIds.length,
      reachableBlobReferenceCount: treeReferences.length,
      uniqueReachableBlobCount: blobIds.length,
      uniqueTextBlobCount: textIds.size,
      repeatedTreeReferenceCount: treeReferences.length - uniqueTreeReferenceCount,
      skippedNonTextBlobCount: blobIds.length - textIds.size,
    },
  };
}

function decodeOverlapResult(value: Record<string, unknown>): {
  findings: readonly OverlapFinding[];
  scan: OverlapScanMetadata;
} {
  if (
    Object.keys(value).sort().join("\0") !== ["findings", "scan"].sort().join("\0") ||
    !Array.isArray(value.findings) ||
    typeof value.scan !== "object" ||
    value.scan === null ||
    Array.isArray(value.scan)
  ) {
    throw new Error("Overlap analyzer returned an invalid result.");
  }
  return value as unknown as { findings: readonly OverlapFinding[]; scan: OverlapScanMetadata };
}

async function analyzeOrigin(options: {
  root: string;
  repository: GitRepository;
  fixtureRoot: string;
  variantId: string;
  minimumWords: number;
  stagingRoot: string;
}): Promise<OriginOverlapAnalysis> {
  const fixture = await loadFixturePackage(options.fixtureRoot);
  const variant = selectFixtureVariant(fixture, options.variantId);
  const scan = await scanReachableHistory(options.repository);
  const originRoot = join(options.stagingRoot, options.repository.repositoryId);
  const blobsRoot = join(originRoot, "blobs");
  await mkdir(blobsRoot, { recursive: true });
  const committed = await Promise.all(
    scan.blobs.map(async (blob, index) => {
      const contentPath = join(blobsRoot, `${String(index).padStart(6, "0")}.blob`);
      await writeFile(contentPath, blob.content, { flag: "wx" });
      return {
        committedPath: blob.path,
        committedBlobId: blob.objectId,
        contentPath,
      };
    }),
  );
  const privateSources = Object.fromEntries(
    variant.stages.map((stage) => [
      `${stage.agentId}/stage-${String(stage.ordinal)}`,
      join(options.fixtureRoot, stage.sourcePath),
    ]),
  );
  const requestPath = join(originRoot, "request.json");
  await writeFile(
    requestPath,
    `${JSON.stringify({
      committed,
      privateSources,
      plaintextSources: {
        [fixture.fixtureId]: join(options.fixtureRoot, "oracle", "plaintext.txt"),
      },
      scan: scan.metadata,
    })}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  const result = decodeOverlapResult(
    await runPythonJson(options.root, "palimpsest.evaluation.overlap", [
      "--request",
      requestPath,
      "--minimum-words",
      String(options.minimumWords),
    ]),
  );
  return {
    originId: options.repository.repositoryId,
    scan: result.scan,
    findings: result.findings,
  };
}

export async function analyzeRun(options: {
  root: string;
  runRoot: string;
  minimumWords?: number;
}): Promise<OverlapRunAnalysis> {
  const root = resolve(options.root);
  const runRoot = resolve(options.runRoot);
  const minimumWords = options.minimumWords ?? DEFAULT_MINIMUM_WORDS;
  if (!Number.isSafeInteger(minimumWords) || minimumWords < 8) {
    throw new Error("Overlap analysis minimum words must be a safe integer of at least 8.");
  }
  const loaded = await loadRunRecord(root, runRoot);
  await validateRunRecordTrace(runRoot, loaded.record.trace);
  const fixture = await loadFixturePackage(loaded.fixtureRoot);
  if (fixture.contentDigest !== loaded.record.configuration.run.fixture.digest) {
    throw new Error(
      `Fixture package digest ${fixture.contentDigest} differs from recorded digest ${loaded.record.configuration.run.fixture.digest}.`,
    );
  }
  await verifyTree(loaded.topology.root, loaded.topology.treeSeal, "Frozen Git tree");
  const stagingRoot = await mkdtemp(join(runRoot, ".analysis-"));
  try {
    const analyzedAt = new Date().toISOString();
    const origins: OriginOverlapAnalysis[] = [];
    for (const repository of loaded.topology.repositories) {
      origins.push(
        await analyzeOrigin({
          root,
          repository,
          fixtureRoot: loaded.fixtureRoot,
          variantId: loaded.record.configuration.run.fixture.variant,
          minimumWords,
          stagingRoot,
        }),
      );
    }
    const analysis: OverlapRunAnalysis = {
      analysisId: `overlap-${analyzedAt.replaceAll(":", "-")}-${randomUUID()}`,
      kind: "overlap",
      analyzedAt,
      minimumWords,
      origins,
    };
    await appendRunAnalysis(runRoot, loaded.record, analysis);
    return analysis;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export function analyzeRunFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<OverlapRunAnalysis> {
  for (const flag of flags.keys()) {
    if (flag !== "--run-root" && flag !== "--minimum-words") {
      throw new Error(`Unknown analysis option ${flag}.`);
    }
  }
  const value = flags.get("--minimum-words");
  const minimumWords = value === undefined ? DEFAULT_MINIMUM_WORDS : Number(value);
  return analyzeRun({
    root,
    runRoot: requiredFlag(flags, "--run-root"),
    minimumWords,
  });
}
