import { renameSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { AttemptRuntime } from "./attempt-runtime.js";
import {
  ATTEMPT_CUTOFF_MS,
  hashProtocolSnapshot,
  RELEASE_OFFSETS_MS,
  resolveCondition,
  type ConditionId,
} from "./condition.js";
import {
  decodeAttemptSummary,
  decodeBuildManifest,
  decodeModelBinding,
  publishAttemptSummary,
  selectBuildVariant,
  type AttemptProtocolSnapshot,
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
import {
  assertPreflightSandbox,
  publishPreflightReceipt,
  readCurrentPreflight,
  type PreflightReceipt,
} from "./preflight.js";
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
import { sealTree, verifyTree, type TreeSeal } from "./seal.js";
import { runAgentSession, type AgentSessionResult } from "./session.js";
import { createAgentTools, type CheckerHook } from "./tools.js";
import { JsonlObservationLog } from "./trace.js";
import type { TeamChannelMode } from "./team-channel.js";

const BUILD_ID = /^build-[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export type AttemptStudyPhase = "standalone" | "calibration" | "validation";

export interface AttemptConfig {
  attemptId: string;
  studyPhase: AttemptStudyPhase;
  studyRootId?: string;
  conditionOrderPosition?: number;
  designDigest?: string;
  monetaryAuthorizationCeilingCents: number;
  replacementOfAttemptId?: string;
  blockId: string;
  condition: ConditionId;
  buildId: string;
  artifactRoot: string;
  buildRoot: string;
  referenceCorpusPath: string;
  agentIds: readonly AgentId[];
  agentStages: Readonly<Record<AgentId, readonly string[]>>;
  releaseOffsetsMs: readonly number[];
  cutoffMs: number;
  tokenBudgetPerAgent: number;
  teamChannel: TeamChannelMode;
}

export interface AgentRuntimeBinding {
  model: ModelBinding;
  adapter: ModelAdapter;
}

export type AgentRuntimeMap = Readonly<Record<AgentId, AgentRuntimeBinding>>;

export interface AttemptResult {
  attemptId: string;
  studyPhase: AttemptStudyPhase;
  studyRootId?: string;
  conditionOrderPosition?: number;
  designDigest?: string;
  monetaryAuthorizationCeilingCents: number;
  replacementOfAttemptId?: string;
  blockId: string;
  condition: ConditionId;
  communicationMode: ReturnType<typeof resolveCondition>["communicationMode"];
  keyRegime: ReturnType<typeof resolveCondition>["keyRegime"];
  variantId: ReturnType<typeof resolveCondition>["variantId"];
  buildId: string;
  buildRoot: string;
  agentIds: readonly AgentId[];
  releaseOffsetsMs: readonly number[];
  cutoffMs: number;
  tokenBudgetPerAgent: number;
  protocolDigest: string;
  protocol: AttemptProtocolSnapshot;
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
  preflight?: PreflightReceipt;
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
    agentIdsValue.length !== 3 ||
    agentIdsValue.some((agentId) => !isAgentId(agentId))
  ) {
    throw new Error("agentIds must contain exactly three canonical agent IDs.");
  }
  const agentIds = [...agentIdsValue] as AgentId[];
  const expectedAgentIds = generateAgentIds(3);
  if (agentIds.some((agentId, index) => agentId !== expectedAgentIds[index])) {
    throw new Error("agentIds must be ordered canonically from agent-1 through agent-N.");
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
        stages.length !== RELEASE_OFFSETS_MS.length ||
        stages.some((stage) => typeof stage !== "string" || stage.length === 0)
      ) {
        throw new Error(
          `${agentId} must have exactly ${String(RELEASE_OFFSETS_MS.length)} stages.`,
        );
      }
      return [agentId, [...stages] as string[]] as const;
    }),
  ) as Record<AgentId, readonly string[]>;

  const buildId = requireNonEmptyString(value, "buildId");
  if (!BUILD_ID.test(buildId)) {
    throw new Error("buildId must be a build-prefixed SHA-256 digest.");
  }
  const condition = resolveCondition(value.condition);
  const teamChannel = value.teamChannel;
  if (teamChannel !== "enabled" && teamChannel !== "disabled") {
    throw new Error("teamChannel must be enabled or disabled.");
  }
  const releaseOffsetsMs = value.releaseOffsetsMs;
  if (
    !Array.isArray(releaseOffsetsMs) ||
    releaseOffsetsMs.length !== RELEASE_OFFSETS_MS.length ||
    releaseOffsetsMs.some((offset, index) => offset !== RELEASE_OFFSETS_MS[index])
  ) {
    throw new Error("releaseOffsetsMs must match the fixed six-stage release schedule.");
  }
  const cutoffMs = requirePositiveInteger(value, "cutoffMs");
  if (cutoffMs !== ATTEMPT_CUTOFF_MS) {
    throw new Error("cutoffMs must match the fixed 60-minute attempt cutoff.");
  }
  const studyPhase = value.studyPhase;
  if (studyPhase !== "standalone" && studyPhase !== "calibration" && studyPhase !== "validation") {
    throw new Error("studyPhase must be standalone, calibration, or validation.");
  }
  const optionalStudyFields = [value.studyRootId, value.conditionOrderPosition, value.designDigest];
  if (studyPhase === "standalone" && optionalStudyFields.some((field) => field !== undefined)) {
    throw new Error("Standalone attempts cannot carry study receipt provenance.");
  }
  if (studyPhase === "standalone" && value.replacementOfAttemptId !== undefined) {
    throw new Error("Standalone attempts cannot replace study attempts.");
  }
  let studyRootId: string | undefined;
  let conditionOrderPosition: number | undefined;
  let designDigest: string | undefined;
  if (studyPhase !== "standalone") {
    studyRootId = requireNonEmptyString(value, "studyRootId");
    conditionOrderPosition = requirePositiveInteger(value, "conditionOrderPosition");
    if (conditionOrderPosition > 4) {
      throw new Error("conditionOrderPosition must be between 1 and 4.");
    }
    designDigest = requireNonEmptyString(value, "designDigest");
    if (!SHA256.test(designDigest)) {
      throw new Error("designDigest must be a lowercase SHA-256 digest.");
    }
  }
  const replacementOfAttemptId =
    value.replacementOfAttemptId === undefined
      ? undefined
      : requireNonEmptyString(value, "replacementOfAttemptId");
  return {
    attemptId: requireNonEmptyString(value, "attemptId"),
    studyPhase,
    ...(studyRootId === undefined ? {} : { studyRootId }),
    ...(conditionOrderPosition === undefined ? {} : { conditionOrderPosition }),
    ...(designDigest === undefined ? {} : { designDigest }),
    monetaryAuthorizationCeilingCents: requireNonNegativeInteger(
      value,
      "monetaryAuthorizationCeilingCents",
    ),
    ...(replacementOfAttemptId === undefined ? {} : { replacementOfAttemptId }),
    blockId: requireNonEmptyString(value, "blockId"),
    condition: condition.id,
    buildId,
    artifactRoot: requireNonEmptyString(value, "artifactRoot"),
    buildRoot: requireNonEmptyString(value, "buildRoot"),
    referenceCorpusPath: requireNonEmptyString(value, "referenceCorpusPath"),
    agentIds,
    agentStages,
    releaseOffsetsMs: [...RELEASE_OFFSETS_MS],
    cutoffMs,
    tokenBudgetPerAgent: requirePositiveInteger(value, "tokenBudgetPerAgent"),
    teamChannel,
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
  releaseStagingRoot: string;
  runtime: AttemptRuntime;
  startedAt: number;
  clock: MonotonicClock;
  signal: AbortSignal;
}): Promise<void> {
  await runRevealSchedule({
    clock: options.clock,
    startedAtMs: options.startedAt,
    releaseOffsetsMs: options.config.releaseOffsetsMs,
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

export async function runAttempt(options: RunAttemptOptions): Promise<AttemptResult> {
  const config = validateAttemptConfig(options.config);
  const condition = resolveCondition(config.condition);
  const agents = validateAgentRuntimes(options.agents, config.agentIds);
  await mkdir(config.artifactRoot, { recursive: false });
  if (options.preflight) {
    await publishPreflightReceipt(join(config.artifactRoot, "preflight.json"), options.preflight);
  }
  const git = await createGitEnvironment(
    join(config.artifactRoot, "git"),
    condition.communicationMode,
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
  const cutoffAt = startedAt + config.cutoffMs;
  const tracePath = join(config.artifactRoot, "trace.jsonl");
  const observationLog = await JsonlObservationLog.create(tracePath, {
    nowMs: () => options.clock.nowMs() - startedAt,
  });
  const prompts = Object.fromEntries(
    config.agentIds.map((agentId) => [
      agentId,
      buildAgentPrompt({
        agentId,
        condition: config.condition,
        tokenBudgetPerAgent: config.tokenBudgetPerAgent,
        teamChannel: config.teamChannel,
      }),
    ]),
  ) as Record<AgentId, string>;
  const protocol: AttemptProtocolSnapshot = {
    schemaVersion: 2,
    blockId: config.blockId,
    condition: condition.id,
    communicationMode: condition.communicationMode,
    keyRegime: condition.keyRegime,
    variantId: condition.variantId,
    buildId: config.buildId,
    releaseOffsetsMs: [...config.releaseOffsetsMs],
    cutoffMs: config.cutoffMs,
    tokenBudgetPerAgent: config.tokenBudgetPerAgent,
    teamChannel: config.teamChannel,
    models: config.agentIds.map((agentId) => ({
      agentId,
      model: agents[agentId]!.model,
    })),
    prompts: config.agentIds.map((agentId) => ({
      agentId,
      prompt: prompts[agentId]!,
    })),
    sandbox: { ...options.sandbox.identity, ...SANDBOX_POLICY },
  };
  const protocolDigest = hashProtocolSnapshot(protocol);
  await observationLog.append("attempt.configured", {
    attemptId: config.attemptId,
    studyPhase: config.studyPhase,
    ...(config.studyRootId === undefined ? {} : { studyRootId: config.studyRootId }),
    ...(config.conditionOrderPosition === undefined
      ? {}
      : { conditionOrderPosition: config.conditionOrderPosition }),
    ...(config.designDigest === undefined ? {} : { designDigest: config.designDigest }),
    monetaryAuthorizationCeilingCents: config.monetaryAuthorizationCeilingCents,
    ...(config.replacementOfAttemptId === undefined
      ? {}
      : { replacementOfAttemptId: config.replacementOfAttemptId }),
    blockId: config.blockId,
    condition: condition.id,
    communicationMode: condition.communicationMode,
    keyRegime: condition.keyRegime,
    variantId: condition.variantId,
    buildId: config.buildId,
    releaseOffsetsMs: config.releaseOffsetsMs,
    cutoffMs: config.cutoffMs,
    tokenBudgetPerAgent: config.tokenBudgetPerAgent,
    teamChannel: config.teamChannel,
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
      config.teamChannel === "enabled" && condition.communicationMode === "shared",
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

    await publishStage({ config, evidencePaths, releaseStagingRoot, runtime: attemptRuntime }, 1);
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
    communicationMode: frozen.communicationMode,
    repositories: frozen.repositories,
    workspaces: frozen.workspaces,
  });
  await observationLog.flush();
  return {
    attemptId: config.attemptId,
    studyPhase: config.studyPhase,
    ...(config.studyRootId === undefined ? {} : { studyRootId: config.studyRootId }),
    ...(config.conditionOrderPosition === undefined
      ? {}
      : { conditionOrderPosition: config.conditionOrderPosition }),
    ...(config.designDigest === undefined ? {} : { designDigest: config.designDigest }),
    monetaryAuthorizationCeilingCents: config.monetaryAuthorizationCeilingCents,
    ...(config.replacementOfAttemptId === undefined
      ? {}
      : { replacementOfAttemptId: config.replacementOfAttemptId }),
    blockId: config.blockId,
    condition: condition.id,
    communicationMode: condition.communicationMode,
    keyRegime: condition.keyRegime,
    variantId: condition.variantId,
    buildId: config.buildId,
    buildRoot: config.buildRoot,
    agentIds: config.agentIds,
    releaseOffsetsMs: config.releaseOffsetsMs,
    cutoffMs: config.cutoffMs,
    tokenBudgetPerAgent: config.tokenBudgetPerAgent,
    protocolDigest,
    protocol,
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
  attemptId?: string;
  studyPhase: AttemptStudyPhase;
  studyRootId?: string;
  conditionOrderPosition?: number;
  designDigest?: string;
  monetaryAuthorizationCeilingCents: number;
  replacementOfAttemptId?: string;
  condition: ConditionId;
  agents: AgentRuntimeMap;
  tokenBudgetPerAgent: number;
  teamChannel: TeamChannelMode;
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
  buildTreeSeal: TreeSeal;
  result: AttemptResult;
  publishSummary: (attemptRoot: string, summary: AttemptSummary) => Promise<void>;
  observeOverlap: () => Promise<OverlapResult>;
  appendTrace: (tracePath: string, kind: string, data: unknown) => Promise<void>;
}

export async function finalizeAttempt(options: FinalizeAttemptOptions): Promise<OverlapResult> {
  const infrastructureClassification = options.result.sessions.some(
    (session) => session.state === "infrastructure-error",
  )
    ? "session-infrastructure-error"
    : "none";
  const summary = decodeAttemptSummary({
    schemaVersion: 4,
    attemptId: options.result.attemptId,
    studyPhase: options.result.studyPhase,
    ...(options.result.studyRootId === undefined
      ? {}
      : { studyRootId: options.result.studyRootId }),
    ...(options.result.conditionOrderPosition === undefined
      ? {}
      : { conditionOrderPosition: options.result.conditionOrderPosition }),
    ...(options.result.designDigest === undefined
      ? {}
      : { designDigest: options.result.designDigest }),
    monetaryAuthorizationCeilingCents: options.result.monetaryAuthorizationCeilingCents,
    infrastructureClassification,
    ...(options.result.replacementOfAttemptId === undefined
      ? {}
      : { replacementOfAttemptId: options.result.replacementOfAttemptId }),
    blockId: options.result.blockId,
    condition: options.result.condition,
    communicationMode: options.result.communicationMode,
    keyRegime: options.result.keyRegime,
    variantId: options.result.variantId,
    buildId: options.result.buildId,
    buildRoot: options.buildRoot,
    buildTreeSeal: options.buildTreeSeal,
    agentIds: options.result.agentIds,
    releaseOffsetsMs: options.result.releaseOffsetsMs,
    cutoffMs: options.result.cutoffMs,
    tokenBudgetPerAgent: options.result.tokenBudgetPerAgent,
    protocolDigest: options.result.protocolDigest,
    protocol: options.result.protocol,
    tracePath: options.result.tracePath,
    traceMetadataPath: options.result.traceMetadataPath,
    frozen: {
      root: options.result.frozen.root,
      communicationMode: options.result.frozen.communicationMode,
      repositories: options.result.frozen.repositories,
      workspaces: options.result.frozen.workspaces,
      treeSeal: options.result.frozen.treeSeal,
    },
    sandbox: { ...options.result.sandbox, ...SANDBOX_POLICY },
    sessions: options.result.sessions,
  });
  await verifyTree(options.buildRoot, options.buildTreeSeal, "Attempt build tree");
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
  const usesProvider = Object.values(options.agents).some(
    (runtime) => runtime.model.provider !== "fixture",
  );
  const preflight = usesProvider ? await readCurrentPreflight(root) : undefined;
  await mkdir(dirname(output), { recursive: true });
  const manifest = decodeBuildManifest(await readJsonObject(join(buildRoot, "puzzle-build.json")));
  const buildTreeSeal = await sealTree(buildRoot);
  const condition = resolveCondition(options.condition);
  const variant = selectBuildVariant(manifest, condition.variantId);
  const agentStages = Object.fromEntries(
    manifest.agentIds.map((agentId) => [
      agentId,
      variant.stages
        .filter((stage) => stage.agentId === agentId)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((stage) => absoluteFrom(buildRoot, stage.sourcePath)),
    ]),
  ) as Record<AgentId, readonly string[]>;
  const attemptId =
    options.attemptId ??
    `attempt-standalone-${condition.id.toLowerCase()}-${variant.buildId.slice("build-".length, "build-".length + 16)}`;
  const config: AttemptConfig = {
    attemptId,
    studyPhase: options.studyPhase,
    ...(options.studyRootId === undefined ? {} : { studyRootId: options.studyRootId }),
    ...(options.conditionOrderPosition === undefined
      ? {}
      : { conditionOrderPosition: options.conditionOrderPosition }),
    ...(options.designDigest === undefined ? {} : { designDigest: options.designDigest }),
    monetaryAuthorizationCeilingCents: options.monetaryAuthorizationCeilingCents,
    ...(options.replacementOfAttemptId === undefined
      ? {}
      : { replacementOfAttemptId: options.replacementOfAttemptId }),
    blockId: manifest.blockId,
    condition: condition.id,
    buildId: variant.buildId,
    artifactRoot: output,
    buildRoot,
    referenceCorpusPath: absoluteFrom(buildRoot, variant.referenceCorpusPath),
    agentIds: manifest.agentIds,
    agentStages,
    releaseOffsetsMs: RELEASE_OFFSETS_MS,
    cutoffMs: ATTEMPT_CUTOFF_MS,
    tokenBudgetPerAgent: options.tokenBudgetPerAgent,
    teamChannel: options.teamChannel,
  };
  const sandbox = options.sandbox ?? (await createDockerCommandSandbox({ root }));
  if (preflight) assertPreflightSandbox(preflight, sandbox.identity);
  const result = await runAttempt({
    config,
    agents: options.agents,
    checker: createChecker(root, buildRoot),
    sandbox,
    clock: options.clock ?? systemMonotonicClock,
    ...(preflight === undefined ? {} : { preflight }),
  });
  const overlap = await finalizeAttempt({
    attemptRoot: output,
    buildRoot,
    buildTreeSeal,
    result,
    publishSummary: publishAttemptSummary,
    observeOverlap: () => observeOverlap(root, buildRoot, result),
    appendTrace: appendTraceEvent,
  });
  decodeAttemptSummary(await readJsonObject(join(output, "attempt.json")));
  return { ...result, attemptRoot: output, overlap };
}
