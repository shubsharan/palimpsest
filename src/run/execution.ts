import { renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { AttemptRuntime } from "./runtime.js";
import type { ResolvedRun } from "../experiment/contracts.js";
import { validateRunSchedule } from "../experiment/manifest.js";
import { createChecker } from "../evaluation/checker.js";
import { createFixtureModelAdapter } from "../fixture/smoke-model.js";
import {
  createGitEnvironment,
  freezeGitEnvironment,
  GitActivityMonitor,
  type FrozenGitEnvironment,
  type GitEnvironment,
} from "../git.js";
import { loadFixturePackage, selectFixtureVariant } from "../fixture/package.js";
import {
  isAgentId,
  type AgentSessionResult,
  type AgentId,
  type JsonObject,
  type ModelAdapter,
  type ModelBinding,
} from "../model/contracts.js";
import { buildAgentPrompt } from "./prompt.js";
import { absoluteFrom } from "../python.js";
import { runRevealSchedule, systemMonotonicClock, type MonotonicClock } from "./releases.js";
import { createDockerCommandSandbox } from "../sandbox/container.js";
import {
  SandboxInfrastructureError,
  type AgentSandboxLease,
  type CommandSandbox,
  type SandboxIdentity,
} from "../sandbox/contracts.js";
import { runAgentSession } from "./session.js";
import { createAgentTools, type CheckerHook } from "./tools.js";
import { JsonlObservationLog } from "../trace.js";

const BUILD_ID = /^build-[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;

async function throwWithInfrastructureEvent(
  observationLog: JsonlObservationLog,
  component: string,
  error: unknown,
): Promise<never> {
  const detail = error instanceof Error ? error.message : String(error);
  try {
    await observationLog.append("infrastructure.error", { component, error: detail });
    await observationLog.flush();
  } catch (traceError) {
    throw new AggregateError(
      [error, traceError],
      `Run ${component} failed and the infrastructure event could not be flushed.`,
    );
  }
  throw error;
}

export interface RunExecutionConfig extends Pick<
  ResolvedRun,
  "capabilities" | "labels" | "limits" | "schedule"
> {
  runId: string;
  experimentId: string;
  fixtureId: string;
  fixtureDigest: string;
  variantId: string;
  buildId: string;
  artifactRoot: string;
  buildRoot: string;
  referenceCorpusPath: string;
  agentIds: readonly AgentId[];
  agentStages: Readonly<Record<AgentId, readonly string[]>>;
}

export interface AgentRuntimeBinding {
  model: ModelBinding;
  adapter: ModelAdapter;
}

export type AgentRuntimeMap = Readonly<Record<AgentId, AgentRuntimeBinding>>;

export interface RunExecutionResult {
  startedAt: string;
  frozenAt: string;
  releases: readonly RunReleaseObservation[];
  sessions: readonly AgentSessionResult[];
  frozen: FrozenGitEnvironment;
  tracePath: string;
  traceMetadataPath: string;
  sandbox: SandboxIdentity;
}

export interface RunReleaseObservation {
  agentId: AgentId;
  ordinal: number;
  variantId: string;
  releasedAt: string;
  visiblePath: string;
  sha256: string;
}

export interface ExecuteRunOptions {
  config: RunExecutionConfig;
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

export function validateRunExecutionConfig(value: unknown): RunExecutionConfig {
  if (!isRecord(value)) {
    throw new Error("Run execution configuration must be an object.");
  }
  const agentIdsValue = value.agentIds;
  if (
    !Array.isArray(agentIdsValue) ||
    agentIdsValue.length === 0 ||
    agentIdsValue.some((agentId) => !isAgentId(agentId))
  ) {
    throw new Error("agentIds must contain canonical agent IDs.");
  }
  const agentIds = [...agentIdsValue] as AgentId[];
  if (new Set(agentIds).size !== agentIds.length) {
    throw new Error("agentIds must be unique.");
  }

  const stagesValue = value.agentStages;
  if (!isRecord(stagesValue) || !sameKeys(stagesValue, agentIds)) {
    throw new Error("agentStages must match agentIds exactly.");
  }
  const agentStages = Object.fromEntries(
    agentIds.map((agentId) => {
      const stages = stagesValue[agentId];
      if (
        !Array.isArray(stages) ||
        stages.length === 0 ||
        stages.some((stage) => typeof stage !== "string" || stage.length === 0)
      ) {
        throw new Error(`${agentId} must have one or more stage files.`);
      }
      return [agentId, [...stages] as string[]] as const;
    }),
  ) as Record<AgentId, readonly string[]>;

  const buildId = requireNonEmptyString(value, "buildId");
  if (!BUILD_ID.test(buildId)) {
    throw new Error("buildId must be a build-prefixed SHA-256 digest.");
  }
  const fixtureDigest = requireNonEmptyString(value, "fixtureDigest");
  if (!SHA256.test(fixtureDigest)) {
    throw new Error("fixtureDigest must be a lowercase SHA-256 digest.");
  }
  if (!isRecord(value.capabilities)) throw new Error("capabilities must be an object.");
  const gitVisibility = value.capabilities.git;
  if (gitVisibility !== "shared" && gitVisibility !== "isolated") {
    throw new Error("gitVisibility must be shared or isolated.");
  }
  const teamRoom = value.capabilities.teamRoom;
  if (teamRoom !== "enabled" && teamRoom !== "disabled") {
    throw new Error("teamRoom must be enabled or disabled.");
  }
  if (gitVisibility === "isolated" && teamRoom === "enabled") {
    throw new Error("An isolated run cannot expose a shared team room.");
  }
  if (!isRecord(value.schedule)) throw new Error("schedule must be an object.");
  const releaseOffsetsMs = value.schedule.releaseOffsetsMs;
  if (!Array.isArray(releaseOffsetsMs)) {
    throw new Error("releaseOffsetsMs must be an array.");
  }
  const cutoffMs = requirePositiveInteger(value.schedule, "cutoffMs");
  const stageCount = agentStages[agentIds[0]!]!.length;
  if (agentIds.some((agentId) => agentStages[agentId]!.length !== stageCount)) {
    throw new Error("Every agent must have the same number of ordered stages.");
  }
  validateRunSchedule(
    releaseOffsetsMs as readonly number[],
    cutoffMs,
    stageCount,
    "Run execution configuration",
  );
  if (!isRecord(value.limits)) throw new Error("limits must be an object.");
  const tokenBudgetPerAgent =
    value.limits.tokenLimitPerAgent === null
      ? null
      : requirePositiveInteger(value.limits, "tokenLimitPerAgent");
  if (!isRecord(value.labels)) throw new Error("labels must be a JSON object.");
  return {
    runId: requireNonEmptyString(value, "runId"),
    experimentId: requireNonEmptyString(value, "experimentId"),
    fixtureId: requireNonEmptyString(value, "fixtureId"),
    fixtureDigest,
    variantId: requireNonEmptyString(value, "variantId"),
    buildId,
    artifactRoot: requireNonEmptyString(value, "artifactRoot"),
    buildRoot: requireNonEmptyString(value, "buildRoot"),
    referenceCorpusPath: requireNonEmptyString(value, "referenceCorpusPath"),
    agentIds,
    agentStages,
    schedule: { releaseOffsetsMs: [...(releaseOffsetsMs as number[])], cutoffMs },
    limits: {
      tokenLimitPerAgent: tokenBudgetPerAgent,
      spendCeilingCents: requireNonNegativeInteger(value.limits, "spendCeilingCents"),
    },
    capabilities: { git: gitVisibility, teamRoom },
    labels: value.labels as JsonObject,
  };
}

function validateAgentRuntimes(
  value: AgentRuntimeMap,
  agentIds: readonly AgentId[],
): AgentRuntimeMap {
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
          model: runtime.model,
          adapter,
        },
      ] as const;
    }),
  ) as Record<AgentId, AgentRuntimeBinding>;
}

async function publishStages(options: {
  config: RunExecutionConfig;
  evidencePaths: Record<AgentId, string>;
  releaseStagingRoot: string;
  runtime: AttemptRuntime;
  releases: RunReleaseObservation[];
  startedAt: number;
  clock: MonotonicClock;
  signal: AbortSignal;
}): Promise<void> {
  await runRevealSchedule({
    clock: options.clock,
    startedAtMs: options.startedAt,
    releaseOffsetsMs: options.config.schedule.releaseOffsetsMs,
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
      if (source === undefined || evidencePath === undefined) {
        throw new Error(`Missing ${agentId} stage ${String(ordinal)}.`);
      }
      const destination = join(
        evidencePath,
        `stage-${String(ordinal).padStart(2, "0")}-${basename(source)}`,
      );
      const agentStagingRoot = join(options.releaseStagingRoot, agentId);
      const staged = join(agentStagingRoot, basename(destination));
      const sha256 = createHash("sha256")
        .update(await readFile(source))
        .digest("hex");
      await mkdir(agentStagingRoot, { recursive: true });
      await cp(source, staged, { errorOnExist: true, force: false });
      try {
        await options.runtime.publishReleasedStage(
          agentId,
          {
            ordinal,
            sourcePath: source,
            visiblePath: destination,
          },
          () => renameSync(staged, destination),
        );
        options.releases.push({
          agentId,
          ordinal,
          variantId: options.config.variantId,
          releasedAt: new Date().toISOString(),
          visiblePath: relative(options.config.artifactRoot, destination),
          sha256,
        });
      } finally {
        await rm(staged, { force: true });
      }
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
      const repository = options.git.repositories.find(
        (candidate) => candidate.repositoryId === workspace?.repositoryId,
      );
      const evidencePath = options.evidencePaths[agentId];
      if (workspace === undefined || repository === undefined || evidencePath === undefined) {
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
        gitOriginPath: repository.path,
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

export async function executeRun(options: ExecuteRunOptions): Promise<RunExecutionResult> {
  const config = validateRunExecutionConfig(options.config);
  const agents = validateAgentRuntimes(options.agents, config.agentIds);
  const startedAtTimestamp = new Date().toISOString();
  const releases: RunReleaseObservation[] = [];
  await mkdir(config.artifactRoot, { recursive: false });
  const git = await createGitEnvironment(
    join(config.artifactRoot, "git"),
    config.capabilities.git,
    config.agentIds,
  );
  const evidencePaths = Object.fromEntries(
    await Promise.all(
      config.agentIds.map(async (agentId) => {
        const path = join(config.artifactRoot, "private-evidence", agentId);
        await mkdir(path, { recursive: true });
        return [agentId, path] as const;
      }),
    ),
  ) as Record<AgentId, string>;
  const releaseStagingRoot = join(config.artifactRoot, ".release-staging");
  await mkdir(releaseStagingRoot);

  const startedAt = options.clock.nowMs();
  const cutoffAt = startedAt + config.schedule.cutoffMs;
  const tracePath = join(config.artifactRoot, "trace.jsonl");
  const observationLog = await JsonlObservationLog.create(tracePath, {
    nowMs: () => options.clock.nowMs() - startedAt,
  });
  const prompts = Object.fromEntries(
    config.agentIds.map((agentId) => [
      agentId,
      buildAgentPrompt({
        agentId,
        agentIds: config.agentIds,
        capabilities: config.capabilities,
        schedule: config.schedule,
        limits: config.limits,
      }),
    ]),
  ) as Record<AgentId, string>;
  await observationLog.append("run.configured", {
    runId: config.runId,
    experimentId: config.experimentId,
    fixtureId: config.fixtureId,
    fixtureDigest: config.fixtureDigest,
    spendCeilingCents: config.limits.spendCeilingCents,
    gitVisibility: config.capabilities.git,
    teamRoom: config.capabilities.teamRoom,
    variantId: config.variantId,
    buildId: config.buildId,
    releaseOffsetsMs: config.schedule.releaseOffsetsMs,
    cutoffMs: config.schedule.cutoffMs,
    tokenBudgetPerAgent: config.limits.tokenLimitPerAgent,
    labels: config.labels,
    agentCount: config.agentIds.length,
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

  const attemptRuntime = new AttemptRuntime({
    agentIds: config.agentIds,
    teamChannelEnabled:
      config.capabilities.teamRoom === "enabled" && config.capabilities.git === "shared",
    nowMs: () => options.clock.nowMs() - startedAt,
    observe: async ({ kind, data, agentId }) => {
      await observationLog.append(kind, data, agentId);
    },
    onFatal: () => {
      globalController.abort("attempt-runtime-failed");
    },
  });
  const monitors = git.repositories.map(
    (repository) =>
      new GitActivityMonitor({
        repository,
        pollIntervalMs: options.gitPollIntervalMs ?? 20,
        onChange: (repositoryId, agentIds, refs) =>
          attemptRuntime.recordGitChange(repositoryId, agentIds, refs),
        onError: () => {
          globalController.abort("git-monitor-failed");
        },
      }),
  );

  let startedMonitors: readonly GitActivityMonitor[] = [];
  let sandboxLeases: Record<AgentId, AgentSandboxLease> | undefined;
  let stagePublishing: Promise<void> | undefined;
  let sessionPromises: readonly Promise<AgentSessionResult>[] | undefined;
  let sessions: readonly AgentSessionResult[] | undefined;
  let primaryFailure: { error: unknown } | undefined;

  try {
    for (const monitor of monitors) {
      await monitor.start();
      startedMonitors = [...startedMonitors, monitor];
    }

    await publishStage(
      { config, evidencePaths, releaseStagingRoot, runtime: attemptRuntime, releases },
      1,
    );
    const agentHandles = Object.fromEntries(
      config.agentIds.map((agentId) => [agentId, attemptRuntime.forAgent(agentId)]),
    ) as Record<AgentId, ReturnType<AttemptRuntime["forAgent"]>>;
    const cursors = Object.fromEntries(
      config.agentIds.map((agentId) => [agentId, agentHandles[agentId]!.latestActivitySequence]),
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
      releaseStagingRoot,
      runtime: attemptRuntime,
      releases,
      startedAt,
      clock: options.clock,
      signal: scheduleController.signal,
    });
    void stagePublishing.catch(() => {
      globalController.abort("stage-publication-failed");
    });

    sessionPromises = config.agentIds.map((agentId) => {
      const workspace = git.workspaces.find((candidate) => candidate.agentId === agentId);
      const repository = git.repositories.find(
        (candidate) => candidate.repositoryId === workspace?.repositoryId,
      );
      const evidencePath = evidencePaths[agentId];
      const attempt = agentHandles[agentId];
      const runtime = agents[agentId];
      const lease = openedLeases[agentId];
      if (
        workspace === undefined ||
        repository === undefined ||
        evidencePath === undefined ||
        attempt === undefined ||
        runtime === undefined ||
        lease === undefined
      ) {
        throw new Error(`Runtime resources are missing for ${agentId}.`);
      }
      const tools = createAgentTools({
        agentId,
        sandbox: lease,
        solverSandbox: options.sandbox,
        repositoryPath: repository.path,
        attempt,
        checker: options.checker,
        getActivityCursor: () => cursors[agentId]!,
        setActivityCursor: (sequence) => {
          cursors[agentId] = sequence;
        },
      });
      return runAgentSession({
        agentId,
        model: runtime.model,
        prompt: prompts[agentId]!,
        adapter: runtime.adapter,
        tools,
        tokenBudget: config.limits.tokenLimitPerAgent,
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
  const releaseTasks: Promise<unknown>[] = [];
  releaseTasks.push(rm(releaseStagingRoot, { recursive: true, force: true }));
  releaseTasks.push(
    ...startedMonitors.map((monitor) => Promise.resolve().then(() => monitor.stop())),
  );
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
  const activityEndReason =
    globalController.signal.reason === "time-exhausted" ? "time-exhausted" : "sessions-ended";
  const runtimeCloseResults = await Promise.allSettled([attemptRuntime.close(activityEndReason)]);
  const cleanupFailures = [...quiesceResults, ...releaseResults, ...runtimeCloseResults].flatMap(
    (result) => (result.status === "rejected" ? [result.reason] : []),
  );
  const distinctCleanupFailures = cleanupFailures.filter(
    (error, index) => error !== primaryFailure?.error && cleanupFailures.indexOf(error) === index,
  );
  if (primaryFailure !== undefined) {
    if (distinctCleanupFailures.length > 0) {
      return await throwWithInfrastructureEvent(
        observationLog,
        "lifecycle",
        new AggregateError(
          [primaryFailure.error, ...distinctCleanupFailures],
          "Attempt execution failed and lifecycle cleanup reported additional errors.",
        ),
      );
    }
    return await throwWithInfrastructureEvent(observationLog, "lifecycle", primaryFailure.error);
  }
  if (distinctCleanupFailures.length === 1) {
    return await throwWithInfrastructureEvent(
      observationLog,
      "lifecycle",
      distinctCleanupFailures[0],
    );
  }
  if (distinctCleanupFailures.length > 1) {
    return await throwWithInfrastructureEvent(
      observationLog,
      "lifecycle",
      new AggregateError(
        distinctCleanupFailures,
        "Attempt lifecycle cleanup reported multiple errors.",
      ),
    );
  }
  if (sessions === undefined) {
    return await throwWithInfrastructureEvent(
      observationLog,
      "lifecycle",
      new Error("Attempt sessions did not produce a result."),
    );
  }
  const completedSessions = sessions;

  try {
    await observationLog.append("run.sessions-ended", {
      sessions: completedSessions.map((session) => ({
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
    await observationLog.append("run.frozen", {
      communicationMode: frozen.communicationMode,
      repositories: frozen.repositories,
      workspaces: frozen.workspaces,
    });
    await observationLog.flush();
    const frozenAt = new Date().toISOString();
    return {
      startedAt: startedAtTimestamp,
      frozenAt,
      releases: releases.sort(
        (left, right) =>
          config.agentIds.indexOf(left.agentId) - config.agentIds.indexOf(right.agentId) ||
          left.ordinal - right.ordinal,
      ),
      sessions: completedSessions,
      frozen,
      tracePath,
      traceMetadataPath: observationLog.metadataPath,
      sandbox: options.sandbox.identity,
    };
  } catch (error) {
    return await throwWithInfrastructureEvent(observationLog, "freeze", error);
  }
}

export interface RunPreparedFixtureOptions extends Pick<
  ResolvedRun,
  "capabilities" | "labels" | "limits" | "schedule"
> {
  root: string;
  fixtureRoot: string;
  output: string;
  experimentId: string;
  runId: string;
  variantId: string;
  agents: AgentRuntimeMap;
  sandbox?: CommandSandbox;
  clock?: MonotonicClock;
}

export interface RunPreparedFixtureResult extends RunExecutionResult {
  runRoot: string;
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

export async function runPreparedFixture(
  options: RunPreparedFixtureOptions,
): Promise<RunPreparedFixtureResult> {
  const root = resolve(options.root);
  const fixtureRoot = resolve(options.fixtureRoot);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  const fixture = await loadFixturePackage(fixtureRoot);
  const variant = selectFixtureVariant(fixture, options.variantId);
  const agentStages = Object.fromEntries(
    fixture.agentIds.map((agentId) => [
      agentId,
      variant.stages
        .filter((stage) => stage.agentId === agentId)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((stage) => absoluteFrom(fixtureRoot, stage.sourcePath)),
    ]),
  ) as Record<AgentId, readonly string[]>;
  const config: RunExecutionConfig = {
    runId: options.runId,
    experimentId: options.experimentId,
    fixtureId: fixture.fixtureId,
    fixtureDigest: fixture.contentDigest,
    variantId: variant.variantId,
    buildId: variant.buildId,
    artifactRoot: output,
    buildRoot: fixtureRoot,
    referenceCorpusPath: absoluteFrom(fixtureRoot, variant.referenceCorpusPath),
    agentIds: fixture.agentIds,
    agentStages,
    capabilities: options.capabilities,
    schedule: options.schedule,
    limits: options.limits,
    labels: options.labels,
  };
  const sandbox = options.sandbox ?? (await createDockerCommandSandbox({ root }));
  const result = await executeRun({
    config,
    agents: options.agents,
    checker: createChecker(root, fixtureRoot, variant.variantId),
    sandbox,
    clock: options.clock ?? systemMonotonicClock,
  });
  return { ...result, runRoot: output };
}
