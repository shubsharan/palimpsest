import { resolve } from "node:path";

import { decodeBuildResult, decodeEvaluationRecord, decodeOverlapResult } from "./artifacts.js";
import { buildPuzzle, type BuildPuzzleResult } from "./build.js";
import { resolveCondition, type ConditionId } from "./condition.js";
import { evaluatePuzzle } from "./evaluate.js";
import { requiredFlag } from "./flags.js";
import type { MonotonicClock } from "./reveal.js";
import { createFixtureAgentRuntimes, runPuzzle, type RunPuzzleResult } from "./run.js";

const OFFLINE_BLOCK = "calibration-theron-ware";

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
    tokenBudgetPerAgent: 100,
    clock: acceleratedClock(),
  });
  const evaluation = await evaluatePuzzle({
    root,
    attempt: run.attemptRoot,
    workspace: "agent-1",
    notes: "Offline fixture selects the solver published by agent-1.",
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
