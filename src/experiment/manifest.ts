import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import experimentSchema from "../../experiments/schema.json" with { type: "json" };
import { generateAgentIds, type JsonValue, type ProviderConnection } from "../model/contracts.js";
import type {
  AuthoredRun,
  ExperimentManifest,
  FixturePackageMetadata,
  ResolvedExperiment,
  ResolvedRun,
  RunDeclaration,
} from "./contracts.js";

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validateSchema: ValidateFunction = ajv.compile(experimentSchema);
const DURATION = /^(0|[1-9][0-9]*)(ms|s|m|h)$/;
const DURATION_FACTORS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 } as const;
const CREDENTIAL_ENV = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
} as const;

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
  const document = parseDocument(source, { schema: "core", merge: false, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Experiment YAML is invalid: ${document.errors[0]!.message}`);
  }
  try {
    return document.toJS({ json: true, maxAliasCount: 0 });
  } catch (error) {
    throw new Error(
      `Experiment YAML is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
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

const REQUEST_CONTROL_KEYS = new Set([
  "abortsignal",
  "headers",
  "instructions",
  "maxretries",
  "messages",
  "model",
  "prompt",
  "stopwhen",
  "system",
  "timeout",
  "toolchoice",
  "tools",
]);

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
    value.forEach((child, index) => validateJsonValue(child, `${path}[${String(index)}]`));
    return;
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path} must contain only JSON-compatible values.`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (secretBearingKey(key)) throw new Error(`${path}.${key} is secret-bearing.`);
    const normalized = normalizedKey(key);
    if (REQUEST_CONTROL_KEYS.has(normalized)) {
      throw new Error(`${path}.${key} cannot override model request control.`);
    }
    if (normalized === "fallback" || normalized === "fallbacks") {
      throw new Error(`${path}.${key} cannot configure provider fallback.`);
    }
    validateJsonValue(child, `${path}.${key}`);
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

export function parseDuration(value: string, path: string): number {
  const match = DURATION.exec(value);
  if (match === null)
    throw new Error(`${path} must be an integer duration ending in ms, s, m, or h.`);
  const amount = Number(match[1]);
  const milliseconds = amount * DURATION_FACTORS[match[2] as keyof typeof DURATION_FACTORS];
  return safeInteger(milliseconds, path);
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
  if (releaseOffsetsMs.length === 0)
    throw new Error(`${path}.releaseOffsetsMs must contain at least one stage offset.`);
  for (const [index, offset] of releaseOffsetsMs.entries()) {
    safeInteger(offset, `${path}.releaseOffsetsMs[${String(index)}]`);
    if (index === 0 && offset !== 0)
      throw new Error(`${path}.releaseOffsetsMs must begin at zero.`);
    if (index > 0 && offset <= releaseOffsetsMs[index - 1]!) {
      throw new Error(`${path}.releaseOffsetsMs must be strictly increasing.`);
    }
  }
  safeInteger(cutoffMs, `${path}.cutoffMs`, 1);
  if (cutoffMs <= releaseOffsetsMs.at(-1)!) {
    throw new Error(`${path}.cutoffMs must be after the final stage release.`);
  }
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

function containedPath(repositoryRoot: string, configuredPath: string, path: string): string {
  if (isAbsolute(configuredPath)) throw new Error(`${path} must be relative to the repository.`);
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

function fixtureIdentity(
  run: AuthoredRun,
  repositoryRoot: string,
): { fixtureId: string; variant: string } {
  const sourcePath = containedPath(repositoryRoot, run.source, "run.source");
  let sourceDigest: string;
  try {
    sourceDigest = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
  } catch (error) {
    throw new Error(`run.source must name a readable source file: ${run.source}`, { cause: error });
  }
  const scientificInputs = {
    source: run.source,
    sourceDigest,
    agents: run.agents,
    stages: run.releases.length,
    rekeyAtStage: run.rekeyAtStage ?? null,
  };
  const digest = createHash("sha256").update(canonicalJson(scientificInputs)).digest("hex");
  return {
    fixtureId: `fixture-${digest.slice(0, 16)}`,
    variant:
      run.rekeyAtStage === undefined ? "stationary" : `rekey-stage-${String(run.rekeyAtStage)}`,
  };
}

function resolveRun(
  id: string,
  run: AuthoredRun,
  manifest: ExperimentManifest,
  repositoryRoot: string,
): ResolvedRun {
  if (!(run.model in manifest.models))
    throw new Error(`runs.${id}.model references unknown model ${run.model}.`);
  const releaseOffsetsMs = run.releases.map((duration, index) =>
    parseDuration(duration, `runs.${id}.releases[${String(index)}]`),
  );
  const cutoffMs = parseDuration(run.cutoff, `runs.${id}.cutoff`);
  validateRunSchedule(releaseOffsetsMs, cutoffMs, releaseOffsetsMs.length, `runs.${id}`);
  if (run.rekeyAtStage !== undefined && run.rekeyAtStage > releaseOffsetsMs.length) {
    throw new Error(
      `runs.${id}.rekeyAtStage exceeds its ${String(releaseOffsetsMs.length)} stages.`,
    );
  }
  const agentIds = generateAgentIds(run.agents);
  const identity = fixtureIdentity(run, repositoryRoot);
  const packagePath = `artifacts/fixtures/${identity.fixtureId}`;
  return {
    id,
    fixture: {
      ...identity,
      packagePath,
      packageRoot: containedPath(repositoryRoot, packagePath, `runs.${id}.packagePath`),
      source: run.source,
      rekeyAtStage: run.rekeyAtStage ?? null,
    },
    assignment: Object.fromEntries(agentIds.map((agentId) => [agentId, run.model])),
    capabilities:
      run.communication === "shared"
        ? { git: "shared", teamRoom: "enabled" }
        : { git: "isolated", teamRoom: "disabled" },
    schedule: { releaseOffsetsMs, cutoffMs },
    limits: {
      tokenLimitPerAgent: run.tokenLimitPerAgent ?? null,
      spendCeilingCents: run.spendCeilingCents,
    },
    labels: {
      source: run.source,
      communication: run.communication,
      keying: run.rekeyAtStage === undefined ? "stationary" : "rekey",
      tokenPolicy: run.tokenLimitPerAgent === undefined ? "unlimited" : "limited",
    },
  };
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => deepFreeze(child, seen));
  return Object.freeze(value);
}

export function resolveExperiment(
  value: unknown,
  repositoryRoot = resolve("."),
): ResolvedExperiment {
  const manifest = structuredClone(validateExperimentManifest(value));
  const root = resolve(repositoryRoot);
  const providers: Record<string, ProviderConnection> = {};
  const models = Object.fromEntries(
    Object.entries(manifest.models).map(([id, model]) => {
      providers[model.provider] ??= {
        driver: model.provider,
        apiKeyEnv: CREDENTIAL_ENV[model.provider],
      };
      const providerOptions =
        model.reasoningEffort === undefined
          ? {}
          : { [model.provider]: { reasoningEffort: model.reasoningEffort } };
      return [id, { provider: model.provider, model: model.model, settings: {}, providerOptions }];
    }),
  );
  const runs = Object.entries(manifest.runs).map(([id, run]) =>
    resolveRun(id, run, manifest, root),
  );
  const totalSpendCeilingCents = runs.reduce((total, run) => {
    const next = total + run.limits.spendCeilingCents;
    if (!Number.isSafeInteger(next))
      throw new Error("The sum of run spend ceilings must be a safe integer.");
    return next;
  }, 0);
  return deepFreeze({
    schemaVersion: 1,
    name: manifest.name,
    providers,
    models,
    totalSpendCeilingCents,
    runs,
    manifestDigest: createHash("sha256").update(canonicalJson(manifest)).digest("hex"),
  });
}

export function validateRunAgainstFixture(
  run: RunDeclaration | ResolvedRun,
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
    throw new Error(`Run ${run.id} references unknown fixture realization ${run.fixture.variant}.`);
  }
  validateRunSchedule(
    run.schedule.releaseOffsetsMs,
    run.schedule.cutoffMs,
    fixture.stageCount,
    `Run ${run.id} schedule`,
  );
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
