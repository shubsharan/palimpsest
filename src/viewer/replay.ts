import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { loadFixturePackage } from "../fixture/package.js";
import { PUBLISHED_MAIN_REF, executePublishedSolver } from "../evaluation/published-solver.js";
import { runGitCommand } from "../git.js";
import { runPythonJson } from "../python.js";
import { loadRunRecord, validateRunRecordTrace } from "../run/record.js";
import { createDockerCommandSandbox } from "../sandbox/container.js";
import type { CommandSandbox } from "../sandbox/contracts.js";
import { readObservationTrace } from "../trace.js";
import type {
  DecodeCheckpoint,
  DecodeStreamEvent,
  DecodeWordDelta,
  DecodeWordState,
} from "./contracts.js";
import { discoverDecodeCheckpoints, type DecodeCheckpointSource } from "./git-checkpoints.js";

const CHECKPOINT_TIMEOUT_MS = 30_000;
const WORD_STATES = new Set<DecodeWordState>([
  "newly-correct",
  "previously-correct",
  "regressed",
  "changed-incorrect",
  "unchanged",
]);

interface PlaybackDeltaResult {
  matchedWords: number;
  totalWords: number;
  coverage: number;
  accuracy: number;
  predictedWordCount: number;
  deltas: DecodeWordDelta[];
  newlyCorrectRanges: { start: number; end: number }[];
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return value as number;
}

function ratio(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between zero and one.`);
  }
  return value;
}

function decodeDeltaResult(value: unknown): PlaybackDeltaResult {
  const root = object(value, "Playback delta");
  if (!Array.isArray(root.deltas) || !Array.isArray(root.newlyCorrectRanges)) {
    throw new Error("Playback delta arrays are missing.");
  }
  const deltas = root.deltas.map((raw, index): DecodeWordDelta => {
    const delta = object(raw, `Playback delta ${String(index + 1)}`);
    if (
      (delta.candidate !== null && typeof delta.candidate !== "string") ||
      typeof delta.state !== "string" ||
      !WORD_STATES.has(delta.state as DecodeWordState)
    ) {
      throw new Error(`Playback delta ${String(index + 1)} is invalid.`);
    }
    return {
      index: integer(delta.index, `Playback delta ${String(index + 1)} index`),
      candidate: delta.candidate,
      state: delta.state as DecodeWordState,
    };
  });
  const newlyCorrectRanges = root.newlyCorrectRanges.map((raw, index) => {
    const range = object(raw, `Playback range ${String(index + 1)}`);
    const start = integer(range.start, `Playback range ${String(index + 1)} start`);
    const end = integer(range.end, `Playback range ${String(index + 1)} end`);
    if (end < start) throw new Error(`Playback range ${String(index + 1)} regresses.`);
    return { start, end };
  });
  return {
    matchedWords: integer(root.matchedWords, "Playback matchedWords"),
    totalWords: integer(root.totalWords, "Playback totalWords"),
    coverage: ratio(root.coverage, "Playback coverage"),
    accuracy: ratio(root.accuracy, "Playback accuracy"),
    predictedWordCount: integer(root.predictedWordCount, "Playback predictedWordCount"),
    deltas,
    newlyCorrectRanges,
  };
}

async function materializeCommit(
  source: DecodeCheckpointSource,
  snapshotPath: string,
): Promise<void> {
  await runGitCommand(["clone", "--no-checkout", "--quiet", source.repositoryPath, snapshotPath]);
  await runGitCommand(["checkout", "--detach", "--quiet", source.commit], { cwd: snapshotPath });
  await rm(join(snapshotPath, ".git"), { recursive: true, force: false });
}

async function reconstructCheckpoint(options: {
  root: string;
  source: DecodeCheckpointSource;
  sandbox: CommandSandbox;
  ciphertextPath: string;
  truthPath: string;
  previousPath: string;
}): Promise<{ checkpoint: DecodeCheckpoint; candidate: string }> {
  if (options.source.failure !== undefined) throw new Error(options.source.failure);
  const scratchRoot = await mkdtemp(join(tmpdir(), "palimpsest-viewer-checkpoint-"));
  const snapshotPath = join(scratchRoot, "submission");
  const outputRoot = join(scratchRoot, "output");
  try {
    await Promise.all([materializeCommit(options.source, snapshotPath), mkdir(outputRoot)]);
    const execution = await executePublishedSolver({
      snapshot: {
        ref: PUBLISHED_MAIN_REF,
        commit: options.source.commit,
        snapshotPath,
      },
      ciphertextPath: options.ciphertextPath,
      outputRoot,
      sandbox: options.sandbox,
      timeoutMs: CHECKPOINT_TIMEOUT_MS,
    });
    if (execution.kind === "submission-error") throw new Error(execution.error);
    const candidate = await readFile(execution.outputPath, "utf8");
    const delta = decodeDeltaResult(
      await runPythonJson(options.root, "palimpsest.evaluation.playback", [
        "--truth",
        options.truthPath,
        "--previous",
        options.previousPath,
        "--candidate",
        execution.outputPath,
      ]),
    );
    return {
      checkpoint: {
        checkpointId: `${options.source.originId}:${options.source.commit}`,
        originId: options.source.originId,
        commit: options.source.commit,
        atMs: options.source.atMs,
        timing: options.source.timing,
        ...(options.source.authorAgentId === undefined
          ? {}
          : { authorAgentId: options.source.authorAgentId }),
        author: options.source.author,
        subject: options.source.subject,
        status: "ready",
        ...delta,
      },
      candidate,
    };
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
}

function failedCheckpoint(source: DecodeCheckpointSource, error: unknown): DecodeCheckpoint {
  return {
    checkpointId: `${source.originId}:${source.commit}`,
    originId: source.originId,
    commit: source.commit,
    atMs: source.atMs,
    timing: source.timing,
    ...(source.authorAgentId === undefined ? {} : { authorAgentId: source.authorAgentId }),
    author: source.author,
    subject: source.subject,
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  };
}

export async function* reconstructDecodeReplay(options: {
  root: string;
  runRoot: string;
  sandbox?: CommandSandbox;
}): AsyncGenerator<DecodeStreamEvent> {
  const root = resolve(options.root);
  const runRoot = resolve(options.runRoot);
  const loaded = await loadRunRecord(root, runRoot);
  await validateRunRecordTrace(runRoot, loaded.record.trace);
  const fixture = await loadFixturePackage(loaded.fixtureRoot);
  if (fixture.contentDigest !== loaded.record.configuration.run.fixture.digest) {
    throw new Error("The replay fixture digest differs from the recorded run fixture digest.");
  }
  const trace = await readObservationTrace(join(runRoot, loaded.record.trace.path));
  const durationMs = Math.max(
    trace.events.at(-1)?.atMs ?? 0,
    Date.parse(loaded.record.frozenAt) - Date.parse(loaded.record.startedAt),
  );
  const sources = await discoverDecodeCheckpoints({
    repositories: loaded.topology.repositories,
    events: trace.events,
    startedAt: loaded.record.startedAt,
    durationMs,
  });
  yield {
    type: "started",
    origins: loaded.topology.repositories.map((repository) => ({
      originId: repository.repositoryId,
      checkpointCount: sources.filter(({ originId }) => originId === repository.repositoryId)
        .length,
    })),
  };
  if (sources.length === 0) {
    yield { type: "complete" };
    return;
  }
  let sandbox: CommandSandbox;
  try {
    sandbox =
      options.sandbox ??
      (await createDockerCommandSandbox({
        root,
        expectedImageId: loaded.record.configuration.validation.sandbox.imageId,
      }));
  } catch (error) {
    yield { type: "failed", error: error instanceof Error ? error.message : String(error) };
    return;
  }
  const ciphertextPath = join(loaded.fixtureRoot, fixture.publicCiphertextPath);
  const truthPath = join(loaded.fixtureRoot, "oracle", "plaintext.txt");
  const previousRoot = await mkdtemp(join(tmpdir(), "palimpsest-viewer-previous-"));
  const previousPaths = new Map<string, string>();
  try {
    const ciphertext = await readFile(ciphertextPath, "utf8");
    for (const repository of loaded.topology.repositories) {
      const previousPath = join(previousRoot, `${repository.repositoryId}.txt`);
      await writeFile(previousPath, ciphertext, "utf8");
      previousPaths.set(repository.repositoryId, previousPath);
    }
    for (const source of sources) {
      const previousPath = previousPaths.get(source.originId);
      if (previousPath === undefined) {
        yield { type: "checkpoint", checkpoint: failedCheckpoint(source, "Missing origin state.") };
        continue;
      }
      try {
        const result = await reconstructCheckpoint({
          root,
          source,
          sandbox,
          ciphertextPath,
          truthPath,
          previousPath,
        });
        await writeFile(previousPath, result.candidate, "utf8");
        yield { type: "checkpoint", checkpoint: result.checkpoint };
      } catch (error) {
        yield { type: "checkpoint", checkpoint: failedCheckpoint(source, error) };
      }
    }
  } finally {
    await rm(previousRoot, { recursive: true, force: true });
  }
  yield { type: "complete" };
}
