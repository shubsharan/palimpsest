import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  VisibilityJournal,
  buildLogicalTransaction,
  encodeGitAccountingFrame,
  refOperations,
} from "@palimpsest/git-accounting";

const execFileAsync = promisify(execFile);
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};

async function git(repository: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: gitEnvironment,
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout.trim();
}

async function initializeRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "palimpsest-gate-a-materialization-"));
  await execFileAsync("git", ["init", "--quiet", "--object-format=sha256", repository], {
    env: gitEnvironment,
  });
  await git(repository, ["config", "user.name", "Palimpsest Evidence"]);
  await git(repository, ["config", "user.email", "evidence@palimpsest.invalid"]);
  return repository;
}

export interface GitMaterializationResult {
  cumulativeFrameBytes: number;
  exactReconstruction: boolean;
  frameDigestsInput: Buffer[];
  strategyId: string;
  transactionCount: number;
}

export async function materializeBlobHistory(
  payload: Buffer,
  splitCount: number,
): Promise<GitMaterializationResult> {
  if (!Number.isInteger(splitCount) || splitCount <= 0 || splitCount > 120) {
    throw new Error("Split count must be between 1 and 120.");
  }
  const repository = await initializeRepository();
  try {
    const payloadRoot = join(repository, "payload");
    await mkdir(payloadRoot);
    const frames: Buffer[] = [];
    let journal = new VisibilityJournal();
    let oldOid: string | undefined;
    for (let index = 0; index < splitCount; index += 1) {
      const start = Math.floor((payload.length * index) / splitCount);
      const end = Math.floor((payload.length * (index + 1)) / splitCount);
      await writeFile(
        join(payloadRoot, `chunk-${String(index).padStart(3, "0")}.bin`),
        payload.subarray(start, end),
      );
      await git(repository, ["add", "payload"]);
      await git(repository, ["commit", "--quiet", "-m", `relay chunk ${index + 1}`]);
      const newOid = await git(repository, ["rev-parse", "HEAD"]);
      const transaction = await buildLogicalTransaction({
        authenticatedAgent: 1,
        newOid,
        ...(oldOid === undefined ? {} : { oldOid }),
        operation: oldOid === undefined ? refOperations.create : refOperations.update,
        publicationSlot: index,
        refName: "refs/heads/agents/agent-1/relay",
        repository,
        slotStartJournal: journal,
      });
      const frame = encodeGitAccountingFrame(transaction);
      frames.push(frame);
      journal = journal.withAcceptedObjects([transaction.objects]);
      oldOid = newOid;
    }
    const reconstructed = Buffer.concat(
      await Promise.all(
        Array.from({ length: splitCount }, (_, index) =>
          readFile(join(payloadRoot, `chunk-${String(index).padStart(3, "0")}.bin`)),
        ),
      ),
    );
    return {
      cumulativeFrameBytes: frames.reduce((total, frame) => total + frame.length, 0),
      exactReconstruction: reconstructed.equals(payload),
      frameDigestsInput: frames,
      strategyId: `blob-split-${splitCount}`,
      transactionCount: frames.length,
    };
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
}

export async function materializeCommitMessage(payload: Buffer): Promise<GitMaterializationResult> {
  const repository = await initializeRepository();
  try {
    const messagePath = join(repository, "message.txt");
    const armored = payload.toString("base64");
    await writeFile(messagePath, `relay-base64-v1\n${armored}\n`);
    await git(repository, ["commit", "--quiet", "--allow-empty", "-F", messagePath]);
    const tip = await git(repository, ["rev-parse", "HEAD"]);
    const transaction = await buildLogicalTransaction({
      authenticatedAgent: 1,
      newOid: tip,
      operation: refOperations.create,
      publicationSlot: 0,
      refName: "refs/heads/agents/agent-1/relay",
      repository,
      slotStartJournal: new VisibilityJournal(),
    });
    const frame = encodeGitAccountingFrame(transaction);
    const commit = await git(repository, ["cat-file", "commit", tip]);
    const marker = "\n\nrelay-base64-v1\n";
    const markerIndex = commit.indexOf(marker);
    if (markerIndex === -1) {
      throw new Error("Relay commit message marker is missing.");
    }
    const reconstructed = Buffer.from(commit.slice(markerIndex + marker.length).trim(), "base64");
    return {
      cumulativeFrameBytes: frame.length,
      exactReconstruction: reconstructed.equals(payload),
      frameDigestsInput: [frame],
      strategyId: "commit-message-base64",
      transactionCount: 1,
    };
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
}

export async function materializeAcrossGitStrategies(
  payload: Buffer,
): Promise<GitMaterializationResult[]> {
  return Promise.all([
    materializeBlobHistory(payload, 1),
    materializeBlobHistory(payload, 2),
    materializeBlobHistory(payload, 4),
    materializeBlobHistory(payload, 8),
    materializeCommitMessage(payload),
  ]);
}

export async function materializeCheckpointHistory(
  payloads: Buffer[],
): Promise<GitMaterializationResult & { cumulativeCheckpointBytes: number[] }> {
  if (payloads.length === 0 || payloads.length > 120) {
    throw new Error("Checkpoint history must contain between 1 and 120 payloads.");
  }
  const repository = await initializeRepository();
  try {
    const frames: Buffer[] = [];
    const cumulativeCheckpointBytes: number[] = [];
    let cumulativeFrameBytes = 0;
    let journal = new VisibilityJournal();
    let oldOid: string | undefined;
    for (const [index, payload] of payloads.entries()) {
      await writeFile(join(repository, "belief-state.bin"), payload);
      await git(repository, ["add", "belief-state.bin"]);
      await git(repository, ["commit", "--quiet", "-m", `belief checkpoint ${index + 1}`]);
      const newOid = await git(repository, ["rev-parse", "HEAD"]);
      const transaction = await buildLogicalTransaction({
        authenticatedAgent: 1,
        newOid,
        ...(oldOid === undefined ? {} : { oldOid }),
        operation: oldOid === undefined ? refOperations.create : refOperations.update,
        publicationSlot: index,
        refName: "refs/heads/agents/agent-1/belief",
        repository,
        slotStartJournal: journal,
      });
      const frame = encodeGitAccountingFrame(transaction);
      frames.push(frame);
      cumulativeFrameBytes += frame.length;
      cumulativeCheckpointBytes.push(cumulativeFrameBytes);
      journal = journal.withAcceptedObjects([transaction.objects]);
      oldOid = newOid;
    }
    return {
      cumulativeCheckpointBytes,
      cumulativeFrameBytes,
      exactReconstruction: true,
      frameDigestsInput: frames,
      strategyId: "checkpoint-history",
      transactionCount: frames.length,
    };
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
}
