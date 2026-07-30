import { resolve } from "node:path";

import type { BuildManifest, DesignReceipt, PhaseSummary } from "./artifacts.js";
import {
  loadResolvedStudy,
  type AgentModelAssignment,
  type ModelProfile,
  type ProviderConnection,
  type ResolvedStudy,
  type StudyPhase,
} from "./config.js";
import { requiredFlag } from "./flags.js";
import type { ModelAdapter, ModelBinding } from "./model.js";
import { createAiSdkModelAdapter, type CreateAiSdkModelAdapterOptions } from "./provider.js";
import {
  assertPreflightSandbox,
  readCurrentPreflight,
  type PreflightReceipt,
} from "./preflight.js";
import {
  runPuzzle,
  type AgentRuntimeBinding,
  type AgentRuntimeMap,
  type RunPuzzleOptions,
} from "./run.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";
import type { CommandSandbox } from "./sandbox/contracts.js";
import {
  executeStudyPhase,
  prepareStudyDesign,
  type ExecuteStudyPhaseOptions,
  type PrepareStudyDesignOptions,
} from "./study.js";

function bindingFor(
  study: ResolvedStudy,
  assignment: AgentModelAssignment,
): {
  profile: ModelProfile;
  provider: ProviderConnection;
  binding: ModelBinding;
} {
  const profile = study.models[assignment.modelProfileId];
  if (profile === undefined) {
    throw new Error(
      `Agent ${assignment.agentId} references unknown model profile ${assignment.modelProfileId}.`,
    );
  }
  const provider = study.providers[profile.provider];
  if (provider === undefined) {
    throw new Error(
      `Model profile ${assignment.modelProfileId} references unknown provider ${profile.provider}.`,
    );
  }
  return {
    profile,
    provider,
    binding: {
      profile: assignment.modelProfileId,
      provider: profile.provider,
      driver: provider.driver,
      requestedModel: profile.model,
      settings: profile.settings,
      providerOptions: profile.providerOptions,
    },
  };
}

function configuredAgent(
  study: ResolvedStudy,
  assignment: AgentModelAssignment,
  createAdapter: (options: CreateAiSdkModelAdapterOptions) => ModelAdapter,
  env: NodeJS.ProcessEnv | undefined,
): AgentRuntimeBinding {
  const { profile, provider, binding } = bindingFor(study, assignment);
  return {
    model: binding,
    adapter: createAdapter({
      providerId: profile.provider,
      provider,
      model: profile.model,
      settings: profile.settings,
      providerOptions: profile.providerOptions,
      ...(env === undefined ? {} : { env }),
    }),
  };
}

export interface CreateConfiguredStudyAgentsOptions {
  env?: NodeJS.ProcessEnv;
  createAdapter?: (options: CreateAiSdkModelAdapterOptions) => ModelAdapter;
}

export function createConfiguredStudyAgents(
  study: ResolvedStudy,
  options: CreateConfiguredStudyAgentsOptions = {},
): AgentRuntimeMap {
  const [agentOne, agentTwo, agentThree] = study.assignment;
  if (
    agentOne?.agentId !== "agent-1" ||
    agentTwo?.agentId !== "agent-2" ||
    agentThree?.agentId !== "agent-3" ||
    study.assignment.length !== 3
  ) {
    throw new Error("Study assignment must contain agent-1 through agent-3 in order.");
  }
  const createAdapter = options.createAdapter ?? createAiSdkModelAdapter;
  return {
    "agent-1": configuredAgent(study, agentOne, createAdapter, options.env),
    "agent-2": configuredAgent(study, agentTwo, createAdapter, options.env),
    "agent-3": configuredAgent(study, agentThree, createAdapter, options.env),
  };
}

export function assertBuildMatchesStudy(manifest: BuildManifest, study: ResolvedStudy): void {
  if (!study.blocks.some((block) => block.blockId === manifest.blockId)) {
    throw new Error(
      `Puzzle build ${manifest.blockId} is not one of the five registered study blocks.`,
    );
  }
}

export interface ExperimentDependencies {
  loadStudy: typeof loadResolvedStudy;
  createSandbox: (root: string) => Promise<CommandSandbox>;
  prepareDesign: (options: PrepareStudyDesignOptions) => Promise<DesignReceipt>;
  executePhase: (options: ExecuteStudyPhaseOptions) => Promise<PhaseSummary>;
  readPreflight: (root: string) => Promise<PreflightReceipt>;
  createAdapter: (options: CreateAiSdkModelAdapterOptions) => ModelAdapter;
  run: (options: RunPuzzleOptions) => Promise<unknown>;
}

const defaultDependencies: ExperimentDependencies = {
  loadStudy: loadResolvedStudy,
  createSandbox: async (root) => createDockerCommandSandbox({ root }),
  prepareDesign: prepareStudyDesign,
  executePhase: executeStudyPhase,
  readPreflight: readCurrentPreflight,
  createAdapter: createAiSdkModelAdapter,
  run: runPuzzle,
};

function experimentDependencies(
  overrides: Partial<ExperimentDependencies> | undefined,
): ExperimentDependencies {
  return { ...defaultDependencies, ...overrides };
}

export interface RunStudyExperimentOptions {
  root: string;
  configPath: string;
  studyRoot: string;
  phase: StudyPhase;
  replaceAttemptId?: string;
  env?: NodeJS.ProcessEnv;
  dependencies?: Partial<ExperimentDependencies>;
}

export async function runStudyExperiment(
  options: RunStudyExperimentOptions,
): Promise<PhaseSummary> {
  const root = resolve(options.root);
  const configPath = resolve(root, options.configPath);
  const studyRoot = resolve(root, options.studyRoot);
  const dependencies = experimentDependencies(options.dependencies);
  const study = await dependencies.loadStudy(configPath, root);
  const sandbox = await dependencies.createSandbox(root);
  const receipt = await dependencies.prepareDesign({
    root,
    studyRoot,
    study,
    phase: options.phase,
    dependencies: {
      sandboxIdentity: async () => sandbox.identity,
    },
  });

  return dependencies.executePhase({
    studyRoot,
    study,
    receipt,
    phase: options.phase,
    ...(options.replaceAttemptId === undefined
      ? {}
      : { replaceAttemptId: options.replaceAttemptId }),
    dependencies: {
      beforeLaunch: async () => {
        const preflight = await dependencies.readPreflight(root);
        if (preflight.testedCommit !== receipt.sourceRevision) {
          throw new Error(
            "Research preflight commit does not match the receipt-bound source revision.",
          );
        }
        assertPreflightSandbox(preflight, sandbox.identity);
      },
      runCell: async (launch) => {
        const agents = createConfiguredStudyAgents(study, {
          createAdapter: dependencies.createAdapter,
          ...(options.env === undefined ? {} : { env: options.env }),
        });
        await dependencies.run({
          root,
          buildRoot: launch.cell.buildRoot,
          output: launch.attemptRoot,
          attemptId: launch.attemptId,
          studyPhase: options.phase,
          studyRootId: launch.studyRootId,
          conditionOrderPosition: launch.cell.conditionOrderPosition,
          designDigest: launch.designDigest,
          monetaryAuthorizationCeilingCents: launch.monetaryAuthorizationCeilingCents,
          ...(launch.replacementOfAttemptId === undefined
            ? {}
            : { replacementOfAttemptId: launch.replacementOfAttemptId }),
          condition: launch.cell.condition,
          agents,
          tokenBudgetPerAgent: launch.tokenBudgetPerAgent,
          teamChannel: study.communication.teamChannel,
          sandbox,
        });
      },
    },
  });
}

const EXPERIMENT_FLAGS = new Set(["--config", "--phase", "--study-root", "--replace"]);

function studyPhase(value: string): StudyPhase {
  if (value !== "calibration" && value !== "validation") {
    throw new Error("--phase must be calibration or validation.");
  }
  return value;
}

export function runExperimentFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<PhaseSummary> {
  for (const flag of flags.keys()) {
    if (!EXPERIMENT_FLAGS.has(flag)) {
      throw new Error(`Unsupported experiment flag ${flag}.`);
    }
  }
  return runStudyExperiment({
    root,
    configPath: requiredFlag(flags, "--config"),
    studyRoot: requiredFlag(flags, "--study-root"),
    phase: studyPhase(requiredFlag(flags, "--phase")),
    ...(flags.has("--replace") ? { replaceAttemptId: requiredFlag(flags, "--replace") } : {}),
  });
}
