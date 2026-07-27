import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { decodeBuildManifest, decodeOverlapResult, type OverlapResult } from "./artifacts.js";
import {
  absoluteFrom,
  appendTraceEvent,
  readJsonObject,
  runProcess,
  runProcessBuffer,
  runPythonJson,
} from "./python.js";
import type { AttemptResult } from "./run.js";

export interface GitOverlapScan {
  reachableObjectCount: number;
  reachableBlobReferenceCount: number;
  uniqueReachableBlobCount: number;
  uniqueTextBlobCount: number;
  repeatedTreeReferenceCount: number;
  skippedNonTextBlobCount: number;
}

export interface CommittedFileCollection {
  committed: Record<string, string>;
  scan: GitOverlapScan;
}

function nonEmptyLines(value: string): string[] {
  return value.split("\n").filter((line) => line.length > 0);
}

function parseTreeBlobIds(source: Buffer): string[] {
  return source
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      const tab = entry.indexOf("\t");
      const metadata = (tab === -1 ? entry : entry.slice(0, tab)).split(/\s+/);
      return metadata[1] === "blob" && metadata[2] ? [metadata[2]] : [];
    });
}

export async function collectCommittedFiles(
  barePath: string,
  outputRoot: string,
): Promise<CommittedFileCollection> {
  await mkdir(outputRoot, { recursive: true });
  const reachableObjectIds = [
    ...new Set(
      nonEmptyLines(
        (
          await runProcess(
            "git",
            ["--git-dir", barePath, "rev-list", "--objects", "--all", "--no-object-names"],
            { cwd: dirname(barePath) },
          )
        ).stdout,
      ),
    ),
  ];
  const classifications =
    reachableObjectIds.length === 0
      ? ""
      : (
          await runProcess(
            "git",
            [
              "--git-dir",
              barePath,
              "cat-file",
              "--batch-check=%(objectname) %(objecttype) %(objectsize)",
            ],
            {
              cwd: dirname(barePath),
              input: `${reachableObjectIds.join("\n")}\n`,
            },
          )
        ).stdout;
  const blobIds = nonEmptyLines(classifications).flatMap((line) => {
    const [objectId, objectType] = line.split(" ");
    return objectType === "blob" && objectId ? [objectId] : [];
  });

  const commitIds = nonEmptyLines(
    (
      await runProcess("git", ["--git-dir", barePath, "rev-list", "--all"], {
        cwd: dirname(barePath),
      })
    ).stdout,
  );
  const referencedBlobIds: string[] = [];
  for (const commitId of commitIds) {
    const tree = await runProcessBuffer(
      "git",
      ["--git-dir", barePath, "ls-tree", "-r", "-z", commitId],
      { cwd: dirname(barePath) },
    );
    referencedBlobIds.push(...parseTreeBlobIds(tree.stdout));
  }

  const committed: Record<string, string> = {};
  let skippedNonTextBlobCount = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const objectId of blobIds) {
    const content = (
      await runProcessBuffer("git", ["--git-dir", barePath, "cat-file", "blob", objectId], {
        cwd: dirname(barePath),
      })
    ).stdout;
    let text: string;
    try {
      text = decoder.decode(content);
    } catch {
      skippedNonTextBlobCount += 1;
      continue;
    }
    if (text.includes("\0")) {
      skippedNonTextBlobCount += 1;
      continue;
    }
    const destination = join(
      outputRoot,
      `${String(Object.keys(committed).length).padStart(4, "0")}-${objectId}.txt`,
    );
    await writeFile(destination, text, "utf8");
    committed[objectId] = destination;
  }

  return {
    committed,
    scan: {
      reachableObjectCount: reachableObjectIds.length,
      reachableBlobReferenceCount: referencedBlobIds.length,
      uniqueReachableBlobCount: blobIds.length,
      uniqueTextBlobCount: Object.keys(committed).length,
      repeatedTreeReferenceCount: referencedBlobIds.length - new Set(referencedBlobIds).size,
      skippedNonTextBlobCount,
    },
  };
}

export async function observeOverlap(
  root: string,
  buildRoot: string,
  result: AttemptResult,
): Promise<OverlapResult> {
  const overlapRoot = join(dirname(result.tracePath), "overlap-input");
  const manifest = decodeBuildManifest(await readJsonObject(join(buildRoot, "puzzle-build.json")));
  const { committed, scan } = await collectCommittedFiles(
    result.frozen.barePath,
    join(overlapRoot, "git"),
  );
  const privateSources = Object.fromEntries(
    manifest.stages.map((stage) => [
      `${stage.agentId}-stage-${stage.ordinal}`,
      absoluteFrom(buildRoot, stage.sourcePath),
    ]),
  );
  const plaintextSources = {
    complete: join(buildRoot, manifest.oracleRoot, "plaintext.txt"),
  };
  const requestPath = join(overlapRoot, "request.json");
  await writeFile(
    requestPath,
    `${JSON.stringify({ committed, privateSources, plaintextSources, scan }, null, 2)}\n`,
    "utf8",
  );
  const overlap = decodeOverlapResult(
    await runPythonJson(root, "palimpsest.evaluation.overlap", ["--request", requestPath]),
  );
  await writeFile(join(dirname(result.tracePath), "overlap.json"), `${JSON.stringify(overlap)}\n`);
  await appendTraceEvent(result.tracePath, "overlap.observed", overlap);
  return decodeOverlapResult(await readJsonObject(join(dirname(result.tracePath), "overlap.json")));
}
