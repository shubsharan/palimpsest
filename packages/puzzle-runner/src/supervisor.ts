import { cp, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { ActivityBus } from "./activity.js";
import type { AgentAdapter } from "./adapters.js";
import { AGENT_IDS, type AgentId, type AttemptConfig, validateAttemptConfig } from "./config.js";
import {
  createGitEnvironment,
  freezeGitEnvironment,
  GitActivityMonitor,
  type FrozenGitEnvironment,
} from "./git.js";
import { JsonlObservationLog } from "./observations.js";
import { buildAgentPrompt } from "./prompt.js";
import { runAgentSession, type AgentSessionResult } from "./session.js";
import { createAgentTools, type CheckerHook } from "./tools.js";

export interface AttemptResult {
  attemptId: string;
  sessions: readonly AgentSessionResult[];
  frozen: FrozenGitEnvironment;
  tracePath: string;
}

export interface RunAttemptOptions {
  config: AttemptConfig;
  adapter: AgentAdapter;
  checker: CheckerHook;
  gitPollIntervalMs?: number;
}

function waitUntil(startedAt: number, offsetMs: number, signal: AbortSignal): Promise<boolean> {
  const remaining = Math.max(0, startedAt + offsetMs - performance.now());
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve(true);
    }, remaining);
    const abort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function publishStages(options: {
  config: AttemptConfig;
  evidencePaths: Record<AgentId, string>;
  releasedStages: Record<AgentId, Set<number>>;
  activity: ActivityBus;
  observationLog: JsonlObservationLog;
  startedAt: number;
  signal: AbortSignal;
}): Promise<void> {
  for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
    const ready = await waitUntil(
      options.startedAt,
      (ordinal - 1) * options.config.stageIntervalMs,
      options.signal,
    );
    if (!ready) return;
    await publishStage(options, ordinal);
  }
}

async function publishStage(
  options: Omit<Parameters<typeof publishStages>[0], "startedAt" | "signal">,
  ordinal: number,
): Promise<void> {
  await Promise.all(
    AGENT_IDS.map(async (agentId) => {
      const source = options.config.agentStages[agentId][ordinal - 1];
      if (source === undefined) throw new Error(`Missing ${agentId} stage ${ordinal}.`);
      const destination = join(
        options.evidencePaths[agentId],
        `stage-${String(ordinal).padStart(2, "0")}-${basename(source)}`,
      );
      await cp(source, destination, { errorOnExist: true, force: false });
      options.releasedStages[agentId].add(ordinal);
      const activity = options.activity.publish({
        kind: "stage-released",
        agentId,
        detail: { ordinal, path: destination },
      });
      await options.observationLog.append(
        "stage.released",
        { ordinal, path: destination, activitySequence: activity.sequence },
        agentId,
      );
    }),
  );
}

export async function runAttempt(options: RunAttemptOptions): Promise<AttemptResult> {
  const config = validateAttemptConfig(options.config);
  await mkdir(config.artifactRoot, { recursive: false });
  const startedAt = performance.now();
  const tracePath = join(config.artifactRoot, "trace.jsonl");
  const observationLog = new JsonlObservationLog(tracePath, () => performance.now() - startedAt);
  await observationLog.append("attempt.configured", {
    attemptId: config.attemptId,
    tokenBudgetPerAgent: config.tokenBudgetPerAgent,
    wallTimeMs: config.wallTimeMs,
    stageIntervalMs: config.stageIntervalMs,
    agentCount: 3,
    stageCount: 6,
  });

  const git = await createGitEnvironment(join(config.artifactRoot, "git"));
  const activity = new ActivityBus(() => performance.now() - startedAt);
  const monitor = new GitActivityMonitor({
    barePath: git.barePath,
    activity,
    pollIntervalMs: options.gitPollIntervalMs ?? 20,
    onChange: async (refs) => {
      await observationLog.append("git.changed", { refs });
    },
  });
  await monitor.start();

  const evidencePaths = Object.fromEntries(
    await Promise.all(
      AGENT_IDS.map(async (agentId) => {
        const path = join(config.artifactRoot, "private-evidence", agentId);
        await mkdir(path, { recursive: true });
        return [agentId, path] as const;
      }),
    ),
  ) as Record<AgentId, string>;
  const releasedStages = Object.fromEntries(
    AGENT_IDS.map((agentId) => [agentId, new Set<number>()]),
  ) as Record<AgentId, Set<number>>;
  await publishStage(
    {
      config,
      evidencePaths,
      releasedStages,
      activity,
      observationLog,
    },
    1,
  );
  const cursors = Object.fromEntries(AGENT_IDS.map((agentId) => [agentId, 0])) as Record<
    AgentId,
    number
  >;
  for (const agentId of AGENT_IDS) cursors[agentId] = activity.latestSequence;

  const globalController = new AbortController();
  const scheduleController = new AbortController();
  const stopScheduleAtWallTime = () => scheduleController.abort();
  globalController.signal.addEventListener("abort", stopScheduleAtWallTime, { once: true });
  const wallTimeRemaining = Math.max(0, config.wallTimeMs - (performance.now() - startedAt));
  const wallTimer = setTimeout(() => globalController.abort("time-exhausted"), wallTimeRemaining);
  const stagePublishing = publishStages({
    config,
    evidencePaths,
    releasedStages,
    activity,
    observationLog,
    startedAt,
    signal: scheduleController.signal,
  });

  const sessionPromises = AGENT_IDS.map((agentId) => {
    const workspace = git.workspaces.find((candidate) => candidate.agentId === agentId);
    if (!workspace) throw new Error(`Git workspace is missing for ${agentId}.`);
    const tools = createAgentTools({
      agentId,
      workspacePath: workspace.path,
      activity,
      checker: options.checker,
      getReleasedStages: () => [...releasedStages[agentId]].sort((left, right) => left - right),
      getActivityCursor: () => cursors[agentId],
      setActivityCursor: (sequence) => {
        cursors[agentId] = sequence;
      },
    });
    const prompt = buildAgentPrompt({
      agentId,
      workspacePath: workspace.path,
      evidencePath: evidencePaths[agentId],
      referenceCorpusPath: config.referenceCorpusPath,
    });
    return runAgentSession({
      agentId,
      prompt,
      adapter: options.adapter,
      tools,
      tokenBudget: config.tokenBudgetPerAgent,
      signal: globalController.signal,
      getActivityCursor: () => cursors[agentId],
      observe: async (kind, data, observedAgentId) => {
        await observationLog.append(kind, data, observedAgentId);
      },
    });
  });

  let sessions: readonly AgentSessionResult[];
  try {
    sessions = await Promise.all(sessionPromises);
  } finally {
    clearTimeout(wallTimer);
    scheduleController.abort("sessions-ended");
    globalController.signal.removeEventListener("abort", stopScheduleAtWallTime);
    await stagePublishing;
    await monitor.stop();
  }
  activity.end(globalController.signal.aborted ? "time-exhausted" : "sessions-ended");
  await observationLog.append("attempt.sessions-ended", {
    sessions: sessions.map((session) => ({
      agentId: session.agentId,
      state: session.state,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      terminationReason: session.terminationReason,
    })),
  });
  await observationLog.flush();

  const frozen = await freezeGitEnvironment(git, join(config.artifactRoot, "frozen"));
  await observationLog.append("attempt.frozen", {
    repositoryPath: frozen.barePath,
    workspaces: frozen.workspaces,
  });
  await observationLog.flush();
  return { attemptId: config.attemptId, sessions, frozen, tracePath };
}

export class Supervisor {
  readonly #options: RunAttemptOptions;

  constructor(options: RunAttemptOptions) {
    this.#options = options;
  }

  run(): Promise<AttemptResult> {
    return runAttempt(this.#options);
  }
}
