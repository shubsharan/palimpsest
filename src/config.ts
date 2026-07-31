import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import studySchema from "../experiments/schema.json" with { type: "json" };
import { hashProtocolSnapshot, type ConditionId } from "./condition.js";
import type { AgentId } from "./model.js";
import type { TeamChannelMode } from "./team-channel.js";

export type ProviderDriver = "openai" | "anthropic" | "google" | "openai-compatible";
export type StudyPhase = "calibration" | "validation";

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

export interface StudyModelDeclaration {
  provider: string;
  model: string;
  settings?: CommonModelSettings;
  providerOptions?: Record<string, JsonValue>;
}

export interface StudyBlock {
  blockId: string;
  phase: StudyPhase;
  sourcePath: string;
}

export interface AgentModelAssignment {
  agentId: AgentId;
  modelProfileId: string;
}

export interface StudySchedule {
  releaseOffsetsMs: number[];
  cutoffMs: number;
}

export interface StudyBudgets {
  tokenBudgetPerAgent: number | null;
  perAttemptMonetaryCeilingCents: number;
  totalTokenCeiling: number | null;
  totalMonetaryCeilingCents: number;
}

export interface StudyOrders {
  calibration: ConditionId[];
  validation: ConditionId[][];
}

export interface StudyScoring {
  primaryMetricId: "normalized-positional-word-v1";
  diagnosticMetricId: "palimpsest-diagnostics-v1";
  evaluationPolicyId: "all-canonical-main-snapshots-v1";
}

export interface StudyChecking {
  feedbackId: "published-runnability-coverage-v1";
}

export interface StudyRubric {
  rubricId: string;
  path: string;
  sha256: string;
}

export type AdjustableStudyField =
  | "budgets.tokenBudgetPerAgent"
  | "budgets.perAttemptMonetaryCeilingCents";

export interface StudyFailurePolicy {
  stopOnInfrastructureFailure: true;
  automaticRetry: false;
  replacement: "explicit-appended";
  eligibleClassification: "session-infrastructure-error";
}

export interface StudyCommunication {
  teamChannel: TeamChannelMode;
}

export interface StudyManifest {
  schemaVersion: 5;
  communication: StudyCommunication;
  blocks: StudyBlock[];
  assignment: AgentModelAssignment[];
  providers: Record<string, ProviderConnection>;
  models: Record<string, StudyModelDeclaration>;
  schedule: StudySchedule;
  budgets: StudyBudgets;
  orders: StudyOrders;
  checking: StudyChecking;
  scoring: StudyScoring;
  rubric: StudyRubric;
  adjustableFields: AdjustableStudyField[];
  failurePolicy: StudyFailurePolicy;
}

export type ImmutableStudyManifest = Omit<StudyManifest, "budgets"> & {
  budgets: Pick<StudyBudgets, "totalTokenCeiling" | "totalMonetaryCeilingCents">;
};

export interface PlannedStudyCell {
  cellId: string;
  phase: StudyPhase;
  blockId: string;
  condition: ConditionId;
  conditionOrderPosition: number;
  phasePosition: number;
}

export interface ResolvedStudy {
  schemaVersion: 5;
  communication: Readonly<StudyCommunication>;
  blocks: readonly StudyBlock[];
  assignment: readonly AgentModelAssignment[];
  providers: Readonly<Record<string, ProviderConnection>>;
  models: Readonly<Record<string, ModelProfile>>;
  schedule: {
    releaseOffsetsMs: readonly number[];
    cutoffMs: number;
  };
  budgets: Readonly<StudyBudgets>;
  orders: {
    calibration: readonly ConditionId[];
    validation: readonly (readonly ConditionId[])[];
  };
  checking: Readonly<StudyChecking>;
  scoring: Readonly<StudyScoring>;
  rubric: Readonly<StudyRubric>;
  rubricPath: string;
  adjustableFields: readonly [
    "budgets.tokenBudgetPerAgent",
    "budgets.perAttemptMonetaryCeilingCents",
  ];
  failurePolicy: Readonly<StudyFailurePolicy>;
  calibrationCells: readonly PlannedStudyCell[];
  validationCells: readonly PlannedStudyCell[];
  manifestDigest: string;
  immutableManifestDigest: string;
  immutableManifest: ImmutableStudyManifest;
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
const validateSchema: ValidateFunction = ajv.compile(studySchema);

const EXPECTED_BLOCKS = [
  {
    blockId: "calibration-odd-women",
    phase: "calibration",
    sourcePath: "fixtures/chronicles-of-break-oday.txt",
  },
  {
    blockId: "validation-pointed-firs",
    phase: "validation",
    sourcePath: "fixtures/367-h.htm",
  },
  {
    blockId: "validation-custom-country",
    phase: "validation",
    sourcePath: "fixtures/pg11052.txt",
  },
  {
    blockId: "validation-woodlanders",
    phase: "validation",
    sourcePath: "fixtures/pg482.txt",
  },
  {
    blockId: "validation-silas-lapham",
    phase: "validation",
    sourcePath: "fixtures/pg154.txt",
  },
] as const satisfies readonly StudyBlock[];

const EXPECTED_CALIBRATION_ORDER = ["CS", "CR", "IR", "IS"] as const;
const EXPECTED_VALIDATION_ORDERS = [
  ["CS", "CR", "IR", "IS"],
  ["CR", "IS", "CS", "IR"],
  ["IS", "IR", "CR", "CS"],
  ["IR", "CS", "IS", "CR"],
] as const;
const EXPECTED_ADJUSTABLE_FIELDS = [
  "budgets.tokenBudgetPerAgent",
  "budgets.perAttemptMonetaryCeilingCents",
] as const;
const PLANNED_CALIBRATION_CELL_COUNT = 4;
const AGENT_COUNT = 3;

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

export function parseStudyYaml(source: string): unknown {
  const document = parseDocument(source, {
    schema: "core",
    merge: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`Study YAML is invalid: ${document.errors[0]!.message}`);
  }
  try {
    return document.toJS({ json: true, maxAliasCount: 0 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Study YAML is invalid: ${detail}`);
  }
}

export function validateStudyManifest(value: unknown): StudyManifest {
  if (!validateSchema(value)) {
    const errors = validateSchema.errors?.map(structuralError).join("; ") ?? "unknown error";
    throw new Error(`Study manifest is invalid: ${errors}`);
  }
  return value as StudyManifest;
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

export function validateRunSchedule(
  releaseOffsetsMs: readonly number[],
  cutoffMs: number,
  expectedStageCount = 6,
  path = "schedule",
): void {
  if (releaseOffsetsMs.length !== expectedStageCount) {
    throw new Error(
      `${path}.releaseOffsetsMs must contain exactly ${String(expectedStageCount)} stage offsets.`,
    );
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

function equalJson(left: unknown, right: unknown): boolean {
  return hashProtocolSnapshot(left) === hashProtocolSnapshot(right);
}

function assertExactProtocol(config: StudyManifest): void {
  if (!equalJson(config.blocks, EXPECTED_BLOCKS)) {
    throw new Error("Study manifest blocks must match the exact registered five-block order.");
  }
  if (
    !equalJson(config.orders.calibration, EXPECTED_CALIBRATION_ORDER) ||
    !equalJson(config.orders.validation, EXPECTED_VALIDATION_ORDERS)
  ) {
    throw new Error("Study manifest condition orders must match the exact frozen matrix.");
  }
  validateRunSchedule(config.schedule.releaseOffsetsMs, config.schedule.cutoffMs);
  if (!equalJson(config.adjustableFields, EXPECTED_ADJUSTABLE_FIELDS)) {
    throw new Error("Study manifest adjustableFields must contain exactly the two budget paths.");
  }
}

function assertReferences(config: StudyManifest): void {
  for (const [name, provider] of Object.entries(config.providers)) {
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
  for (const [name, model] of Object.entries(config.models)) {
    if (!(model.provider in config.providers)) {
      throw new Error(`models.${name}.provider references unknown provider ${model.provider}.`);
    }
    validateProviderOptions(model.providerOptions ?? {}, `models.${name}.providerOptions`);
  }
  for (const [index, assignment] of config.assignment.entries()) {
    if (!(assignment.modelProfileId in config.models)) {
      throw new Error(
        `assignment[${String(index)}].modelProfileId references unknown model profile ${assignment.modelProfileId}.`,
      );
    }
  }
}

function multiplyAuthorization(left: number, right: number, path: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${path} must be a safe integer.`);
  }
  return value;
}

function assertAuthorizationCeilings(config: StudyManifest): void {
  const tokenBudget =
    config.budgets.tokenBudgetPerAgent === null
      ? null
      : safeInteger(config.budgets.tokenBudgetPerAgent, "budgets.tokenBudgetPerAgent", 1);
  const attemptMoney = safeInteger(
    config.budgets.perAttemptMonetaryCeilingCents,
    "budgets.perAttemptMonetaryCeilingCents",
  );
  const totalTokens =
    config.budgets.totalTokenCeiling === null
      ? null
      : safeInteger(config.budgets.totalTokenCeiling, "budgets.totalTokenCeiling", 1);
  const totalMoney = safeInteger(
    config.budgets.totalMonetaryCeilingCents,
    "budgets.totalMonetaryCeilingCents",
  );
  if ((tokenBudget === null) !== (totalTokens === null)) {
    throw new Error(
      "budgets.tokenBudgetPerAgent and budgets.totalTokenCeiling must both be numeric or both be null.",
    );
  }
  const authorizedTokens =
    tokenBudget === null
      ? null
      : multiplyAuthorization(
          multiplyAuthorization(tokenBudget, AGENT_COUNT, "Primary authorized token total"),
          PLANNED_CALIBRATION_CELL_COUNT,
          "Primary authorized token total",
        );
  const authorizedMoney = multiplyAuthorization(
    attemptMoney,
    PLANNED_CALIBRATION_CELL_COUNT,
    "Primary authorized monetary total",
  );
  if (authorizedTokens !== null && totalTokens !== null && authorizedTokens > totalTokens) {
    throw new Error(
      `budgets.totalTokenCeiling must cover the ${String(authorizedTokens)}-token primary authorization.`,
    );
  }
  if (authorizedMoney > totalMoney) {
    throw new Error(
      `budgets.totalMonetaryCeilingCents must cover the ${String(authorizedMoney)}-cent primary authorization.`,
    );
  }
}

function assertSemanticRelationships(config: StudyManifest): void {
  assertExactProtocol(config);
  assertReferences(config);
  assertAuthorizationCeilings(config);
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

function cloneModels(models: Record<string, StudyModelDeclaration>): Record<string, ModelProfile> {
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

function cellsFor(
  phase: StudyPhase,
  blocks: readonly StudyBlock[],
  orders: readonly (readonly ConditionId[])[],
): PlannedStudyCell[] {
  let phasePosition = 0;
  return blocks.flatMap((block, blockIndex) =>
    orders[blockIndex]!.map((condition, conditionIndex) => {
      phasePosition += 1;
      return {
        cellId: `${phase}-${String(phasePosition)}-${block.blockId}-${condition}`,
        phase,
        blockId: block.blockId,
        condition,
        conditionOrderPosition: conditionIndex + 1,
        phasePosition,
      };
    }),
  );
}

function immutableProjection(manifest: StudyManifest): ImmutableStudyManifest {
  return {
    ...structuredClone(manifest),
    budgets: {
      totalTokenCeiling: manifest.budgets.totalTokenCeiling,
      totalMonetaryCeilingCents: manifest.budgets.totalMonetaryCeilingCents,
    },
  };
}

function rubricPath(repositoryRoot: string, configuredPath: string): string {
  if (isAbsolute(configuredPath)) {
    throw new Error("rubric.path must be relative to the repository.");
  }
  const path = resolve(repositoryRoot, configuredPath);
  const difference = relative(repositoryRoot, path);
  if (
    difference.length === 0 ||
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  ) {
    throw new Error("rubric.path must remain inside the repository.");
  }
  return path;
}

async function verifyRubric(repositoryRoot: string, rubric: StudyRubric): Promise<string> {
  const path = rubricPath(repositoryRoot, rubric.path);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`rubric.path could not be read: ${detail}`);
  }
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (actualDigest !== rubric.sha256) {
    throw new Error("Study rubric digest does not match the declared rubric bytes.");
  }
  return path;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export async function resolveStudy(
  value: unknown,
  repositoryRoot = resolve("."),
): Promise<ResolvedStudy> {
  const manifest = structuredClone(validateStudyManifest(value));
  assertSemanticRelationships(manifest);
  const root = resolve(repositoryRoot);
  const resolvedRubricPath = await verifyRubric(root, manifest.rubric);
  const immutableManifest = immutableProjection(manifest);
  const calibrationBlocks = manifest.blocks.filter((block) => block.phase === "calibration");
  const validationBlocks = manifest.blocks.filter((block) => block.phase === "validation");
  const calibrationCells = cellsFor("calibration", calibrationBlocks, [
    manifest.orders.calibration,
  ]);
  const validationCells = cellsFor("validation", validationBlocks, manifest.orders.validation);

  return deepFreeze({
    schemaVersion: 5,
    communication: { ...manifest.communication },
    blocks: manifest.blocks.map((block) => ({ ...block })),
    assignment: manifest.assignment.map((assignment) => ({ ...assignment })),
    providers: Object.fromEntries(
      Object.entries(manifest.providers).map(([name, provider]) => [name, cloneProvider(provider)]),
    ),
    models: cloneModels(manifest.models),
    schedule: {
      releaseOffsetsMs: [...manifest.schedule.releaseOffsetsMs],
      cutoffMs: manifest.schedule.cutoffMs,
    },
    budgets: { ...manifest.budgets },
    orders: {
      calibration: [...manifest.orders.calibration],
      validation: manifest.orders.validation.map((order) => [...order]),
    },
    checking: { ...manifest.checking },
    scoring: { ...manifest.scoring },
    rubric: { ...manifest.rubric },
    rubricPath: resolvedRubricPath,
    adjustableFields: [...EXPECTED_ADJUSTABLE_FIELDS],
    failurePolicy: { ...manifest.failurePolicy },
    calibrationCells,
    validationCells,
    manifestDigest: hashProtocolSnapshot(manifest),
    immutableManifestDigest: hashProtocolSnapshot(immutableManifest),
    immutableManifest,
  });
}

export function expandPhase(study: ResolvedStudy, phase: StudyPhase): readonly PlannedStudyCell[] {
  return phase === "calibration" ? study.calibrationCells : study.validationCells;
}

export async function loadStudyManifest(path: string): Promise<StudyManifest> {
  return validateStudyManifest(parseStudyYaml(await readFile(path, "utf8")));
}

export async function loadResolvedStudy(
  path: string,
  repositoryRoot = resolve("."),
): Promise<ResolvedStudy> {
  return resolveStudy(await loadStudyManifest(path), repositoryRoot);
}
