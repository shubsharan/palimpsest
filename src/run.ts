import { cp, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { ActivityBus } from "./activity.js";
import {
  decodeAttemptSummary,
  decodeBuildManifest,
  decodeModelBinding,
  publishAttemptSummary,
  type AttemptSummary,
  type OverlapResult,
} from "./artifacts.js";
import { createChecker } from "./checker.js";
import { createFixtureModelAdapter } from "./fixture.js";
import {
  createGitEnvironment,
  freezeGitEnvironment,
  GitActivityMonitor,
  type FrozenGitEnvironment,
  type GitEnvironment,
} from "./git.js";
import {
  generateAgentIds,
  isAgentId,
  type AgentId,
  type ModelAdapter,
  type ModelBinding,
} from "./model.js";
import { observeOverlap } from "./overlap.js";
import { buildAgentPrompt } from "./prompt.js";
import { absoluteFrom, appendTraceEvent, readJsonObject } from "./python.js";
import { runRevealSchedule, systemMonotonicClock, type MonotonicClock } from "./reveal.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";
import {
  SANDBOX_POLICY,
  SandboxInfrastructureError,
  type AgentSandboxLease,
  type CommandSandbox,
  type SandboxIdentity,
} from "./sandbox/contracts.js";
import { runAgentSession, type AgentSessionResult } from "./session.js";
import { createAgentTools, type CheckerHook } from "./tools.js";
import { JsonlObservationLog } from "./trace.js";

const BUILD_ID = /^build-[a-f0-9]{64}$/;

export interface AttemptConfig {
  attemptId: string;
  buildId: string;
  runName: string;
  repetition: number;
  artifactRoot: string;
  buildRoot: string;
  referenceCorpusPath: string;
  agentIds: readonly AgentId[];
  agentStages: Readonly<Record<AgentId, readonly string[]>>;
  stageCount: number;
  rekeyCount: number;
  tokenBudgetPerAgent: number;
  wallTimeMs: number;
  stageIntervalMs: number;
}

export interface AgentRuntimeBinding {
  model: ModelBinding;
  adapter: ModelAdapter;
}

export type AgentRuntimeMap = Readonly<Record<AgentId, AgentRuntimeBinding>>;

export interface AttemptResult {
  attemptId: string;
  buildId: string;
  runName: string;
  repetition: number;
  buildRoot: string;
  agentIds: readonly AgentId[];
  sessions: readonly AgentSessionResult[];
  frozen: FrozenGitEnvironment;
  tracePath: string;
  traceMetadataPath: string;
  sandbox: SandboxIdentity;
}

export interface RunAttemptOptions {
  config: AttemptConfig;
  agents: AgentRuntimeMap;
  checker: CheckerHook;
  sandbox: CommandSandbox;
  clock: MonotonicClock;
  gitPollIntervalMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isModelAdapter(value: unknown): value is ModelAdapter {
  return (
    typeof value === "object" &&
    value !== null &&
    "openSession" in value &&
    typeof value.openSession === "function"
  );
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

function requireNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${key} must be a non-negative safe integer.`);
  }
  return value as number;
}

function sameKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => key in record);
}

export function validateAttemptConfig(value: unknown): AttemptConfig {
  if (!isRecord(value)) {
    throw new Error("Attempt configuration must be an object.");
  }
  const agentIdsValue = value.agentIds;
  if (
    !Array.isArray(agentIdsValue) ||
    agentIdsValue.length < 2 ||
    agentIdsValue.some((agentId) => !isAgentId(agentId))
  ) {
    throw new Error("agentIds must contain at least two canonical agent IDs.");
  }
  const agentIds = [...agentIdsValue] as AgentId[];
  const expectedAgentIds = generateAgentIds(agentIds.length);
  if (agentIds.some((agentId, index) => agentId !== expectedAgentIds[index])) {
    throw new Error("agentIds must be ordered canonically from agent-1 through agent-N.");
  }

  const stagesValue = value.agentStages;
  if (!isRecord(stagesValue) || !sameKeys(stagesValue, agentIds)) {
    throw new Error("agentStages must match agentIds exactly.");
  }
  const stageCount = requirePositiveInteger(value, "stageCount");
  const agentStages = Object.fromEntries(
    agentIds.map((agentId) => {
      const stages = stagesValue[agentId];
      if (
        !Array.isArray(stages) ||
        stages.length !== stageCount ||
        stages.some((stage) => typeof stage !== "string" || stage.length === 0)
      ) {
        throw new Error(`${agentId} must have exactly ${String(stageCount)} stages.`);
      }
      return [agentId, [...stages] as string[]] as const;
    }),
  ) as Record<AgentId, readonly string[]>;

  const buildId = requireNonEmptyString(value, "buildId");
  if (!BUILD_ID.test(buildId)) {
    throw new Error("buildId must be a build-prefixed SHA-256 digest.");
  }
  return {
    attemptId: requireNonEmptyString(value, "attemptId"),
    buildId,
    runName: requireNonEmptyString(value, "runName"),
    repetition: requirePositiveInteger(value, "repetition"),
    artifactRoot: requireNonEmptyString(value, "artifactRoot"),
    buildRoot: requireNonEmptyString(value, "buildRoot"),
    referenceCorpusPath: requireNonEmptyString(value, "referenceCorpusPath"),
    agentIds,
    agentStages,
    stageCount,
    rekeyCount: requireNonNegativeInteger(value, "rekeyCount"),
    tokenBudgetPerAgent: requirePositiveInteger(value, "tokenBudgetPerAgent"),
    wallTimeMs: requirePositiveInteger(value, "wallTimeMs"),
    stageIntervalMs: requirePositiveInteger(value, "stageIntervalMs"),
  };
}

function validateAgentRuntimes(value: unknown, agentIds: readonly AgentId[]): AgentRuntimeMap {
  if (!isRecord(value) || !sameKeys(value, agentIds)) {
    throw new Error("Agent runtime bindings must match agentIds exactly.");
  }
  return Object.fromEntries(
    agentIds.map((agentId) => {
      const runtime = value[agentId];
      if (!isRecord(runtime)) {
        throw new Error(`Agent runtime binding for ${agentId} must be an object.`);
      }
      const adapter = runtime.adapter;
      if (!isModelAdapter(adapter)) {
        throw new Error(`Agent runtime binding for ${agentId} must provide an adapter.`);
      }
      return [
        agentId,
        {
          model: decodeModelBinding(runtime.model, `Agent runtime binding for ${agentId} model`),
          adapter,
        },
      ] as const;
    }),
  ) as Record<AgentId, AgentRuntimeBinding>;
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
    stageCount: options.config.stageCount,
    signal: options.signal,
    reveal: (ordinal) => publishStage(options, ordinal),
  });
}

async function publishStage(
  options: Omit<Parameters<typeof publishStages>[0], "startedAt" | "clock" | "signal">,
  ordinal: number,
): Promise<void> {
  await Promise.all(
    options.config.agentIds.map(async (agentId) => {
      const source = options.config.agentStages[agentId]?.[ordinal - 1];
      const evidencePath = options.evidencePaths[agentId];
      const released = options.releasedStages[agentId];
      if (source === undefined || evidencePath === undefined || released === undefined) {
        throw new Error(`Missing ${agentId} stage ${String(ordinal)}.`);
      }
      const destination = join(
        evidencePath,
        `stage-${String(ordinal).padStart(2, "0")}-${basename(source)}`,
      );
      await cp(source, destination, { errorOnExist: true, force: false });
      released.add(ordinal);
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
  agentIds: readonly AgentId[];
  evidencePaths: Record<AgentId, string>;
  referenceCorpusPath: string;
  clock: MonotonicClock;
  cutoffAt: number;
  signal: AbortSignal;
}): Promise<Record<AgentId, AgentSandboxLease>> {
  const settled = await Promise.allSettled(
    options.agentIds.map(async (agentId) => {
      const workspace = options.git.workspaces.find((candidate) => candidate.agentId === agentId);
      const evidencePath = options.evidencePaths[agentId];
      if (workspace === undefined || evidencePath === undefined) {
        throw new Error(`Sandbox resources are missing for ${agentId}.`);
      }
      const remainingMs = Math.ceil(options.cutoffAt - options.clock.nowMs());
      if (remainingMs <= 0 || options.signal.aborted) {
        throw new SandboxInfrastructureError(
          "Attempt wall-time cutoff expired during agent sandbox setup.",
        );
      }
      const lease = await options.sandbox.openAgentLease({
        profile: "agent",
        workspacePath: workspace.path,
        evidencePath,
        referenceCorpusPath: options.referenceCorpusPath,
        sharedGitPath: options.git.barePath,
        timeoutMs: Math.min(30_000, remainingMs),
        signal: options.signal,
      });
      return [agentId, lease] as const;
    }),
  );
  const opened = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const failed = settled.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    const closeResults = await Promise.allSettled(opened.map(([, lease]) => lease.close()));
    const closeFailures = closeResults.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    const failure = options.signal.aborted
      ? new SandboxInfrastructureError(
          "Attempt wall-time cutoff expired during agent sandbox setup.",
        )
      : failed.reason;
    if (closeFailures.length > 0) {
      throw new AggregateError(
        [failure, ...closeFailures],
        "Agent sandbox setup failed and partial lease cleanup reported errors.",
      );
    }
    throw failure;
  }
  return Object.fromEntries(opened) as Record<AgentId, AgentSandboxLease>;
}

export async function runAttempt(options: RunAttemptOptions): Promise<AttemptResult> {
  const config = validateAttemptConfig(options.config);
  const agents = validateAgentRuntimes(options.agents, config.agentIds);
  await mkdir(config.artifactRoot, { recursive: false });
  const git = await createGitEnvironment(join(config.artifactRoot, "git"), config.agentIds);
  const evidencePaths = Object.fromEntries(
    await Promise.all(
      config.agentIds.map(async (agentId) => {
        const path = join(config.artifactRoot, "private-evidence", agentId);
        await mkdir(path, { recursive: true });
        return [agentId, path] as const;
      }),
    ),
  ) as Record<AgentId, string>;

  const startedAt = options.clock.nowMs();
  const cutoffAt = startedAt + config.wallTimeMs;
  const tracePath = join(config.artifactRoot, "trace.jsonl");
  const observationLog = await JsonlObservationLog.create(tracePath, {
    nowMs: () => options.clock.nowMs() - startedAt,
  });
  await observationLog.append("attempt.configured", {
    attemptId: config.attemptId,
    buildId: config.buildId,
    runName: config.runName,
    repetition: config.repetition,
    tokenBudgetPerAgent: config.tokenBudgetPerAgent,
    wallTimeMs: config.wallTimeMs,
    stageIntervalMs: config.stageIntervalMs,
    agentCount: config.agentIds.length,
    stageCount: config.stageCount,
    rekeyCount: config.rekeyCount,
    models: config.agentIds.map((agentId) => ({
      agentId,
      ...agents[agentId]!.model,
    })),
  });

  const globalController = new AbortController();
  const scheduleController = new AbortController();
  const wallController = new AbortController();
  const stopScheduleAtWallTime = () => scheduleController.abort();
  globalController.signal.addEventListener("abort", stopScheduleAtWallTime, { once: true });
  const wallTime = options.clock.waitUntil(cutoffAt, wallController.signal).then((reached) => {
    if (reached) globalController.abort("time-exhausted");
  });
  void wallTime.catch(() => globalController.abort("wall-timer-failed"));

  const activity = new ActivityBus(() => options.clock.nowMs() - startedAt);
  const monitor = new GitActivityMonitor({
    barePath: git.barePath,
    activity,
    pollIntervalMs: options.gitPollIntervalMs ?? 20,
    onChange: async (refs) => {
      await observationLog.append("git.changed", { refs });
    },
  });

  let monitorStarted = false;
  let sandboxLeases: Record<AgentId, AgentSandboxLease> | undefined;
  let stagePublishing: Promise<void> | undefined;
  let sessionPromises: readonly Promise<AgentSessionResult>[] | undefined;
  let sessions: readonly AgentSessionResult[] | undefined;
  let primaryFailure: { error: unknown } | undefined;

  try {
    await monitor.start();
    monitorStarted = true;

    const releasedStages = Object.fromEntries(
      config.agentIds.map((agentId) => [agentId, new Set<number>()]),
    ) as Record<AgentId, Set<number>>;
    await publishStage({ config, evidencePaths, releasedStages, activity, observationLog }, 1);
    const cursors = Object.fromEntries(
      config.agentIds.map((agentId) => [agentId, activity.latestSequence]),
    ) as Record<AgentId, number>;
    const openedLeases = await openAgentLeases({
      sandbox: options.sandbox,
      git,
      agentIds: config.agentIds,
      evidencePaths,
      referenceCorpusPath: config.referenceCorpusPath,
      clock: options.clock,
      cutoffAt,
      signal: globalController.signal,
    });
    sandboxLeases = openedLeases;

    if (globalController.signal.aborted) {
      throw new SandboxInfrastructureError(
        "Attempt wall-time cutoff expired during agent sandbox setup.",
      );
    }
    stagePublishing = publishStages({
      config,
      evidencePaths,
      releasedStages,
      activity,
      observationLog,
      startedAt,
      clock: options.clock,
      signal: scheduleController.signal,
    });
    void stagePublishing.catch(() => {});

    sessionPromises = config.agentIds.map((agentId) => {
      const workspace = git.workspaces.find((candidate) => candidate.agentId === agentId);
      const released = releasedStages[agentId];
      const runtime = agents[agentId];
      const lease = openedLeases[agentId];
      if (
        workspace === undefined ||
        released === undefined ||
        runtime === undefined ||
        lease === undefined
      ) {
        throw new Error(`Runtime resources are missing for ${agentId}.`);
      }
      const tools = createAgentTools({
        agentId,
        workspacePath: workspace.path,
        sandbox: lease,
        activity,
        checker: options.checker,
        getReleasedStages: () => [...released].sort((left, right) => left - right),
        getActivityCursor: () => cursors[agentId]!,
        setActivityCursor: (sequence) => {
          cursors[agentId] = sequence;
        },
      });
      return runAgentSession({
        agentId,
        model: runtime.model,
        prompt: buildAgentPrompt({ agentId, agentCount: config.agentIds.length }),
        adapter: runtime.adapter,
        tools,
        tokenBudget: config.tokenBudgetPerAgent,
        signal: globalController.signal,
        getActivityCursor: () => cursors[agentId]!,
        observe: async (kind, data, observedAgentId) => {
          await observationLog.append(kind, data, observedAgentId);
        },
      });
    });
    sessions = await Promise.all(sessionPromises);
  } catch (error) {
    primaryFailure = { error };
    globalController.abort("attempt-failed");
  }

  wallController.abort("sessions-ended");
  scheduleController.abort("sessions-ended");
  globalController.signal.removeEventListener("abort", stopScheduleAtWallTime);

  const quiesceTasks: Promise<unknown>[] = [wallTime];
  if (stagePublishing !== undefined) quiesceTasks.push(stagePublishing);
  if (sessionPromises !== undefined) quiesceTasks.push(...sessionPromises);
  const quiesceResults = await Promise.allSettled(quiesceTasks);
  activity.end(
    globalController.signal.reason === "time-exhausted" ? "time-exhausted" : "sessions-ended",
  );

  const releaseTasks: Promise<unknown>[] = [];
  if (monitorStarted) releaseTasks.push(Promise.resolve().then(() => monitor.stop()));
  if (sandboxLeases !== undefined) {
    const leasesToClose = sandboxLeases;
    releaseTasks.push(
      ...config.agentIds.map((agentId) => {
        const lease = leasesToClose[agentId];
        if (lease === undefined) {
          return Promise.reject(new Error(`Sandbox lease is missing for ${agentId}.`));
        }
        return Promise.resolve().then(() => lease.close());
      }),
    );
  }
  const releaseResults = await Promise.allSettled(releaseTasks);
  const cleanupFailures = [...quiesceResults, ...releaseResults].flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  const distinctCleanupFailures = cleanupFailures.filter(
    (error, index) => error !== primaryFailure?.error && cleanupFailures.indexOf(error) === index,
  );
  if (primaryFailure !== undefined) {
    if (distinctCleanupFailures.length > 0) {
      throw new AggregateError(
        [primaryFailure.error, ...distinctCleanupFailures],
        "Attempt execution failed and lifecycle cleanup reported additional errors.",
      );
    }
    throw primaryFailure.error;
  }
  if (distinctCleanupFailures.length === 1) throw distinctCleanupFailures[0];
  if (distinctCleanupFailures.length > 1) {
    throw new AggregateError(
      distinctCleanupFailures,
      "Attempt lifecycle cleanup reported multiple errors.",
    );
  }
  if (sessions === undefined) {
    throw new Error("Attempt sessions did not produce a result.");
  }

  await observationLog.append("attempt.sessions-ended", {
    sessions: sessions.map((session) => ({
      agentId: session.agentId,
      model: session.model,
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
    buildId: config.buildId,
    runName: config.runName,
    repetition: config.repetition,
    buildRoot: config.buildRoot,
    agentIds: config.agentIds,
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
  runName: string;
  repetition: number;
  agents: AgentRuntimeMap;
  tokenBudgetPerAgent: number;
  wallTimeMs: number;
  sandbox?: CommandSandbox;
  clock?: MonotonicClock;
}

export interface RunPuzzleResult extends AttemptResult {
  attemptRoot: string;
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
    schemaVersion: 2,
    attemptId: options.result.attemptId,
    buildId: options.result.buildId,
    buildRoot: options.buildRoot,
    agentIds: options.result.agentIds,
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

export function createFixtureAgentRuntimes(
  agentIds: readonly AgentId[],
  scenario?: string,
): AgentRuntimeMap {
  const adapter = createFixtureModelAdapter(scenario);
  return Object.fromEntries(
    agentIds.map((agentId) => [
      agentId,
      {
        model: {
          profile: "offline-fixture",
          provider: "fixture",
          driver: "openai-compatible",
          requestedModel: scenario ?? "collaborative-revision",
          settings: {},
          providerOptions: {},
        },
        adapter,
      },
    ]),
  ) as Record<AgentId, AgentRuntimeBinding>;
}

export async function runPuzzle(options: RunPuzzleOptions): Promise<RunPuzzleResult> {
  const root = resolve(options.root);
  const buildRoot = resolve(options.buildRoot);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  const manifest = decodeBuildManifest(await readJsonObject(join(buildRoot, "puzzle-build.json")));
  const agentStages = Object.fromEntries(
    manifest.agentIds.map((agentId) => [
      agentId,
      manifest.stages
        .filter((stage) => stage.agentId === agentId)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((stage) => absoluteFrom(buildRoot, stage.sourcePath)),
    ]),
  ) as Record<AgentId, readonly string[]>;
  const attemptId = `attempt-${options.runName}-${String(options.repetition).padStart(3, "0")}-${manifest.buildId.slice("build-".length, "build-".length + 16)}`;
  const config: AttemptConfig = {
    attemptId,
    buildId: manifest.buildId,
    runName: options.runName,
    repetition: options.repetition,
    artifactRoot: output,
    buildRoot,
    referenceCorpusPath: absoluteFrom(buildRoot, manifest.referenceCorpusPath),
    agentIds: manifest.agentIds,
    agentStages,
    stageCount: manifest.stageCount,
    rekeyCount: manifest.rekeys.length,
    tokenBudgetPerAgent: options.tokenBudgetPerAgent,
    wallTimeMs: options.wallTimeMs,
    stageIntervalMs: manifest.stageIntervalMs,
  };
  const sandbox = options.sandbox ?? (await createDockerCommandSandbox({ root }));
  const result = await runAttempt({
    config,
    agents: options.agents,
    checker: createChecker(root, buildRoot),
    sandbox,
    clock: options.clock ?? systemMonotonicClock,
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
  return { ...result, attemptRoot: output, overlap };
}
