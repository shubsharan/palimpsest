import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import experimentSchema from "../experiments/schema.json" with { type: "json" };
import type { AgentId } from "./model.js";

export type ProviderDriver = "openai" | "anthropic" | "google" | "openai-compatible";
export type GitVisibility = "shared" | "isolated";
export type TeamRoomAvailability = "enabled" | "disabled";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

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
  headersEnv?: Record<string, string>;
}

export type ProviderConnection = OfficialProviderConnection | OpenAICompatibleProviderConnection;

export interface ModelProfile {
  provider: string;
  model: string;
  settings: CommonModelSettings;
  providerOptions: Record<string, JsonValue>;
}

export interface ModelDeclaration {
  provider: string;
  model: string;
  settings?: CommonModelSettings;
  providerOptions?: Record<string, JsonValue>;
}

export interface FixtureReference {
  packagePath: string;
  variant: string;
}

export interface ExperimentCapabilities {
  git: GitVisibility;
  teamRoom: TeamRoomAvailability;
}

export interface ExperimentSchedule {
  releaseOffsetsMs: number[];
  cutoffMs: number;
}

export interface ExperimentLimits {
  tokenLimitPerAgent: number | null;
  spendCeilingCents: number;
}

export interface ExperimentRun {
  id: string;
  fixture: FixtureReference;
  assignment: Record<AgentId, string>;
  capabilities: ExperimentCapabilities;
  schedule: ExperimentSchedule;
  limits: ExperimentLimits;
  labels: JsonObject;
}

export interface ExperimentManifest {
  schemaVersion: 1;
  providers: Record<string, ProviderConnection>;
  models: Record<string, ModelDeclaration>;
  totalSpendCeilingCents: number;
  runs: ExperimentRun[];
}

export interface ResolvedFixtureReference extends FixtureReference {
  packagePath: string;
}

export interface ResolvedExperimentRun extends Omit<ExperimentRun, "fixture"> {
  fixture: ResolvedFixtureReference;
}

export interface ResolvedExperiment {
  schemaVersion: 1;
  providers: Readonly<Record<string, ProviderConnection>>;
  models: Readonly<Record<string, ModelProfile>>;
  totalSpendCeilingCents: number;
  runs: readonly ResolvedExperimentRun[];
  manifestDigest: string;
}

/** The fixture fields needed to validate a run without coupling configuration to package internals. */
export interface FixturePackageMetadata {
  agentIds: readonly AgentId[];
  stageCount: number;
  variants: Readonly<Record<string, unknown>>;
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

export function validateExperimentManifest(value: unknown): ExperimentManifest {
  if (!validateSchema(value)) {
    const errors = validateSchema.errors?.map(structuralError).join("; ") ?? "unknown error";
    throw new Error(`Experiment manifest is invalid: ${errors}`);
  }
  return value as ExperimentManifest;
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
    normalized === "auth" ||
    normalized === "authorization" ||
    normalized === "bearer" ||
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

function validateJsonValue(
  value: unknown,
  path: string,
  rejectRequestControls: boolean,
): asserts value is JsonValue {
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
      validateJsonValue(child, `${path}[${String(index)}]`, rejectRequestControls);
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
      throw new Error(`${childPath} is secret-bearing.`);
    }
    if (rejectRequestControls && requestControlKeys.has(normalized)) {
      throw new Error(`${childPath} cannot override model request control.`);
    }
    if (rejectRequestControls && (normalized === "fallback" || normalized === "fallbacks")) {
      throw new Error(`${childPath} cannot configure provider fallback.`);
    }
    validateJsonValue(child, childPath, rejectRequestControls);
  }
}

export function validateProviderOptions(
  value: Readonly<Record<string, unknown>>,
  path = "providerOptions",
): asserts value is Readonly<Record<string, JsonValue>> {
  try {
    validateJsonValue(value, path, true);
  } catch (error) {
    if (error instanceof Error && error.message.endsWith(" is secret-bearing.")) {
      throw new Error(
        error.message.replace(/ is secret-bearing\.$/, " is a secret-bearing provider option."),
      );
    }
    throw error;
  }
}

function safeInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${path} must be a safe integer of at least ${String(minimum)}.`);
  }
  return value as number;
}

export function validateRunSchedule(
  releaseOffsetsMs: readonly number[],
  cutoffMs: number,
  expectedStageCount?: number,
  path = "schedule",
): void {
  if (expectedStageCount !== undefined && releaseOffsetsMs.length !== expectedStageCount) {
    throw new Error(
      `${path}.releaseOffsetsMs must contain exactly ${String(expectedStageCount)} stage offsets.`,
    );
  }
  if (releaseOffsetsMs.length === 0) {
    throw new Error(`${path}.releaseOffsetsMs must contain at least one stage offset.`);
  }
  for (const [index, offset] of releaseOffsetsMs.entries()) {
    safeInteger(offset, `${path}.releaseOffsetsMs[${String(index)}]`);
    if (index === 0 && offset !== 0) {
      throw new Error(`${path}.releaseOffsetsMs must begin at zero.`);
    }
    if (index > 0 && offset <= releaseOffsetsMs[index - 1]!) {
      throw new Error(`${path}.releaseOffsetsMs must be strictly increasing.`);
    }
  }
  safeInteger(cutoffMs, `${path}.cutoffMs`, 1);
  if (cutoffMs <= releaseOffsetsMs.at(-1)!) {
    throw new Error(`${path}.cutoffMs must be after the final stage release.`);
  }
}

function assertProviderReferences(manifest: ExperimentManifest): void {
  for (const [name, provider] of Object.entries(manifest.providers)) {
    if (provider.driver !== "openai-compatible") continue;
    const endpoint = new URL(provider.baseURL);
    if (endpoint.username.length > 0 || endpoint.password.length > 0) {
      throw new Error(`providers.${name}.baseURL must not contain literal credentials.`);
    }
    const secretParameter = [...endpoint.searchParams.keys()].find(secretBearingKey);
    if (secretParameter !== undefined) {
      throw new Error(
        `providers.${name}.baseURL query parameter ${secretParameter} is secret-bearing.`,
      );
    }
  }
  for (const [name, model] of Object.entries(manifest.models)) {
    if (!(model.provider in manifest.providers)) {
      throw new Error(`models.${name}.provider references unknown provider ${model.provider}.`);
    }
    validateProviderOptions(model.providerOptions ?? {}, `models.${name}.providerOptions`);
  }
}

function assertRuns(manifest: ExperimentManifest): void {
  const ids = new Set<string>();
  let authorizedSpend = 0;
  for (const [index, run] of manifest.runs.entries()) {
    const path = `runs[${String(index)}]`;
    if (ids.has(run.id)) {
      throw new Error(`${path}.id duplicates experiment run id ${run.id}.`);
    }
    ids.add(run.id);
    for (const [agentId, modelProfileId] of Object.entries(run.assignment)) {
      if (!(modelProfileId in manifest.models)) {
        throw new Error(
          `${path}.assignment.${agentId} references unknown model profile ${modelProfileId}.`,
        );
      }
    }
    validateRunSchedule(
      run.schedule.releaseOffsetsMs,
      run.schedule.cutoffMs,
      undefined,
      `${path}.schedule`,
    );
    if (run.limits.tokenLimitPerAgent !== null) {
      safeInteger(run.limits.tokenLimitPerAgent, `${path}.limits.tokenLimitPerAgent`, 1);
    }
    const runSpend = safeInteger(run.limits.spendCeilingCents, `${path}.limits.spendCeilingCents`);
    authorizedSpend += runSpend;
    if (!Number.isSafeInteger(authorizedSpend)) {
      throw new Error("The sum of run spend ceilings must be a safe integer.");
    }
    validateJsonValue(run.labels, `${path}.labels`, false);
  }
  const totalSpend = safeInteger(manifest.totalSpendCeilingCents, "totalSpendCeilingCents");
  if (authorizedSpend > totalSpend) {
    throw new Error(
      `totalSpendCeilingCents must cover the ${String(authorizedSpend)}-cent run authorization.`,
    );
  }
}

function resolvedPackagePath(repositoryRoot: string, configuredPath: string, path: string): string {
  if (isAbsolute(configuredPath)) {
    throw new Error(`${path} must be relative to the repository.`);
  }
  const absolutePath = resolve(repositoryRoot, configuredPath);
  const difference = relative(repositoryRoot, absolutePath);
  if (
    difference.length === 0 ||
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  ) {
    throw new Error(`${path} must remain inside the repository.`);
  }
  return absolutePath;
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

function cloneModels(models: Record<string, ModelDeclaration>): Record<string, ModelProfile> {
  return Object.fromEntries(
    Object.entries(models).map(([name, model]) => [
      name,
      {
        provider: model.provider,
        model: model.model,
        settings: { ...model.settings },
        providerOptions: { ...model.providerOptions },
      },
    ]),
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Cannot hash a non-JSON experiment value.");
  return encoded;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function validateRunAgainstFixture(
  run: ExperimentRun | ResolvedExperimentRun,
  fixture: FixturePackageMetadata,
): void {
  safeInteger(fixture.stageCount, "fixture.stageCount", 1);
  const assignedAgents = Object.keys(run.assignment).sort();
  const fixtureAgents = [...fixture.agentIds].sort();
  if (
    assignedAgents.length !== fixtureAgents.length ||
    assignedAgents.some((agentId, index) => agentId !== fixtureAgents[index])
  ) {
    throw new Error(
      `Run ${run.id} assignment must contain exactly the fixture agents: ${fixtureAgents.join(", ")}.`,
    );
  }
  if (!(run.fixture.variant in fixture.variants)) {
    throw new Error(`Run ${run.id} references unknown fixture variant ${run.fixture.variant}.`);
  }
  validateRunSchedule(
    run.schedule.releaseOffsetsMs,
    run.schedule.cutoffMs,
    fixture.stageCount,
    `Run ${run.id} schedule`,
  );
}

export function resolveExperiment(
  value: unknown,
  repositoryRoot = resolve("."),
): ResolvedExperiment {
  const manifest = structuredClone(validateExperimentManifest(value));
  assertProviderReferences(manifest);
  assertRuns(manifest);
  const root = resolve(repositoryRoot);

  return deepFreeze({
    schemaVersion: 1,
    providers: Object.fromEntries(
      Object.entries(manifest.providers).map(([name, provider]) => [name, cloneProvider(provider)]),
    ),
    models: cloneModels(manifest.models),
    totalSpendCeilingCents: manifest.totalSpendCeilingCents,
    runs: manifest.runs.map((run, index) => ({
      id: run.id,
      fixture: {
        packagePath: resolvedPackagePath(
          root,
          run.fixture.packagePath,
          `runs[${String(index)}].fixture.packagePath`,
        ),
        variant: run.fixture.variant,
      },
      assignment: { ...run.assignment },
      capabilities: { ...run.capabilities },
      schedule: {
        releaseOffsetsMs: [...run.schedule.releaseOffsetsMs],
        cutoffMs: run.schedule.cutoffMs,
      },
      limits: { ...run.limits },
      labels: structuredClone(run.labels),
    })),
    manifestDigest: createHash("sha256").update(canonicalJson(manifest)).digest("hex"),
  });
}

export async function loadExperimentManifest(path: string): Promise<ExperimentManifest> {
  return validateExperimentManifest(parseExperimentYaml(await readFile(path, "utf8")));
}

export async function loadResolvedExperiment(
  path: string,
  repositoryRoot = resolve("."),
): Promise<ResolvedExperiment> {
  return resolveExperiment(await loadExperimentManifest(path), repositoryRoot);
}
