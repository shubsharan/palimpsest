import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  decodeAttemptSummary,
  decodeExperimentSummary,
  publishExperimentSummary,
  type AttemptSummary,
  type BuildManifest,
  type BuildPuzzleResult,
  type ExperimentSummary,
} from "./artifacts.js";
import { buildPuzzle, type BuildPuzzleOptions } from "./build.js";
import {
  loadExperimentConfig,
  type ModelProfile,
  type ProviderConnection,
  type ResolvedExperimentConfig,
  type ResolvedRunCondition,
} from "./config.js";
import { requiredFlag } from "./flags.js";
import { isAgentId, type AgentId, type ModelAdapter, type ModelBinding } from "./model.js";
import { createAiSdkModelAdapter, type CreateAiSdkModelAdapterOptions } from "./provider.js";
import { readJsonObject } from "./python.js";
import { runPuzzle } from "./run.js";

export interface ExperimentAgent {
  model: ModelBinding;
  adapter: ModelAdapter;
}

export interface ExperimentRunRequest {
  root: string;
  buildRoot: string;
  output: string;
  runName: string;
  repetition: number;
  agents: Readonly<Record<AgentId, ExperimentAgent>>;
  tokenBudgetPerAgent: number;
  wallTimeMs: number;
  stageIntervalMs: number;
}

export interface ExperimentRunResult {
  attemptId: string;
  attemptRoot: string;
  sessions: readonly { state: string }[];
}

export interface ExperimentDependencies {
  loadConfig: typeof loadExperimentConfig;
  build: (options: BuildPuzzleOptions) => Promise<BuildPuzzleResult>;
  createAdapter: (options: CreateAiSdkModelAdapterOptions) => ModelAdapter;
  run: (options: ExperimentRunRequest) => Promise<ExperimentRunResult>;
  publishSummary: typeof publishExperimentSummary;
}

export interface RunExperimentOptions {
  root: string;
  configPath: string;
  output: string;
  env?: NodeJS.ProcessEnv;
  dependencies?: Partial<ExperimentDependencies>;
}

const defaultDependencies: ExperimentDependencies = {
  loadConfig: loadExperimentConfig,
  build: buildPuzzle,
  createAdapter: createAiSdkModelAdapter,
  run: runPuzzle,
  publishSummary: publishExperimentSummary,
};

function dependencies(
  overrides: Partial<ExperimentDependencies> | undefined,
): ExperimentDependencies {
  return { ...defaultDependencies, ...overrides };
}

async function preflightConfiguration(
  loadConfig: typeof loadExperimentConfig,
  configPath: string,
  root: string,
  env: NodeJS.ProcessEnv | undefined,
): Promise<ResolvedExperimentConfig> {
  const options = env === undefined ? { root } : { root, env };
  const config = await loadConfig(configPath, options);
  const serializedConfig = JSON.stringify(config);

  // A selected run activates credential checks for just the providers it uses.
  // Check every run before creating the experiment directory.
  for (const run of config.runs) {
    const checked = await loadConfig(configPath, { ...options, selectedRun: run.name });
    if (JSON.stringify(checked) !== serializedConfig) {
      throw new Error("Experiment configuration changed during credential preflight.");
    }
  }
  return config;
}

function bindingFor(
  config: ResolvedExperimentConfig,
  profileName: string,
): {
  profile: ModelProfile;
  provider: ProviderConnection;
  binding: ModelBinding;
} {
  const profile = config.models[profileName];
  if (profile === undefined) {
    throw new Error(`Run references unknown model profile ${profileName}.`);
  }
  const provider = config.providers[profile.provider];
  if (provider === undefined) {
    throw new Error(
      `Model profile ${profileName} references unknown provider ${profile.provider}.`,
    );
  }
  return {
    profile,
    provider,
    binding: {
      profile: profileName,
      provider: profile.provider,
      driver: provider.driver,
      requestedModel: profile.model,
      settings: profile.settings,
      providerOptions: profile.providerOptions,
    },
  };
}

function createAdapters(
  config: ResolvedExperimentConfig,
  runs: readonly ResolvedRunCondition[],
  createAdapter: ExperimentDependencies["createAdapter"],
  env: NodeJS.ProcessEnv | undefined,
): ReadonlyMap<string, ExperimentAgent> {
  const adapters = new Map<string, ExperimentAgent>();
  for (const run of runs) {
    for (const assignment of run.agents) {
      if (adapters.has(assignment.modelProfile)) continue;
      const { profile, provider, binding } = bindingFor(config, assignment.modelProfile);
      adapters.set(assignment.modelProfile, {
        model: binding,
        adapter: createAdapter({
          providerId: profile.provider,
          provider,
          model: profile.model,
          settings: profile.settings,
          providerOptions: profile.providerOptions,
          ...(env === undefined ? {} : { env }),
        }),
      });
    }
  }
  return adapters;
}

function agentsFor(
  run: ResolvedRunCondition,
  adapters: ReadonlyMap<string, ExperimentAgent>,
): Readonly<Record<AgentId, ExperimentAgent>> {
  const agents: Partial<Record<AgentId, ExperimentAgent>> = {};
  for (const assignment of run.agents) {
    if (!isAgentId(assignment.agentId)) {
      throw new Error(`Run ${run.name} contains invalid agent ID ${assignment.agentId}.`);
    }
    const agent = adapters.get(assignment.modelProfile);
    if (agent === undefined) {
      throw new Error(`Run ${run.name} has no adapter for ${assignment.modelProfile}.`);
    }
    agents[assignment.agentId] = agent;
  }
  return agents as Readonly<Record<AgentId, ExperimentAgent>>;
}

export interface CreateConfiguredRunAgentsOptions {
  env?: NodeJS.ProcessEnv;
  createAdapter?: ExperimentDependencies["createAdapter"];
}

export function createConfiguredRunAgents(
  config: ResolvedExperimentConfig,
  selectedRun: ResolvedRunCondition,
  options: CreateConfiguredRunAgentsOptions = {},
): Readonly<Record<AgentId, ExperimentAgent>> {
  const run = config.runs.find((candidate) => candidate.name === selectedRun.name);
  if (run === undefined || JSON.stringify(run) !== JSON.stringify(selectedRun)) {
    throw new Error(`Run ${selectedRun.name} is not part of the resolved experiment.`);
  }
  const createAdapter = options.createAdapter ?? createAiSdkModelAdapter;
  return agentsFor(run, createAdapters(config, [run], createAdapter, options.env));
}

export interface CurrentBuildInputs {
  blockId: string;
  source: BuildManifest["source"];
  references: BuildManifest["references"];
  seed: number;
  window: BuildManifest["window"];
  boundaryStage: 4;
}

function inputObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function inputString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function inputInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value as number;
}

export async function loadCurrentBuildInputs(
  root: string,
  blockId: string,
): Promise<CurrentBuildInputs> {
  const catalog = await readJsonObject(join(root, "experiments/blocks.json"));
  const provenance = await readJsonObject(join(root, "fixtures/corpus/provenance.json"));
  if (catalog.schemaVersion !== 1 || provenance.schemaVersion !== 1) {
    throw new Error("Current puzzle input schema version is unsupported.");
  }
  if (!Array.isArray(catalog.blocks) || !Array.isArray(provenance.sources)) {
    throw new Error("Current puzzle inputs are malformed.");
  }
  const block = inputObject(
    catalog.blocks.find(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).blockId === blockId,
    ),
    `Block ${blockId}`,
  );
  const sourceIds = [
    inputString(block.sourceId, `Block ${blockId} sourceId`),
    ...(() => {
      if (!Array.isArray(block.references)) {
        throw new Error(`Block ${blockId} references must be an array.`);
      }
      return block.references.map((value, index) =>
        inputString(value, `Block ${blockId} references[${String(index)}]`),
      );
    })(),
  ];
  const sources = sourceIds.map((sourceId) => {
    const source = inputObject(
      provenance.sources.find(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value) &&
          (value as Record<string, unknown>).sourceId === sourceId,
      ),
      `Provenance source ${sourceId}`,
    );
    return {
      sourceId,
      sha256: inputString(source.sha256, `Provenance source ${sourceId} sha256`),
    };
  });
  const window = inputObject(block.window, `Block ${blockId} window`);
  const boundaryStage = inputInteger(block.boundaryStage, `Block ${blockId} boundaryStage`);
  if (boundaryStage !== 4) throw new Error(`Block ${blockId} boundaryStage must be 4.`);
  return {
    blockId,
    source: sources[0]!,
    references: sources.slice(1),
    seed: inputInteger(block.seed, `Block ${blockId} seed`),
    window: {
      paragraphStart: inputInteger(window.paragraphStart, `Block ${blockId} paragraphStart`),
      paragraphEnd: inputInteger(window.paragraphEnd, `Block ${blockId} paragraphEnd`),
      wordCount: inputInteger(window.wordCount, `Block ${blockId} wordCount`),
      sha256: inputString(window.sha256, `Block ${blockId} window sha256`),
    },
    boundaryStage,
  };
}

export function assertBuildMatchesExperimentConfig(
  manifest: BuildManifest,
  config: ResolvedExperimentConfig,
  current: CurrentBuildInputs,
): void {
  const referencesMatch =
    manifest.references.length === current.references.length &&
    manifest.references.every((reference, index) => {
      const expected = current.references[index];
      return (
        expected !== undefined &&
        reference.sourceId === expected.sourceId &&
        reference.sha256 === expected.sha256
      );
    });
  if (
    manifest.blockId !== config.puzzle.block ||
    manifest.blockId !== current.blockId ||
    manifest.source.sourceId !== current.source.sourceId ||
    manifest.source.sha256 !== current.source.sha256 ||
    !referencesMatch ||
    manifest.seed !== current.seed ||
    JSON.stringify(manifest.window) !== JSON.stringify(current.window) ||
    manifest.boundaryStage !== current.boundaryStage
  ) {
    throw new Error("Puzzle build does not match the resolved experiment configuration.");
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readDurableAttempt(attemptRoot: string): Promise<AttemptSummary | undefined> {
  const path = join(attemptRoot, "attempt.json");
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not valid JSON: ${detail}`);
  }
  return decodeAttemptSummary(value);
}

function verifyDurableAttempt(
  attempt: AttemptSummary,
  build: BuildPuzzleResult,
  run: ResolvedRunCondition,
): void {
  if (attempt.buildId !== build.variants.rekey || attempt.buildRoot !== build.buildPath) {
    throw new Error(`Attempt ${attempt.attemptId} does not belong to the experiment build.`);
  }
  if (
    attempt.agentIds.length !== run.agents.length ||
    attempt.agentIds.some((agentId, index) => agentId !== run.agents[index]?.agentId)
  ) {
    throw new Error(`Attempt ${attempt.attemptId} does not contain the configured agents.`);
  }
  for (const session of attempt.sessions) {
    const assignment = run.agents.find((candidate) => candidate.agentId === session.agentId);
    if (assignment === undefined || assignment.modelProfile !== session.model.profile) {
      throw new Error(`Attempt ${attempt.attemptId} does not contain the configured models.`);
    }
  }
}

function appendAttempt(
  summary: ExperimentSummary,
  run: ResolvedRunCondition,
  repetition: number,
  attempt: AttemptSummary,
  attemptRoot: string,
): ExperimentSummary {
  return decodeExperimentSummary({
    ...summary,
    attempts: [
      ...summary.attempts,
      {
        runName: run.name,
        repetition,
        attemptId: attempt.attemptId,
        attemptRoot,
      },
    ],
  });
}

async function publishDurableAttempt(options: {
  summary: ExperimentSummary;
  experimentRoot: string;
  attemptRoot: string;
  run: ResolvedRunCondition;
  repetition: number;
  build: BuildPuzzleResult;
  publishSummary: typeof publishExperimentSummary;
}): Promise<{ summary: ExperimentSummary; infrastructureError: boolean } | undefined> {
  const attempt = await readDurableAttempt(options.attemptRoot);
  if (attempt === undefined) return undefined;
  verifyDurableAttempt(attempt, options.build, options.run);
  const summary = appendAttempt(
    options.summary,
    options.run,
    options.repetition,
    attempt,
    options.attemptRoot,
  );
  await options.publishSummary(options.experimentRoot, summary);
  return {
    summary,
    infrastructureError: attempt.sessions.some(
      (session) => session.state === "infrastructure-error",
    ),
  };
}

export async function runExperiment(options: RunExperimentOptions): Promise<ExperimentSummary> {
  const root = resolve(options.root);
  const experimentRoot = resolve(options.output);
  const deps = dependencies(options.dependencies);
  const config = await preflightConfiguration(
    deps.loadConfig,
    options.configPath,
    root,
    options.env,
  );
  const adapters = createAdapters(config, config.runs, deps.createAdapter, options.env);

  await mkdir(dirname(experimentRoot), { recursive: true });
  await mkdir(experimentRoot, { recursive: false });
  const build = await deps.build({
    root,
    output: join(experimentRoot, "build"),
    block: config.puzzle.block,
  });
  let summary = decodeExperimentSummary({
    schemaVersion: 1,
    resolvedConfig: config,
    buildRoot: build.buildPath,
    buildId: build.variants.rekey,
    attempts: [],
  });

  for (const run of config.runs) {
    for (let repetition = 1; repetition <= run.repetitions; repetition += 1) {
      const attemptRoot = join(
        experimentRoot,
        "attempts",
        run.name,
        String(repetition).padStart(3, "0"),
      );
      await mkdir(dirname(attemptRoot), { recursive: true });
      let result: ExperimentRunResult;
      try {
        result = await deps.run({
          root,
          buildRoot: build.buildPath,
          output: attemptRoot,
          runName: run.name,
          repetition,
          agents: agentsFor(run, adapters),
          tokenBudgetPerAgent: config.limits.tokenBudgetPerAgent,
          wallTimeMs: config.limits.wallTimeMs,
          stageIntervalMs: config.puzzle.stageIntervalMs,
        });
      } catch (error) {
        const durable = await publishDurableAttempt({
          summary,
          experimentRoot,
          attemptRoot,
          run,
          repetition,
          build,
          publishSummary: deps.publishSummary,
        });
        if (durable !== undefined) summary = durable.summary;
        throw error;
      }

      const durable = await publishDurableAttempt({
        summary,
        experimentRoot,
        attemptRoot,
        run,
        repetition,
        build,
        publishSummary: deps.publishSummary,
      });
      if (durable === undefined) {
        throw new Error(`Attempt ${run.name}/${String(repetition)} did not publish attempt.json.`);
      }
      if (
        result.attemptId !== durable.summary.attempts.at(-1)?.attemptId ||
        resolve(result.attemptRoot) !== attemptRoot
      ) {
        throw new Error(
          `Attempt ${run.name}/${String(repetition)} returned inconsistent identity.`,
        );
      }
      summary = durable.summary;
      if (durable.infrastructureError) {
        throw new Error(
          `Experiment stopped after infrastructure failure in ${run.name}/${String(repetition)}.`,
        );
      }
    }
  }
  return summary;
}

export interface ExperimentCommandResult {
  experimentRoot: string;
  buildId: string;
  buildRoot: string;
  completedAttemptCount: number;
  attempts: ExperimentSummary["attempts"];
}

export async function runExperimentFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
  dependencies?: Partial<ExperimentDependencies>,
): Promise<ExperimentCommandResult> {
  const output = resolve(requiredFlag(flags, "--output"));
  const summary = await runExperiment({
    root,
    configPath: requiredFlag(flags, "--config"),
    output,
    ...(dependencies === undefined ? {} : { dependencies }),
  });
  return {
    experimentRoot: output,
    buildId: summary.buildId,
    buildRoot: summary.buildRoot,
    completedAttemptCount: summary.attempts.length,
    attempts: summary.attempts,
  };
}
