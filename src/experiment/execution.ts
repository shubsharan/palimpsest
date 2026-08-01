import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { loadResolvedExperiment, validateRunAgainstFixture } from "./manifest.js";
import type { ResolvedExperiment, ResolvedRun } from "./contracts.js";
import { evaluateCanonicalOrigins } from "../evaluation/evaluator.js";
import { requiredFlag } from "../flags.js";
import { loadFixturePackage, type FixturePackage } from "../fixture/package.js";
import type {
  ModelAdapter,
  ModelBinding,
  ModelProfile,
  ProviderConnection,
} from "../model/contracts.js";
import {
  createAiSdkModelAdapter,
  type CreateAiSdkModelAdapterOptions,
} from "../model/ai-sdk-adapter.js";
import {
  freezeRunConfiguration,
  publishRunRecord,
  type RunRecord,
  type RunValidationSnapshot,
} from "../run/record.js";
import type { MonotonicClock } from "../run/releases.js";
import {
  createFixtureAgentRuntimes,
  runPreparedFixture,
  type AgentRuntimeMap,
} from "../run/execution.js";
import { createDockerCommandSandbox } from "../sandbox/container.js";
import type { CommandSandbox } from "../sandbox/contracts.js";
import { JsonlObservationLog } from "../trace.js";

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
  run: ResolvedRun,
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
  manifestPath: string;
  validatedAt: string;
  smoke?: RunValidationSnapshot["smoke"];
}

export interface ExperimentValidationReport extends Pick<ResolvedExperiment, "manifestDigest"> {
  runIds: readonly ResolvedRun["id"][];
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

function repositoryRelativePath(root: string, path: string, name: string): string {
  const value = relative(root, path);
  if (value === "" || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error(`${name} must be contained by the repository root.`);
  }
  return value.split(sep).join("/");
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
  const configPath = resolve(root, options.configPath);
  const manifestPath = repositoryRelativePath(root, configPath, "Experiment manifest");
  const experiment = await service.loadExperiment(configPath, root);
  const fixtures = new Map<string, FixturePackage>();
  for (const run of experiment.runs) {
    let fixture = fixtures.get(run.fixture.packageRoot);
    if (fixture === undefined) {
      fixture = await service.loadFixture(run.fixture.packageRoot);
      fixtures.set(run.fixture.packageRoot, fixture);
    }
    const declaredFixtureId = (run.fixture as { fixtureId?: unknown }).fixtureId;
    if (declaredFixtureId !== undefined && fixture.fixtureId !== declaredFixtureId) {
      throw new Error(
        `Run ${run.id} package fixtureId ${fixture.fixtureId} does not match its declared fixture.`,
      );
    }
    validateRunAgainstFixture(run, fixture);
  }
  const smokeRun =
    options.selectedRunId === undefined
      ? experiment.runs[0]
      : experiment.runs.find(({ id }) => id === options.selectedRunId);
  if (smokeRun === undefined) {
    throw new Error(`Unknown experiment run ${String(options.selectedRunId)}.`);
  }
  const sandbox = await service.createSandbox(root);
  let smoke: RunValidationSnapshot["smoke"] | undefined;
  if (options.smoke !== false) {
    const scratch = await mkdtemp(join(tmpdir(), "palimpsest-validation-"));
    try {
      const fixture = fixtures.get(smokeRun.fixture.packageRoot)!;
      await service.run({
        root,
        fixtureRoot: smokeRun.fixture.packageRoot,
        output: join(scratch, smokeRun.id),
        experimentId: experiment.manifestDigest,
        runId: `${smokeRun.id}-validation`,
        variantId: smokeRun.fixture.variant,
        agents: createFixtureAgentRuntimes(fixture.agentIds),
        capabilities: smokeRun.capabilities,
        schedule: smokeRun.schedule,
        limits: { ...smokeRun.limits, spendCeilingCents: 0 },
        labels: smokeRun.labels,
        sandbox,
        clock: acceleratedClock(),
      });
      smoke = {
        sourceRunId: smokeRun.id,
        runId: `${smokeRun.id}-validation`,
        fixtureId: fixture.fixtureId,
        variantId: smokeRun.fixture.variant,
        fixtureDigest: fixture.contentDigest,
        agentIds: fixture.agentIds,
        stageCount: fixture.stageCount,
      };
    } finally {
      await makeValidationScratchRemovable(scratch);
      await rm(scratch, { recursive: true, force: true });
    }
  }
  return {
    experiment,
    fixtures,
    sandbox,
    manifestPath,
    validatedAt: new Date().toISOString(),
    ...(smoke === undefined ? {} : { smoke }),
  };
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
  if (!options.allowSpend) {
    throw new Error("Provider-backed execution requires --allow-spend true.");
  }
  const root = resolve(options.root);
  const output = resolve(root, options.output);
  const service = dependencies(options.dependencies);
  const validated = await validateExperimentExecution({
    root,
    configPath: options.configPath,
    ...(options.runId === undefined ? {} : { selectedRunId: options.runId }),
    dependencies: service,
  });
  const selected =
    options.runId === undefined
      ? validated.experiment.runs
      : validated.experiment.runs.filter(({ id }) => id === options.runId);
  if (selected.length === 0) throw new Error(`Unknown experiment run ${options.runId}.`);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const records: RunRecord[] = [];
  if (validated.smoke === undefined) {
    throw new Error("Provider-backed execution requires a completed provider-free smoke run.");
  }
  for (const run of selected) {
    const fixture = validated.fixtures.get(run.fixture.packageRoot)!;
    const agents = createConfiguredAgents(validated.experiment, run, {
      createAdapter: service.createAdapter,
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    const result = await service.run({
      root,
      fixtureRoot: run.fixture.packageRoot,
      output: join(output, run.id),
      experimentId: validated.experiment.manifestDigest,
      runId: run.id,
      variantId: run.fixture.variant,
      agents,
      capabilities: run.capabilities,
      schedule: run.schedule,
      limits: run.limits,
      labels: run.labels,
      sandbox: validated.sandbox,
    });
    let evaluations;
    try {
      evaluations = await service.evaluate({
        root,
        runRoot: result.runRoot,
        fixtureRoot: run.fixture.packageRoot,
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
    const evaluatedAt = new Date().toISOString();
    const publishedAt = new Date().toISOString();
    const configuration = freezeRunConfiguration({
      manifestPath: validated.manifestPath,
      manifestDigest: validated.experiment.manifestDigest,
      run: {
        id: run.id,
        fixture: {
          id: fixture.fixtureId,
          packagePath: run.fixture.packagePath,
          digest: fixture.contentDigest,
          variant: run.fixture.variant,
          ...(run.fixture.source === undefined ? {} : { source: run.fixture.source }),
          ...(run.fixture.rekeyAtStage === undefined
            ? {}
            : { rekeyAtStage: run.fixture.rekeyAtStage }),
        },
        assignment: run.assignment,
        capabilities: run.capabilities,
        schedule: run.schedule,
        limits: run.limits,
        labels: run.labels,
      },
      models: fixture.agentIds.map((agentId) => ({ agentId, binding: agents[agentId]!.model })),
      validation: {
        manifestPath: validated.manifestPath,
        manifestDigest: validated.experiment.manifestDigest,
        fixture: {
          packagePath: run.fixture.packagePath,
          fixtureId: fixture.fixtureId,
          contentDigest: fixture.contentDigest,
        },
        sandbox: validated.sandbox.identity,
        smoke: validated.smoke,
        validatedAt: validated.validatedAt,
        spendAuthorized: options.allowSpend,
      },
    });
    const record: RunRecord = {
      schemaVersion: 1,
      manifestDigest: validated.experiment.manifestDigest,
      runId: run.id,
      startedAt: result.startedAt,
      frozenAt: result.frozenAt,
      publishedAt,
      configuration,
      sessions: result.sessions,
      releases: result.releases,
      trace: { path: "trace.jsonl", metadataPath: "trace.meta.json" },
      topology: {
        root: relative(result.runRoot, result.frozen.root),
        communicationMode: result.frozen.communicationMode,
        origins: result.frozen.repositories.map((repository) => ({
          originId: repository.repositoryId,
          path: relative(result.runRoot, repository.path),
          agentIds: repository.agentIds,
          mainCommit:
            evaluations.find(({ originId }) => originId === repository.repositoryId)?.commit ??
            null,
        })),
        workspaces: result.frozen.workspaces.map((workspace) => ({
          agentId: workspace.agentId,
          path: relative(result.runRoot, workspace.path),
          originId: workspace.repositoryId,
        })),
        treeSeal: result.frozen.treeSeal,
      },
      evaluations: [
        {
          evaluationId: `automatic-${randomUUID()}`,
          kind: "automatic",
          evaluatedAt,
          results: evaluations,
        },
      ],
      analyses: [],
      sessionInfrastructureFailures: result.sessions
        .filter(({ state }) => state === "infrastructure-error")
        .map(({ agentId, terminationReason }) => ({
          agentId,
          component: "model-session",
          message: terminationReason,
        })),
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
        runs: records.map(({ runId }) => ({ id: runId, path: `${runId}/run.json` })),
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
