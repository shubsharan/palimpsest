import { join, resolve } from "node:path";

import {
  decodeAttemptSummary,
  decodeBuildResult,
  decodeEvaluationRecord,
  decodeOverlapResult,
} from "./artifacts.js";
import { buildPuzzle, type BuildPuzzleResult } from "./build.js";
import { publishBehaviorEvidence } from "./behavior.js";
import {
  ATTEMPT_CUTOFF_MS,
  RELEASE_OFFSETS_MS,
  resolveCondition,
  type ConditionId,
} from "./condition.js";
import { evaluatePuzzle } from "./evaluate.js";
import { requiredFlag } from "./flags.js";
import { readJsonObject } from "./python.js";
import type { MonotonicClock } from "./reveal.js";
import { createFixtureAgentRuntimes, runPuzzle, type RunPuzzleResult } from "./run.js";

const OFFLINE_BLOCK = "calibration-odd-women";

export interface OfflinePuzzleOptions {
  root: string;
  output: string;
  condition: ConditionId;
}

export interface OfflinePuzzleResult {
  build: BuildPuzzleResult;
  run: RunPuzzleResult;
  evaluation: Awaited<ReturnType<typeof evaluatePuzzle>>;
}

function acceleratedClock(): MonotonicClock {
  let now = 0;
  let scheduled = false;
  const waits = new Set<{
    deadline: number;
    resolve: (reached: boolean) => void;
    signal: AbortSignal;
    abort: () => void;
  }>();
  const scheduleAdvance = () => {
    if (scheduled || waits.size < 2) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const live = [...waits].filter((wait) => !wait.signal.aborted);
      if (live.length < 2) return;
      now = Math.max(now, Math.min(...live.map((wait) => wait.deadline)));
      for (const wait of live) {
        if (wait.deadline <= now) {
          waits.delete(wait);
          wait.signal.removeEventListener("abort", wait.abort);
          wait.resolve(true);
        }
      }
      scheduleAdvance();
    });
  };
  return {
    nowMs: () => now,
    waitUntil(deadline, signal) {
      if (signal.aborted) return Promise.resolve(false);
      if (deadline <= now) return Promise.resolve(true);
      return new Promise((resolve) => {
        const wait = {
          deadline,
          resolve,
          signal,
          abort: () => {
            waits.delete(wait);
            resolve(false);
          },
        };
        waits.add(wait);
        signal.addEventListener("abort", wait.abort, { once: true });
        scheduleAdvance();
      });
    },
  };
}

export async function runOfflinePuzzle(
  options: OfflinePuzzleOptions,
): Promise<OfflinePuzzleResult> {
  const root = resolve(options.root);
  const output = resolve(options.output);
  const build = await buildPuzzle({
    root,
    output: resolve(output, "build"),
    source: resolve(root, "fixtures/chronicles-of-break-oday.txt"),
    phase: "calibration",
    block: OFFLINE_BLOCK,
  });
  const run = await runPuzzle({
    root,
    buildRoot: build.buildPath,
    output: resolve(output, "attempt"),
    studyPhase: "standalone",
    monetaryAuthorizationCeilingCents: 0,
    condition: options.condition,
    agents: createFixtureAgentRuntimes(build.agentIds, "collaborative-revision"),
    releaseOffsetsMs: RELEASE_OFFSETS_MS,
    cutoffMs: ATTEMPT_CUTOFF_MS,
    tokenBudgetPerAgent: 100,
    teamChannel: "enabled",
    clock: acceleratedClock(),
  });
  const evaluation = await evaluatePuzzle({
    root,
    attempt: run.attemptRoot,
  });
  await publishBehaviorEvidence({
    attempt: decodeAttemptSummary(await readJsonObject(join(run.attemptRoot, "attempt.json"))),
    evaluation,
    attemptRoot: run.attemptRoot,
  });
  return {
    build: decodeBuildResult(build),
    run: { ...run, overlap: decodeOverlapResult(run.overlap) },
    evaluation: decodeEvaluationRecord(evaluation),
  };
}

export function runOfflinePuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<OfflinePuzzleResult> {
  return runOfflinePuzzle({
    root,
    output: requiredFlag(flags, "--output"),
    condition: resolveCondition(requiredFlag(flags, "--condition")).id,
  });
}
