import { cp, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { ActivityBus } from "./activity.js";
import {
  decodeAttemptSummary,
  decodeBuildManifest,
  publishAttemptSummary,
  type AttemptSummary,
  type OverlapResult,
} from "./artifacts.js";
import { createChecker } from "./checker.js";
import { integerFlag, requiredFlag } from "./flags.js";
import { createFixtureModelAdapter } from "./fixture.js";
import {
  createGitEnvironment,
  freezeGitEnvironment,
  GitActivityMonitor,
  type FrozenGitEnvironment,
  type GitEnvironment,
} from "./git.js";
import { AGENT_IDS, type AgentId, type ModelAdapter } from "./model.js";
import { observeOverlap } from "./overlap.js";
import { buildAgentPrompt } from "./prompt.js";
import { createOpenAIModelAdapter } from "./provider.js";
import { absoluteFrom, appendTraceEvent, readJsonObject } from "./python.js";
import { runRevealSchedule, systemMonotonicClock, type MonotonicClock } from "./reveal.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";
import {
  SANDBOX_POLICY,
  type AgentSandboxLease,
  type CommandSandbox,
  type SandboxIdentity,
} from "./sandbox/contracts.js";
import { runAgentSession, type AgentSessionResult } from "./session.js";
import { createAgentTools, type CheckerHook } from "./tools.js";
import { JsonlObservationLog } from "./trace.js";

export interface AttemptConfig {
  attemptId: string;
  artifactRoot: string;
  buildPath: string;
  referenceCorpusPath: string;
  agentStages: Record<AgentId, readonly string[]>;
  tokenBudgetPerAgent: number;
  wallTimeMs: number;
  stageIntervalMs: number;
  shutdownToleranceMs: number;
}

export interface AttemptResult {
  attemptId: string;
  sessions: readonly AgentSessionResult[];
  frozen: FrozenGitEnvironment;
  tracePath: string;
  traceMetadataPath: string;
  sandbox: SandboxIdentity;
}

export interface RunAttemptOptions {
  config: AttemptConfig;
  adapter: ModelAdapter;
  checker: CheckerHook;
  sandbox: CommandSandbox;
  clock: MonotonicClock;
  gitPollIntervalMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value;
}

function requirePositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${key} must be a positive safe integer.`);
  }
  return value as number;
}

export function validateAttemptConfig(value: unknown): AttemptConfig {
  if (!isRecord(value)) {
    throw new Error("Attempt configuration must be an object.");
  }
  const stagesValue = value.agentStages;
  if (!isRecord(stagesValue)) {
    throw new Error("agentStages must describe exactly three agents.");
  }
  const stageKeys = Object.keys(stagesValue).sort();
  if (
    stageKeys.length !== AGENT_IDS.length ||
    AGENT_IDS.some((agentId, index) => stageKeys[index] !== agentId)
  ) {
    throw new Error("agentStages must describe exactly three agents.");
  }
  const requireStages = (agentId: AgentId): readonly string[] => {
    const stages = stagesValue[agentId];
    if (
      !Array.isArray(stages) ||
      stages.length !== 6 ||
      stages.some((stage) => typeof stage !== "string" || stage.length === 0)
    ) {
      throw new Error(`${agentId} must have exactly six stages.`);
    }
    return [...stages] as string[];
  };
  return {
    attemptId: requireNonEmptyString(value, "attemptId"),
    artifactRoot: requireNonEmptyString(value, "artifactRoot"),
    buildPath: requireNonEmptyString(value, "buildPath"),
    referenceCorpusPath: requireNonEmptyString(value, "referenceCorpusPath"),
    agentStages: {
      "agent-1": requireStages("agent-1"),
      "agent-2": requireStages("agent-2"),
      "agent-3": requireStages("agent-3"),
    },
    tokenBudgetPerAgent: requirePositiveInteger(value, "tokenBudgetPerAgent"),
    wallTimeMs: requirePositiveInteger(value, "wallTimeMs"),
    stageIntervalMs: requirePositiveInteger(value, "stageIntervalMs"),
    shutdownToleranceMs: requirePositiveInteger(value, "shutdownToleranceMs"),
  };
}

async function publishStages(options: {
  config: AttemptConfig;
  evidencePaths: Record<AgentId, string>;
  releasedStages: Record<AgentId, Set<number>>;
  activity: ActivityBus;
  observationLog: JsonlObservationLog;
  startedAt: number;
  clock: MonotonicClock;
  signal: AbortSignal;
}): Promise<void> {
  await runRevealSchedule({
    clock: options.clock,
    startedAtMs: options.startedAt,
    stageIntervalMs: options.config.stageIntervalMs,
    stageCount: 6,
    signal: options.signal,
    reveal: (ordinal) => publishStage(options, ordinal),
  });
}

async function publishStage(
  options: Omit<Parameters<typeof publishStages>[0], "startedAt" | "clock" | "signal">,
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

async function openAgentLeases(options: {
  sandbox: CommandSandbox;
  git: GitEnvironment;
  evidencePaths: Record<AgentId, string>;
  referenceCorpusPath: string;
}): Promise<Record<AgentId, AgentSandboxLease>> {
  const settled = await Promise.allSettled(
    AGENT_IDS.map(async (agentId) => {
      const workspace = options.git.workspaces.find((candidate) => candidate.agentId === agentId);
      if (!workspace) throw new Error(`Git workspace is missing for ${agentId}.`);
      const lease = await options.sandbox.openAgentLease({
        profile: "agent",
        workspacePath: workspace.path,
        evidencePath: options.evidencePaths[agentId],
        referenceCorpusPath: options.referenceCorpusPath,
        sharedGitPath: options.git.barePath,
        timeoutMs: 30_000,
      });
      return [agentId, lease] as const;
    }),
  );
  const opened = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const failed = settled.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    await Promise.all(opened.map(([, lease]) => lease.close()));
    throw failed.reason;
  }
  return Object.fromEntries(opened) as Record<AgentId, AgentSandboxLease>;
}

export async function runAttempt(options: RunAttemptOptions): Promise<AttemptResult> {
  const config = validateAttemptConfig(options.config);
  await mkdir(config.artifactRoot, { recursive: false });
  const git = await createGitEnvironment(join(config.artifactRoot, "git"));
  const evidencePaths = Object.fromEntries(
    await Promise.all(
      AGENT_IDS.map(async (agentId) => {
        const path = join(config.artifactRoot, "private-evidence", agentId);
        await mkdir(path, { recursive: true });
        return [agentId, path] as const;
      }),
    ),
  ) as Record<AgentId, string>;

  const startedAt = options.clock.nowMs();
  const tracePath = join(config.artifactRoot, "trace.jsonl");
  const observationLog = await JsonlObservationLog.create(tracePath, {
    nowMs: () => options.clock.nowMs() - startedAt,
  });
  await observationLog.append("attempt.configured", {
    attemptId: config.attemptId,
    tokenBudgetPerAgent: config.tokenBudgetPerAgent,
    wallTimeMs: config.wallTimeMs,
    stageIntervalMs: config.stageIntervalMs,
    agentCount: 3,
    stageCount: 6,
  });

  const activity = new ActivityBus(() => options.clock.nowMs() - startedAt);
  const monitor = new GitActivityMonitor({
    barePath: git.barePath,
    activity,
    pollIntervalMs: options.gitPollIntervalMs ?? 20,
    onChange: async (refs) => {
      await observationLog.append("git.changed", { refs });
    },
  });
  await monitor.start();

  const releasedStages = Object.fromEntries(
    AGENT_IDS.map((agentId) => [agentId, new Set<number>()]),
  ) as Record<AgentId, Set<number>>;
  await publishStage({ config, evidencePaths, releasedStages, activity, observationLog }, 1);
  const cursors = Object.fromEntries(AGENT_IDS.map((agentId) => [agentId, 0])) as Record<
    AgentId,
    number
  >;
  for (const agentId of AGENT_IDS) cursors[agentId] = activity.latestSequence;
  const sandboxLeases = await openAgentLeases({
    sandbox: options.sandbox,
    git,
    evidencePaths,
    referenceCorpusPath: config.referenceCorpusPath,
  });

  const globalController = new AbortController();
  const scheduleController = new AbortController();
  const wallController = new AbortController();
  const stopScheduleAtWallTime = () => scheduleController.abort();
  globalController.signal.addEventListener("abort", stopScheduleAtWallTime, { once: true });
  const wallTime = options.clock
    .waitUntil(startedAt + config.wallTimeMs, wallController.signal)
    .then((reached) => {
      if (reached) globalController.abort("time-exhausted");
    });
  const stagePublishing = publishStages({
    config,
    evidencePaths,
    releasedStages,
    activity,
    observationLog,
    startedAt,
    clock: options.clock,
    signal: scheduleController.signal,
  });

  const sessionPromises = AGENT_IDS.map((agentId) => {
    const workspace = git.workspaces.find((candidate) => candidate.agentId === agentId);
    if (!workspace) throw new Error(`Git workspace is missing for ${agentId}.`);
    const tools = createAgentTools({
      agentId,
      workspacePath: workspace.path,
      sandbox: sandboxLeases[agentId],
      activity,
      checker: options.checker,
      getReleasedStages: () => [...releasedStages[agentId]].sort((left, right) => left - right),
      getActivityCursor: () => cursors[agentId],
      setActivityCursor: (sequence) => {
        cursors[agentId] = sequence;
      },
    });
    return runAgentSession({
      agentId,
      prompt: buildAgentPrompt({ agentId }),
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
    wallController.abort("sessions-ended");
    scheduleController.abort("sessions-ended");
    globalController.signal.removeEventListener("abort", stopScheduleAtWallTime);
    await Promise.all([stagePublishing, wallTime]);
    await monitor.stop();
    await Promise.all(AGENT_IDS.map((agentId) => sandboxLeases[agentId].close()));
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
  return {
    attemptId: config.attemptId,
    sessions,
    frozen,
    tracePath,
    traceMetadataPath: observationLog.metadataPath,
    sandbox: options.sandbox.identity,
  };
}

export interface RunPuzzleOptions {
  root: string;
  buildRoot: string;
  output: string;
  adapter: "fixture" | "openai";
  tokenBudget: number;
  wallTimeMs: number;
  model?: string;
  fixtureScenario?: string;
}

export interface RunPuzzleResult extends AttemptResult {
  attemptRoot: string;
  buildRoot: string;
  overlap: OverlapResult;
}

export interface FinalizeAttemptOptions {
  attemptRoot: string;
  buildRoot: string;
  result: AttemptResult;
  publishSummary: (attemptRoot: string, summary: AttemptSummary) => Promise<void>;
  observeOverlap: () => Promise<OverlapResult>;
  appendTrace: (tracePath: string, kind: string, data: unknown) => Promise<void>;
}

export async function finalizeAttempt(options: FinalizeAttemptOptions): Promise<OverlapResult> {
  const summary = decodeAttemptSummary({
    attemptId: options.result.attemptId,
    buildRoot: options.buildRoot,
    tracePath: options.result.tracePath,
    traceMetadataPath: options.result.traceMetadataPath,
    frozenRoot: options.result.frozen.root,
    sandbox: { ...options.result.sandbox, ...SANDBOX_POLICY },
    sessions: options.result.sessions,
  });
  await options.publishSummary(options.attemptRoot, summary);
  try {
    return await options.observeOverlap();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await options
      .appendTrace(options.result.tracePath, "overlap.failed", { error: detail })
      .catch(() => undefined);
    throw error;
  }
}

export async function runPuzzle(options: RunPuzzleOptions): Promise<RunPuzzleResult> {
  const root = resolve(options.root);
  const buildRoot = resolve(options.buildRoot);
  const output = resolve(options.output);
  if (options.tokenBudget <= 0 || options.wallTimeMs <= 0) {
    throw new Error("Token budget and wall time must be positive.");
  }
  await mkdir(dirname(output), { recursive: true });
  const manifest = decodeBuildManifest(await readJsonObject(join(buildRoot, "puzzle-build.json")));
  const stagesFor = (agentId: AgentId) =>
    manifest.stages
      .filter((stage) => stage.agentId === agentId)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((stage) => absoluteFrom(buildRoot, stage.sourcePath));
  const agentStages: AttemptConfig["agentStages"] = {
    "agent-1": stagesFor("agent-1"),
    "agent-2": stagesFor("agent-2"),
    "agent-3": stagesFor("agent-3"),
  };
  const config: AttemptConfig = {
    attemptId: `attempt-${manifest.buildId.slice("build-".length, "build-".length + 16)}`,
    artifactRoot: output,
    buildPath: join(buildRoot, "puzzle-build.json"),
    referenceCorpusPath: absoluteFrom(buildRoot, manifest.referenceCorpusPath),
    agentStages,
    tokenBudgetPerAgent: options.tokenBudget,
    wallTimeMs: options.wallTimeMs,
    stageIntervalMs: manifest.stageIntervalMs,
    shutdownToleranceMs: 5_000,
  };
  let adapter: ModelAdapter;
  if (options.adapter === "fixture") {
    adapter = createFixtureModelAdapter(options.fixtureScenario);
  } else {
    if (!options.model) throw new Error("--model is required for the live OpenAI adapter.");
    adapter = createOpenAIModelAdapter(options.model);
  }
  const sandbox = await createDockerCommandSandbox({ root });
  const result = await runAttempt({
    config,
    adapter,
    checker: createChecker(root, buildRoot),
    sandbox,
    clock: systemMonotonicClock,
  });
  const overlap = await finalizeAttempt({
    attemptRoot: output,
    buildRoot,
    result,
    publishSummary: publishAttemptSummary,
    observeOverlap: () => observeOverlap(root, buildRoot, result),
    appendTrace: appendTraceEvent,
  });
  decodeAttemptSummary(await readJsonObject(join(output, "attempt.json")));
  return { ...result, attemptRoot: output, buildRoot, overlap };
}

export function runPuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<RunPuzzleResult> {
  const adapter = requiredFlag(flags, "--adapter");
  if (adapter !== "fixture" && adapter !== "openai") {
    throw new Error("--adapter must be fixture or openai.");
  }
  const model = flags.get("--model");
  const fixtureScenario = flags.get("--fixture-scenario");
  return runPuzzle({
    root,
    buildRoot: requiredFlag(flags, "--build"),
    output: requiredFlag(flags, "--output"),
    adapter,
    tokenBudget: integerFlag(flags, "--token-budget"),
    wallTimeMs: integerFlag(flags, "--wall-time-ms"),
    ...(model === undefined ? {} : { model }),
    ...(fixtureScenario === undefined ? {} : { fixtureScenario }),
  });
}
