import { readFile } from "node:fs/promises";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import experimentSchema from "../experiments/schema.json" with { type: "json" };
import { generateAgentIds, type AgentId } from "./model.js";

export type ProviderDriver = "openai" | "anthropic" | "google" | "openai-compatible";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface CommonModelSettings {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  seed?: number;
}

export interface OfficialProviderConnection {
  driver: "openai" | "anthropic" | "google";
  apiKeyEnv: string;
}

export interface OpenAICompatibleProviderConnection {
  driver: "openai-compatible";
  baseURL: string;
  apiKeyEnv?: string;
  headersEnv?: Readonly<Record<string, string>>;
}

export type ProviderConnection = OfficialProviderConnection | OpenAICompatibleProviderConnection;

export interface ModelProfile {
  provider: string;
  model: string;
  settings: CommonModelSettings;
  providerOptions: Readonly<Record<string, JsonValue>>;
}

export interface PuzzleDefinition {
  block: string;
  stageIntervalMs: number;
}

export interface ExperimentLimits {
  tokenBudgetPerAgent: number;
  wallTimeMs: number;
}

export interface ResolvedAgentBinding {
  agentId: AgentId;
  modelProfile: string;
}

export interface ResolvedRunCondition {
  name: string;
  repetitions: number;
  agents: readonly ResolvedAgentBinding[];
}

export interface ResolvedExperimentConfig {
  schemaVersion: 1;
  puzzle: PuzzleDefinition;
  limits: ExperimentLimits;
  providers: Readonly<Record<string, ProviderConnection>>;
  models: Readonly<Record<string, ModelProfile>>;
  runs: readonly ResolvedRunCondition[];
}

interface ExperimentConfig {
  schemaVersion: 1;
  puzzle: PuzzleDefinition;
  limits: ExperimentLimits;
  providers: Record<string, ProviderConnection>;
  models: Record<
    string,
    {
      provider: string;
      model: string;
      settings?: CommonModelSettings;
      providerOptions?: Record<string, JsonValue>;
    }
  >;
  runs: {
    name: string;
    model?: string;
    agents?: string[];
    repetitions?: number;
  }[];
}

export interface ResolveExperimentOptions {
  root?: string;
  selectedRun?: string;
  env?: NodeJS.ProcessEnv;
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  validateFormats: true,
});
ajv.addFormat("uri", {
  type: "string",
  validate(value: string): boolean {
    try {
      return new URL(value).protocol.length > 0;
    } catch {
      return false;
    }
  },
});
const validateSchema: ValidateFunction = ajv.compile(experimentSchema);

function structuralError(error: ErrorObject): string {
  let path = error.instancePath || "/";
  if (
    error.keyword === "additionalProperties" &&
    typeof error.params.additionalProperty === "string"
  ) {
    path = `${path === "/" ? "" : path}/${error.params.additionalProperty}`;
  }
  return `${path} ${error.message ?? "is invalid"}`;
}

export function parseExperimentYaml(source: string): unknown {
  const document = parseDocument(source, {
    schema: "core",
    merge: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`Experiment YAML is invalid: ${document.errors[0]!.message}`);
  }
  try {
    return document.toJS({ json: true, maxAliasCount: 0 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Experiment YAML is invalid: ${detail}`);
  }
}

export function validateExperimentConfig(value: unknown): ExperimentConfig {
  if (!validateSchema(value)) {
    const errors = validateSchema.errors?.map(structuralError).join("; ") ?? "unknown error";
    throw new Error(`Experiment configuration is invalid: ${errors}`);
  }
  return value as ExperimentConfig;
}

function normalizedKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

const requestControlKeys = new Set([
  "abortsignal",
  "activetools",
  "headers",
  "instructions",
  "maxretries",
  "messages",
  "model",
  "onabort",
  "onend",
  "onfinish",
  "onstart",
  "onstepfinish",
  "onstepstart",
  "prompt",
  "stopwhen",
  "system",
  "timeout",
  "toolchoice",
  "tools",
]);

function secretBearingKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    normalized.includes("apikey") ||
    normalized === "authorization" ||
    normalized.endsWith("credential") ||
    normalized.endsWith("credentials") ||
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized === "token" ||
    normalized.endsWith("accesstoken") ||
    normalized.endsWith("authtoken") ||
    normalized.endsWith("bearertoken")
  );
}

function validateJsonValue(value: unknown, path: string): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      validateJsonValue(child, `${path}[${String(index)}]`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new Error(`${path} must contain only JSON-compatible values.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must contain only JSON-compatible values.`);
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    const normalized = normalizedKey(key);
    if (secretBearingKey(key)) {
      throw new Error(`${childPath} is a secret-bearing provider option.`);
    }
    if (requestControlKeys.has(normalized)) {
      throw new Error(`${childPath} cannot override model request control.`);
    }
    if (normalized === "fallback" || normalized === "fallbacks") {
      throw new Error(`${childPath} cannot configure provider fallback.`);
    }
    validateJsonValue(child, childPath);
  }
}

export function validateProviderOptions(
  value: Readonly<Record<string, unknown>>,
  path = "providerOptions",
): asserts value is Readonly<Record<string, JsonValue>> {
  validateJsonValue(value, path);
}

function safeInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${path} must be a safe integer of at least ${String(minimum)}.`);
  }
  return value as number;
}

function assertSemanticRelationships(config: ExperimentConfig): void {
  safeInteger(config.puzzle.stageIntervalMs, "puzzle.stageIntervalMs", 1);
  safeInteger(config.limits.tokenBudgetPerAgent, "limits.tokenBudgetPerAgent", 1);
  safeInteger(config.limits.wallTimeMs, "limits.wallTimeMs", 1);
  for (const [name, model] of Object.entries(config.models)) {
    if (!(model.provider in config.providers)) {
      throw new Error(`models.${name}.provider references unknown provider ${model.provider}.`);
    }
    validateProviderOptions(model.providerOptions ?? {}, `models.${name}.providerOptions`);
  }
  const runNames = new Set<string>();
  for (const [index, run] of config.runs.entries()) {
    safeInteger(run.repetitions ?? 1, `runs[${String(index)}].repetitions`, 1);
    if (runNames.has(run.name)) {
      throw new Error(`runs[${String(index)}].name must be unique.`);
    }
    runNames.add(run.name);
    const profiles = run.model === undefined ? run.agents! : [run.model];
    if (run.agents !== undefined && run.agents.length !== 3) {
      throw new Error(`runs[${String(index)}].agents must contain exactly three assignments.`);
    }
    for (const profile of profiles) {
      if (!(profile in config.models)) {
        throw new Error(`runs[${String(index)}] references unknown model profile ${profile}.`);
      }
    }
  }
}

function cloneProvider(provider: ProviderConnection): ProviderConnection {
  if (provider.driver !== "openai-compatible") return { ...provider };
  return {
    driver: provider.driver,
    baseURL: provider.baseURL,
    ...(provider.apiKeyEnv === undefined ? {} : { apiKeyEnv: provider.apiKeyEnv }),
    ...(provider.headersEnv === undefined ? {} : { headersEnv: { ...provider.headersEnv } }),
  };
}

function resolveRuns(config: ExperimentConfig): ResolvedRunCondition[] {
  const agentIds = generateAgentIds(3);
  return config.runs.map((run) => {
    const profiles =
      run.model === undefined ? run.agents! : Array.from({ length: 3 }, () => run.model!);
    return {
      name: run.name,
      repetitions: run.repetitions ?? 1,
      agents: profiles.map((modelProfile, index) => ({
        agentId: agentIds[index]!,
        modelProfile,
      })),
    };
  });
}

function requireEnvironmentValue(env: NodeJS.ProcessEnv, variable: string, path: string): string {
  const value = env[variable];
  if (value === undefined || value.length === 0) {
    throw new Error(`${path} requires environment variable ${variable}.`);
  }
  return value;
}

function preflightCredentials(
  selectedRun: string,
  runs: readonly ResolvedRunCondition[],
  models: Readonly<Record<string, ModelProfile>>,
  providers: Readonly<Record<string, ProviderConnection>>,
  env: NodeJS.ProcessEnv,
): void {
  const run = runs.find((candidate) => candidate.name === selectedRun);
  if (run === undefined) {
    throw new Error(`Selected run ${selectedRun} does not exist.`);
  }
  const providerNames = new Set(
    run.agents.map((binding) => models[binding.modelProfile]!.provider),
  );
  for (const providerName of providerNames) {
    const provider = providers[providerName]!;
    if (provider.apiKeyEnv !== undefined) {
      requireEnvironmentValue(env, provider.apiKeyEnv, `providers.${providerName}.apiKeyEnv`);
    }
    if (provider.driver !== "openai-compatible") continue;
    for (const [header, variable] of Object.entries(provider.headersEnv ?? {})) {
      requireEnvironmentValue(env, variable, `providers.${providerName}.headersEnv.${header}`);
    }
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export async function resolveExperimentConfig(
  value: unknown,
  options: ResolveExperimentOptions = {},
): Promise<ResolvedExperimentConfig> {
  const config = validateExperimentConfig(value);
  assertSemanticRelationships(config);
  const providers = Object.fromEntries(
    Object.entries(config.providers).map(([name, provider]) => [name, cloneProvider(provider)]),
  );
  const models = Object.fromEntries(
    Object.entries(config.models).map(([name, model]) => [
      name,
      {
        provider: model.provider,
        model: model.model,
        settings: { ...model.settings },
        providerOptions: { ...model.providerOptions },
      },
    ]),
  );
  const runs = resolveRuns(config);
  if (options.selectedRun !== undefined) {
    preflightCredentials(options.selectedRun, runs, models, providers, options.env ?? process.env);
  }
  return deepFreeze({
    schemaVersion: 1,
    puzzle: {
      block: config.puzzle.block,
      stageIntervalMs: config.puzzle.stageIntervalMs,
    },
    limits: { ...config.limits },
    providers,
    models,
    runs,
  });
}

export async function loadExperimentConfig(
  path: string,
  options: ResolveExperimentOptions = {},
): Promise<ResolvedExperimentConfig> {
  const source = await readFile(path, "utf8");
  return resolveExperimentConfig(parseExperimentYaml(source), options);
}
