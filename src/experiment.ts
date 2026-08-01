import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  loadResolvedExperiment,
  validateRunAgainstFixture,
  type ModelProfile,
  type ProviderConnection,
  type ResolvedExperiment,
  type ResolvedExperimentRun,
} from "./config.js";
import { evaluateCanonicalOrigins } from "./evaluate.js";
import { requiredFlag } from "./flags.js";
import { loadFixturePackage, type FixturePackage } from "./fixture-package.js";
import type { ModelAdapter, ModelBinding } from "./model.js";
import { createAiSdkModelAdapter, type CreateAiSdkModelAdapterOptions } from "./provider.js";
import { publishRunRecord, type RunRecord } from "./records.js";
import type { MonotonicClock } from "./reveal.js";
import { createFixtureAgentRuntimes, runPreparedFixture, type AgentRuntimeMap } from "./run.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";
import type { CommandSandbox } from "./sandbox/contracts.js";
import { JsonlObservationLog } from "./trace.js";

function bindingFor(
  experiment: ResolvedExperiment,
  profileId: string,
): { profile: ModelProfile; provider: ProviderConnection; binding: ModelBinding } {
  const profile = experiment.models[profileId];
  if (profile === undefined) throw new Error(`Unknown model profile ${profileId}.`);
  const provider = experiment.providers[profile.provider];
  if (provider === undefined) {
    throw new Error(`Model profile ${profileId} references unknown provider ${profile.provider}.`);
  }
  return {
    profile,
    provider,
    binding: {
      profile: profileId,
      provider: profile.provider,
      driver: provider.driver,
      requestedModel: profile.model,
      settings: profile.settings,
      providerOptions: profile.providerOptions,
    },
  };
}

export function createConfiguredAgents(
  experiment: ResolvedExperiment,
  run: ResolvedExperimentRun,
  options: {
    env?: NodeJS.ProcessEnv;
    createAdapter?: (options: CreateAiSdkModelAdapterOptions) => ModelAdapter;
  } = {},
): AgentRuntimeMap {
  const createAdapter = options.createAdapter ?? createAiSdkModelAdapter;
  return Object.fromEntries(
    Object.entries(run.assignment).map(([agentId, profileId]) => {
      const { profile, provider, binding } = bindingFor(experiment, profileId);
      return [
        agentId,
        {
          model: binding,
          adapter: createAdapter({
            providerId: profile.provider,
            provider,
            model: profile.model,
            settings: profile.settings,
            providerOptions: profile.providerOptions,
            ...(options.env === undefined ? {} : { env: options.env }),
          }),
        },
      ];
    }),
  ) as AgentRuntimeMap;
}

function acceleratedClock(): MonotonicClock {
  let now = 0;
  let pending = false;
  const waits = new Set<{
    deadline: number;
    signal: AbortSignal;
    finish: (reached: boolean) => void;
    abort: () => void;
  }>();
  const advance = () => {
    if (pending || waits.size < 2) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      const active = [...waits].filter(({ signal }) => !signal.aborted);
      if (active.length < 2) return;
      now = Math.max(now, Math.min(...active.map(({ deadline }) => deadline)));
      for (const wait of active) {
        if (wait.deadline > now) continue;
        waits.delete(wait);
        wait.signal.removeEventListener("abort", wait.abort);
        wait.finish(true);
      }
      advance();
    });
  };
  return {
    nowMs: () => now,
    waitUntil(deadline, signal) {
      if (signal.aborted) return Promise.resolve(false);
      if (deadline <= now) return Promise.resolve(true);
      return new Promise((finish) => {
        const wait = {
          deadline,
          signal,
          finish,
          abort: () => {
            waits.delete(wait);
            finish(false);
          },
        };
        waits.add(wait);
        signal.addEventListener("abort", wait.abort, { once: true });
        advance();
      });
    },
  };
}

async function makeValidationScratchRemovable(path: string): Promise<void> {
  let entries;
  try {
    await chmod(path, 0o700);
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await makeValidationScratchRemovable(child);
      } else {
        await chmod(child, 0o600);
      }
    }),
  );
}

export interface ExperimentValidation {
  experiment: ResolvedExperiment;
  fixtures: ReadonlyMap<string, FixturePackage>;
  sandbox: CommandSandbox;
}

export interface ExperimentValidationReport {
  manifestDigest: string;
  runIds: readonly string[];
  fixtures: readonly {
    packagePath: string;
    fixtureId: string;
    contentDigest: string;
    agentIds: readonly string[];
    stageCount: number;
  }[];
  sandbox: CommandSandbox["identity"];
}

export interface ExperimentDependencies {
  loadExperiment: typeof loadResolvedExperiment;
  loadFixture: typeof loadFixturePackage;
  createSandbox: (root: string) => Promise<CommandSandbox>;
  run: typeof runPreparedFixture;
  evaluate: typeof evaluateCanonicalOrigins;
  createAdapter: (options: CreateAiSdkModelAdapterOptions) => ModelAdapter;
}

const defaultDependencies: ExperimentDependencies = {
  loadExperiment: loadResolvedExperiment,
  loadFixture: loadFixturePackage,
  createSandbox: async (root) => createDockerCommandSandbox({ root }),
  run: runPreparedFixture,
  evaluate: evaluateCanonicalOrigins,
  createAdapter: createAiSdkModelAdapter,
};

function dependencies(overrides?: Partial<ExperimentDependencies>): ExperimentDependencies {
  return { ...defaultDependencies, ...overrides };
}

async function appendInfrastructureFailure(tracePath: string, error: unknown): Promise<void> {
  const log = await JsonlObservationLog.open(tracePath);
  await log.append("infrastructure.error", {
    component: "evaluation",
    error: error instanceof Error ? error.message : String(error),
  });
  await log.flush();
}

export async function validateExperimentExecution(options: {
  root: string;
  configPath: string;
  selectedRunId?: string;
  smoke?: boolean;
  dependencies?: Partial<ExperimentDependencies>;
}): Promise<ExperimentValidation> {
  const root = resolve(options.root);
  const service = dependencies(options.dependencies);
  const experiment = await service.loadExperiment(resolve(root, options.configPath), root);
  const fixtures = new Map<string, FixturePackage>();
  for (const run of experiment.runs) {
    let fixture = fixtures.get(run.fixture.packagePath);
    if (fixture === undefined) {
      fixture = await service.loadFixture(run.fixture.packagePath);
      fixtures.set(run.fixture.packagePath, fixture);
    }
    validateRunAgainstFixture(run, fixture);
  }
  const sandbox = await service.createSandbox(root);
  if (options.smoke !== false) {
    const run =
      options.selectedRunId === undefined
        ? experiment.runs[0]!
        : experiment.runs.find(({ id }) => id === options.selectedRunId);
    if (run === undefined) throw new Error(`Unknown experiment run ${options.selectedRunId}.`);
    const fixture = fixtures.get(run.fixture.packagePath)!;
    const scratch = await mkdtemp(join(tmpdir(), "palimpsest-validation-"));
    try {
      await service.run({
        root,
        fixtureRoot: run.fixture.packagePath,
        output: join(scratch, run.id),
        experimentId: experiment.manifestDigest,
        runId: `${run.id}-validation`,
        variantId: run.fixture.variant,
        spendCeilingCents: 0,
        agents: createFixtureAgentRuntimes(fixture.agentIds),
        releaseOffsetsMs: run.schedule.releaseOffsetsMs,
        cutoffMs: run.schedule.cutoffMs,
        tokenBudgetPerAgent: run.limits.tokenLimitPerAgent,
        gitVisibility: run.capabilities.git,
        teamRoom: run.capabilities.teamRoom,
        labels: run.labels,
        sandbox,
        clock: acceleratedClock(),
      });
    } finally {
      await makeValidationScratchRemovable(scratch);
      await rm(scratch, { recursive: true, force: true });
    }
  }
  return { experiment, fixtures, sandbox };
}

export async function runExperiment(options: {
  root: string;
  configPath: string;
  output: string;
  runId?: string;
  allowSpend: boolean;
  env?: NodeJS.ProcessEnv;
  dependencies?: Partial<ExperimentDependencies>;
}): Promise<readonly RunRecord[]> {
  const root = resolve(options.root);
  const output = resolve(root, options.output);
  const service = dependencies(options.dependencies);
  const validated = await validateExperimentExecution({
    root,
    configPath: options.configPath,
    ...(options.runId === undefined ? {} : { selectedRunId: options.runId }),
    dependencies: service,
  });
  if (!options.allowSpend) {
    throw new Error("Provider-backed execution requires --allow-spend true.");
  }
  const selected =
    options.runId === undefined
      ? validated.experiment.runs
      : validated.experiment.runs.filter(({ id }) => id === options.runId);
  if (selected.length === 0) throw new Error(`Unknown experiment run ${options.runId}.`);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const records: RunRecord[] = [];
  for (const run of selected) {
    const fixture = validated.fixtures.get(run.fixture.packagePath)!;
    const agents = createConfiguredAgents(validated.experiment, run, {
      createAdapter: service.createAdapter,
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    const result = await service.run({
      root,
      fixtureRoot: run.fixture.packagePath,
      output: join(output, run.id),
      experimentId: validated.experiment.manifestDigest,
      runId: run.id,
      variantId: run.fixture.variant,
      spendCeilingCents: run.limits.spendCeilingCents,
      agents,
      releaseOffsetsMs: run.schedule.releaseOffsetsMs,
      cutoffMs: run.schedule.cutoffMs,
      tokenBudgetPerAgent: run.limits.tokenLimitPerAgent,
      gitVisibility: run.capabilities.git,
      teamRoom: run.capabilities.teamRoom,
      labels: run.labels,
      sandbox: validated.sandbox,
    });
    let evaluations;
    try {
      evaluations = await service.evaluate({
        root,
        runRoot: result.runRoot,
        fixtureRoot: run.fixture.packagePath,
        variantId: run.fixture.variant,
        frozen: result.frozen,
        sandbox: validated.sandbox,
        tracePath: result.tracePath,
      });
    } catch (error) {
      try {
        await appendInfrastructureFailure(result.tracePath, error);
      } catch (traceError) {
        throw new AggregateError(
          [error, traceError],
          `Run ${run.id} evaluation failed and the infrastructure event could not be flushed.`,
        );
      }
      throw error;
    }
    const record: RunRecord = {
      schemaVersion: 1,
      experimentId: validated.experiment.manifestDigest,
      run: {
        id: run.id,
        fixture: {
          id: fixture.fixtureId,
          packagePath: run.fixture.packagePath,
          digest: fixture.contentDigest,
          variant: run.fixture.variant,
        },
        assignment: run.assignment,
        capabilities: run.capabilities,
        schedule: run.schedule,
        limits: run.limits,
        labels: run.labels,
      },
      models: result.agentIds.map((agentId) => ({ agentId, binding: agents[agentId]!.model })),
      sessions: result.sessions,
      trace: { path: "trace.jsonl", metadataPath: "trace.meta.json" },
      frozen: result.frozen,
      sandbox: result.sandbox,
      evaluations,
      status: result.sessions.some(({ state }) => state === "infrastructure-error")
        ? "infrastructure-error"
        : "completed",
    };
    await publishRunRecord(result.runRoot, record);
    records.push(record);
    if (record.status === "infrastructure-error") {
      throw new Error(`Run ${run.id} ended with an infrastructure error.`);
    }
  }
  await writeFile(
    join(output, "experiment.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        manifestDigest: validated.experiment.manifestDigest,
        runs: records.map(({ run }) => ({ id: run.id, path: `${run.id}/run.json` })),
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return records;
}

export async function validateExperimentFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<ExperimentValidationReport> {
  for (const flag of flags.keys()) {
    if (flag !== "--config") throw new Error(`Unknown validation option ${flag}.`);
  }
  const validated = await validateExperimentExecution({
    root,
    configPath: requiredFlag(flags, "--config"),
  });
  return {
    manifestDigest: validated.experiment.manifestDigest,
    runIds: validated.experiment.runs.map(({ id }) => id),
    fixtures: [...validated.fixtures.entries()].map(([packagePath, fixture]) => ({
      packagePath,
      fixtureId: fixture.fixtureId,
      contentDigest: fixture.contentDigest,
      agentIds: fixture.agentIds,
      stageCount: fixture.stageCount,
    })),
    sandbox: validated.sandbox.identity,
  };
}

export function runExperimentFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<readonly RunRecord[]> {
  for (const flag of flags.keys()) {
    if (!["--config", "--output", "--run", "--allow-spend"].includes(flag)) {
      throw new Error(`Unknown experiment option ${flag}.`);
    }
  }
  const allowSpend = flags.get("--allow-spend");
  if (allowSpend !== "true" && allowSpend !== "false") {
    throw new Error("--allow-spend must be exactly true or false.");
  }
  return runExperiment({
    root,
    configPath: requiredFlag(flags, "--config"),
    output: requiredFlag(flags, "--output"),
    allowSpend: allowSpend === "true",
    ...(flags.has("--run") ? { runId: requiredFlag(flags, "--run") } : {}),
  });
}
