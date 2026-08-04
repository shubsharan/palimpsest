import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { parse } from "yaml";

import { canonicalJson, contentDigest } from "../canonical.js";
import type { JsonObject, JsonValue } from "../model/contracts.js";
import { runPythonJson } from "../python.js";
import {
  decodeRunRecord,
  type PerformanceRunAnalysis,
  type ProcessReviewRunAnalysis,
  type RunRecord,
} from "../run/record.js";
import {
  decodeBehaviorReport,
  decodeQuantitativeMeasure,
  decodeRunScorecard,
  type BehaviorReport,
  type QuantitativeMeasure,
  type RunScorecard,
} from "./contracts.js";
import { compileEvidence } from "./evidence.js";

const CONTROLLED_ID = /^[a-z0-9][a-z0-9._-]*$/;

export interface ReportConfiguration {
  readonly schemaVersion: 1;
  readonly claimType: "descriptive" | "matched-contrast";
  readonly include: {
    readonly runIds: readonly string[];
    readonly labels: JsonObject;
  };
  readonly versions: {
    readonly grader: string;
    readonly rubric: string;
    readonly reviewProtocol?: string;
  };
  readonly matchingFields: readonly string[];
  readonly treatmentField?: string;
  readonly experimentalUnit: "team" | "origin";
  readonly clusterBy: "run";
}

export interface ReportRunsOptions {
  readonly root: string;
  readonly artifactsRoot: string;
  readonly configPath: string;
  readonly output: string;
  readonly now?: () => Date;
}

export interface ReportRunsResult {
  readonly reportId: string;
  readonly claimType: "descriptive" | "matched-contrast";
  readonly includedRunCount: number;
  readonly excludedRunCount: number;
  readonly path: string;
  readonly report: BehaviorReport;
}

interface EligibleRun {
  readonly runRoot: string;
  readonly relativeRunRoot: string;
  readonly record: RunRecord;
  readonly performance: PerformanceRunAnalysis;
  readonly review: ProcessReviewRunAnalysis;
  readonly metrics: readonly PerformanceMeasureGroup[];
  readonly scorecards: readonly RunScorecard[];
}

interface PerformanceMeasureGroup {
  readonly originId: string;
  readonly values: readonly QuantitativeMeasure[];
}

interface ExcludedRun {
  readonly runRoot: string;
  readonly relativeRunRoot: string;
  readonly runId?: string;
  readonly reasonCode: string;
  readonly reason: string;
}

interface AggregateScalar {
  readonly measureId: string;
  readonly state: "observed" | "unavailable" | "not-applicable";
  readonly value?: number;
  readonly reason?: string;
}

interface AggregateDimension {
  readonly dimensionId: string;
  readonly state: "rated" | "unobservable" | "not-applicable";
  readonly rating?: number;
  readonly reason?: string;
}

interface AggregateReview {
  readonly reviewerId: string;
  readonly dimensions: readonly AggregateDimension[];
}

interface AggregateScorecard {
  readonly runId: string;
  readonly originId: string;
  readonly clusterId: string;
  readonly outcomes: readonly AggregateScalar[];
  readonly processMeasures: readonly AggregateScalar[];
  readonly reviews: readonly AggregateReview[];
}

interface TreatmentAggregate {
  readonly treatment: JsonValue;
  readonly aggregate: Record<string, unknown>;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  name: string,
): Record<string, unknown> {
  const decoded = object(value, name);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((field) => !(field in decoded)) ||
    Object.keys(decoded).some((field) => !allowed.has(field))
  ) {
    throw new Error(`${name} contains unknown or missing fields.`);
  }
  return decoded;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function controlledId(value: unknown, name: string): string {
  const decoded = text(value, name);
  if (!CONTROLLED_ID.test(decoded)) throw new Error(`${name} must be a controlled identifier.`);
  return decoded;
}

function jsonValue(value: unknown, name: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${name}[${index}]`));
  const decoded = object(value, name);
  return Object.fromEntries(
    Object.entries(decoded).map(([key, item]) => [key, jsonValue(item, `${name}.${key}`)]),
  );
}

function jsonObject(value: unknown, name: string): JsonObject {
  const decoded = object(value, name);
  return Object.fromEntries(
    Object.entries(decoded).map(([key, item]) => [key, jsonValue(item, `${name}.${key}`)]),
  );
}

function jsonPointer(value: unknown, name: string): string {
  const decoded = text(value, name);
  if (!decoded.startsWith("/") || /~(?:[^01]|$)/.test(decoded)) {
    throw new Error(`${name} must be a valid non-root JSON Pointer.`);
  }
  return decoded;
}

function strings(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.map((item, index) => controlledId(item, `${name}[${index}]`));
}

function unique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${name} must be unique.`);
}

const MATERIAL_INPUT_POINTERS = [
  "/configuration/models",
  "/configuration/run/assignment",
  "/configuration/run/capabilities",
  "/configuration/run/fixture/id",
  "/configuration/run/fixture/constructionId",
  "/configuration/run/fixture/buildId",
  "/configuration/run/fixture/digest",
  "/configuration/run/fixture/variant",
  "/configuration/run/fixture/source",
  "/configuration/run/fixture/rekeyAtStage",
  "/configuration/run/limits",
  "/configuration/run/schedule",
] as const;

function isMaterialInputPointer(pointer: string): boolean {
  return MATERIAL_INPUT_POINTERS.some(
    (prefix) => pointer === prefix || pointer.startsWith(`${prefix}/`),
  );
}

export function decodeReportConfiguration(
  value: unknown,
  name = "Report configuration",
): ReportConfiguration {
  const decoded = fields(
    value,
    ["schemaVersion", "claimType", "include", "versions", "experimentalUnit", "clusterBy"],
    ["matchingFields", "treatmentField"],
    name,
  );
  if (decoded.schemaVersion !== 1) throw new Error(`${name}.schemaVersion is unsupported.`);
  if (decoded.claimType !== "descriptive" && decoded.claimType !== "matched-contrast") {
    throw new Error(`${name}.claimType is invalid.`);
  }
  const include = fields(decoded.include, ["runIds", "labels"], [], `${name}.include`);
  const runIds = strings(include.runIds, `${name}.include.runIds`);
  unique(runIds, `${name}.include.runIds`);
  const versions = fields(
    decoded.versions,
    ["grader", "rubric"],
    ["reviewProtocol"],
    `${name}.versions`,
  );
  if (decoded.experimentalUnit !== "team" && decoded.experimentalUnit !== "origin") {
    throw new Error(`${name}.experimentalUnit must be team or origin.`);
  }
  if (decoded.clusterBy !== "run") throw new Error(`${name}.clusterBy must be run.`);
  const matchingFields =
    decoded.matchingFields === undefined
      ? []
      : (() => {
          if (!Array.isArray(decoded.matchingFields)) {
            throw new Error(`${name}.matchingFields must be an array.`);
          }
          return decoded.matchingFields.map((item, index) =>
            jsonPointer(item, `${name}.matchingFields[${index}]`),
          );
        })();
  unique(matchingFields, `${name}.matchingFields`);
  const treatmentField =
    decoded.treatmentField === undefined
      ? undefined
      : jsonPointer(decoded.treatmentField, `${name}.treatmentField`);
  if (
    decoded.claimType === "matched-contrast" &&
    (matchingFields.length === 0 || treatmentField === undefined)
  ) {
    throw new Error(`${name} matched contrasts require matchingFields and treatmentField.`);
  }
  if (
    decoded.claimType === "descriptive" &&
    (matchingFields.length > 0 || treatmentField !== undefined)
  ) {
    throw new Error(`${name} descriptive reports cannot declare matchingFields or treatmentField.`);
  }
  if (treatmentField !== undefined && matchingFields.includes(treatmentField)) {
    throw new Error(`${name}.treatmentField cannot also be a matching field.`);
  }
  if (
    decoded.claimType === "matched-contrast" &&
    matchingFields.some((pointer) => !isMaterialInputPointer(pointer))
  ) {
    throw new Error(`${name}.matchingFields must name material run inputs.`);
  }
  if (treatmentField !== undefined && !isMaterialInputPointer(treatmentField)) {
    throw new Error(`${name}.treatmentField must name a genuine material run input.`);
  }
  return {
    schemaVersion: 1,
    claimType: decoded.claimType,
    include: {
      runIds,
      labels: jsonObject(include.labels, `${name}.include.labels`),
    },
    versions: {
      grader: controlledId(versions.grader, `${name}.versions.grader`),
      rubric: controlledId(versions.rubric, `${name}.versions.rubric`),
      ...(versions.reviewProtocol === undefined
        ? {}
        : {
            reviewProtocol: controlledId(
              versions.reviewProtocol,
              `${name}.versions.reviewProtocol`,
            ),
          }),
    },
    matchingFields,
    ...(treatmentField === undefined ? {} : { treatmentField }),
    experimentalUnit: decoded.experimentalUnit,
    clusterBy: "run",
  };
}

export async function loadReportConfiguration(path: string): Promise<ReportConfiguration> {
  let value: unknown;
  try {
    value = parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Report configuration ${path} is invalid YAML: ${detail}`);
  }
  return decodeReportConfiguration(value);
}

function isContained(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference);
}

async function physicalFuturePath(path: string): Promise<string> {
  let existing = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try {
      await lstat(existing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      missing.push(basename(existing));
      existing = parent;
    }
  }
  return resolve(await realpath(existing), ...missing.reverse());
}

async function discoverRunRoots(artifactsRoot: string): Promise<readonly string[]> {
  const root = await realpath(resolve(artifactsRoot));
  if (!(await stat(root)).isDirectory()) throw new Error("Artifacts root must be a directory.");
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    if (!isContained(root, directory)) throw new Error("Run discovery escaped the artifacts root.");
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    const runRecord = entries.find((entry) => entry.name === "run.json");
    if (runRecord?.isFile()) {
      result.push(directory);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      await visit(join(directory, entry.name));
    }
  }
  await visit(root);
  return result;
}

function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/") || ".";
}

function matchesInclusion(record: RunRecord, config: ReportConfiguration): string | undefined {
  if (config.include.runIds.length > 0 && !config.include.runIds.includes(record.runId)) {
    return "Run ID is not selected by include.runIds.";
  }
  for (const [key, expected] of Object.entries(config.include.labels)) {
    const actual = record.configuration.run.labels[key];
    if (actual === undefined || canonicalJson(actual) !== canonicalJson(expected)) {
      return `Run label ${key} does not match the inclusion filter.`;
    }
  }
  return undefined;
}

function selectAnalyses(
  record: RunRecord,
  config: ReportConfiguration,
):
  | { readonly performance: PerformanceRunAnalysis; readonly review: ProcessReviewRunAnalysis }
  | { readonly reasonCode: string; readonly reason: string } {
  if (record.status !== "completed") {
    return { reasonCode: "run-not-completed", reason: `Run status is ${record.status}.` };
  }
  const performances = record.analyses.filter(
    (analysis): analysis is PerformanceRunAnalysis => analysis.kind === "performance",
  );
  const compatiblePerformances = performances.filter(
    (analysis) => analysis.graderVersion === config.versions.grader,
  );
  if (compatiblePerformances.length === 0) {
    return performances.length === 0
      ? { reasonCode: "missing-performance-analysis", reason: "No performance analysis exists." }
      : {
          reasonCode: "incompatible-grader-version",
          reason: `No performance analysis uses grader ${config.versions.grader}.`,
        };
  }
  const reviews = record.analyses.filter(
    (analysis): analysis is ProcessReviewRunAnalysis => analysis.kind === "process-review",
  );
  const candidates = reviews.filter(
    (review) =>
      review.rubricVersion === config.versions.rubric &&
      (config.versions.reviewProtocol === undefined ||
        review.protocolVersion === config.versions.reviewProtocol) &&
      compatiblePerformances.some(
        (performance) => performance.analysisId === review.performanceAnalysisId,
      ),
  );
  const completed = candidates.filter((review) => review.status === "completed");
  if (completed.length === 0) {
    if (candidates.some((review) => review.status === "incomplete")) {
      return {
        reasonCode: "incomplete-process-review",
        reason:
          "The compatible process review is incomplete and has no findings-bearing scorecard.",
      };
    }
    if (
      reviews.length > 0 &&
      reviews.every((review) => review.rubricVersion !== config.versions.rubric)
    ) {
      return {
        reasonCode: "incompatible-rubric-version",
        reason: `No process review uses rubric ${config.versions.rubric}.`,
      };
    }
    return {
      reasonCode: "missing-process-review",
      reason: "No completed process review references a compatible performance analysis.",
    };
  }
  if (completed.length > 1) {
    return {
      reasonCode: "ambiguous-process-review",
      reason: "More than one completed compatible process review exists.",
    };
  }
  const review = completed[0]!;
  const performance = compatiblePerformances.find(
    (candidate) => candidate.analysisId === review.performanceAnalysisId,
  )!;
  return { performance, review };
}

async function containedFile(root: string, path: string, name: string): Promise<string> {
  const resolvedRoot = await realpath(resolve(root));
  const candidate = resolve(resolvedRoot, path);
  if (!isContained(resolvedRoot, candidate)) throw new Error(`${name} escapes its run root.`);
  const actual = await realpath(candidate);
  if (!isContained(resolvedRoot, actual)) throw new Error(`${name} resolves outside its run root.`);
  if (!(await stat(actual)).isFile()) throw new Error(`${name} must be a regular file.`);
  return actual;
}

async function readMetrics(
  runRoot: string,
  performance: PerformanceRunAnalysis,
  originIds: readonly string[],
): Promise<readonly PerformanceMeasureGroup[]> {
  const manifestPath = await containedFile(
    runRoot,
    performance.detailsPath,
    "Performance detail manifest",
  );
  const manifestValue = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  const manifest = fields(
    manifestValue,
    [
      "schemaVersion",
      "kind",
      "analysisId",
      "graderVersion",
      "configurationDigest",
      "sourceDigest",
      "evidence",
      "metrics",
      "origins",
    ],
    [],
    "Performance detail manifest",
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "performance" ||
    manifest.analysisId !== performance.analysisId ||
    manifest.graderVersion !== performance.graderVersion ||
    manifest.configurationDigest !== performance.configurationDigest ||
    manifest.sourceDigest !== performance.sourceDigest ||
    contentDigest(manifestValue) !== performance.detailsDigest
  ) {
    throw new Error("Performance detail manifest differs from its run analysis reference.");
  }
  const metricsReference = fields(
    manifest.metrics,
    ["path", "contentDigest"],
    [],
    "Performance detail manifest metrics",
  );
  if (metricsReference.path !== "metrics.json") {
    throw new Error("Performance detail manifest must identify metrics.json.");
  }
  const metricsPath = join(dirname(performance.detailsPath), "metrics.json");
  const path = await containedFile(runRoot, metricsPath, "Performance metrics");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Performance metrics are invalid JSON: ${detail}`);
  }
  if (metricsReference.contentDigest !== contentDigest(value)) {
    throw new Error("Performance metrics digest differs from its detail manifest.");
  }
  const decoded = fields(value, ["schemaVersion", "kind", "measures"], [], "Performance metrics");
  if (
    decoded.schemaVersion !== 1 ||
    decoded.kind !== "measure" ||
    !Array.isArray(decoded.measures)
  ) {
    throw new Error("Performance metrics have an unsupported schema or kind.");
  }
  const measures = decoded.measures.map((item, groupIndex): PerformanceMeasureGroup => {
    const group = fields(
      item,
      ["originId", "values"],
      [],
      `Performance metrics group ${groupIndex + 1}`,
    );
    const originId = controlledId(
      group.originId,
      `Performance metrics group ${groupIndex + 1}.originId`,
    );
    if (!Array.isArray(group.values)) {
      throw new Error(`Performance metrics group ${groupIndex + 1}.values must be an array.`);
    }
    const values = group.values.map((measure, measureIndex) =>
      decodeQuantitativeMeasure(
        measure,
        `Performance metrics group ${groupIndex + 1} value ${measureIndex + 1}`,
      ),
    );
    return { originId, values };
  });
  if (
    measures.length !== originIds.length ||
    measures.some(({ originId }, index) => originId !== originIds[index])
  ) {
    throw new Error("Performance metrics must cover canonical origins exactly once in order.");
  }
  return measures;
}

async function readScorecards(
  runRoot: string,
  review: ProcessReviewRunAnalysis,
  runId: string,
  originIds: readonly string[],
): Promise<readonly RunScorecard[]> {
  const manifestPath = await containedFile(runRoot, review.detailsPath, "Process detail manifest");
  const manifestValue = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  const manifest = fields(manifestValue, ["schemaVersion", "files"], [], "Process detail manifest");
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.files) ||
    contentDigest(manifestValue) !== review.detailsDigest
  ) {
    throw new Error("Process detail manifest differs from its run analysis reference.");
  }
  const scorecardEntries = manifest.files.filter(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).path === "scorecard.json",
  );
  if (scorecardEntries.length !== 1) {
    throw new Error("Process detail manifest must identify scorecard.json exactly once.");
  }
  const scorecardReference = fields(
    scorecardEntries[0],
    ["path", "contentDigest", "byteCount", "role"],
    [],
    "Process detail scorecard entry",
  );
  if (scorecardReference.role !== "run-scorecard") {
    throw new Error("Process detail scorecard entry has an invalid role.");
  }
  const scorecardPath = join(dirname(review.detailsPath), "scorecard.json");
  const path = await containedFile(runRoot, scorecardPath, "Process scorecard");
  let value: unknown;
  let bytes: string;
  try {
    bytes = await readFile(path, "utf8");
    value = JSON.parse(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Process scorecard is invalid JSON: ${detail}`);
  }
  if (
    scorecardReference.contentDigest !== contentDigest(value) ||
    scorecardReference.byteCount !== Buffer.byteLength(bytes)
  ) {
    throw new Error("Process scorecard bytes differ from its detail manifest.");
  }
  if (!Array.isArray(value)) throw new Error("Process scorecard must be an ordered array.");
  const scorecards = value.map((item, index) =>
    decodeRunScorecard(item, `Process scorecard ${index + 1}`),
  );
  if (
    scorecards.length !== originIds.length ||
    scorecards.some(
      (scorecard, index) =>
        scorecard.runId !== runId ||
        scorecard.canonicalOrigins.length !== 1 ||
        scorecard.canonicalOrigins[0]!.originId !== originIds[index] ||
        scorecard.canonicalOrigins[0]!.status !== "eligible" ||
        scorecard.eligibility.status !== "completed",
    )
  ) {
    throw new Error("Process scorecards must cover canonical origins exactly once in order.");
  }
  return scorecards;
}

async function resolveEligibility(
  root: string,
  artifactsRoot: string,
  runRoots: readonly string[],
  config: ReportConfiguration,
): Promise<{
  readonly eligible: readonly EligibleRun[];
  readonly excluded: readonly ExcludedRun[];
}> {
  const eligible: EligibleRun[] = [];
  const excluded: ExcludedRun[] = [];
  for (const runRoot of runRoots) {
    const relativeRunRoot = relativePath(artifactsRoot, runRoot);
    let record: RunRecord;
    try {
      record = decodeRunRecord(JSON.parse(await readFile(join(runRoot, "run.json"), "utf8")));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      excluded.push({
        runRoot,
        relativeRunRoot,
        reasonCode: "invalid-run-record",
        reason: detail,
      });
      continue;
    }
    const inclusionReason = matchesInclusion(record, config);
    if (inclusionReason !== undefined) {
      excluded.push({
        runRoot,
        relativeRunRoot,
        runId: record.runId,
        reasonCode: "not-included",
        reason: inclusionReason,
      });
      continue;
    }
    const expectedMode = config.experimentalUnit === "team" ? "shared" : "isolated";
    if (record.topology.communicationMode !== expectedMode) {
      excluded.push({
        runRoot,
        relativeRunRoot,
        runId: record.runId,
        reasonCode: "incompatible-experimental-unit",
        reason: `${config.experimentalUnit} units require ${expectedMode} run topology.`,
      });
      continue;
    }
    const analyses = selectAnalyses(record, config);
    if ("reasonCode" in analyses) {
      excluded.push({ runRoot, relativeRunRoot, runId: record.runId, ...analyses });
      continue;
    }
    try {
      const compiled = await compileEvidence({ root, runRoot });
      if (compiled.bundle.sourceDigest !== analyses.performance.sourceDigest) {
        throw new Error(
          "Current frozen run evidence differs from the performance analysis source digest.",
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      excluded.push({
        runRoot,
        relativeRunRoot,
        runId: record.runId,
        reasonCode: "source-integrity-failure",
        reason: detail,
      });
      continue;
    }
    try {
      const recordOrigins = record.topology.origins.map(({ originId }) => originId);
      const [metrics, scorecards] = await Promise.all([
        readMetrics(runRoot, analyses.performance, recordOrigins),
        readScorecards(runRoot, analyses.review, record.runId, recordOrigins),
      ]);
      eligible.push({ runRoot, relativeRunRoot, record, ...analyses, metrics, scorecards });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      excluded.push({
        runRoot,
        relativeRunRoot,
        runId: record.runId,
        reasonCode: "invalid-scorecard",
        reason: detail,
      });
    }
  }
  return { eligible, excluded };
}

function resolvePointer(value: unknown, pointer: string, name: string): JsonValue {
  let current: unknown = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const part = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(part) || Number(part) >= current.length) {
        throw new Error(`${name} does not resolve.`);
      }
      current = current[Number(part)];
    } else if (typeof current === "object" && current !== null && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      throw new Error(`${name} does not resolve.`);
    }
  }
  return jsonValue(current, name);
}

function materialInputs(record: RunRecord): JsonObject {
  const fixture = record.configuration.run.fixture;
  return jsonObject(
    {
      configuration: {
        models: record.configuration.models,
        run: {
          fixture: {
            id: fixture.id,
            constructionId: fixture.constructionId,
            buildId: fixture.buildId,
            digest: fixture.digest,
            variant: fixture.variant,
            ...(fixture.source === undefined ? {} : { source: fixture.source }),
            ...(fixture.rekeyAtStage === undefined ? {} : { rekeyAtStage: fixture.rekeyAtStage }),
          },
          assignment: record.configuration.run.assignment,
          capabilities: {
            ...record.configuration.run.capabilities,
            checker: record.configuration.run.capabilities.checker ?? true,
          },
          schedule: record.configuration.run.schedule,
          limits: record.configuration.run.limits,
        },
      },
    },
    "Material run inputs",
  );
}

function replacePointer(value: JsonObject, pointer: string, replacement: JsonValue): JsonObject {
  const result = JSON.parse(canonicalJson(value)) as JsonObject;
  let current: Record<string, JsonValue> | JsonValue[] = result as Record<string, JsonValue>;
  const parts = pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  for (const [index, part] of parts.entries()) {
    const last = index === parts.length - 1;
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(part) || Number(part) >= current.length) {
        throw new Error(`Treatment field ${pointer} does not resolve in material inputs.`);
      }
      if (last) current[Number(part)] = replacement;
      else {
        const child = current[Number(part)];
        if (typeof child !== "object" || child === null) {
          throw new Error(`Treatment field ${pointer} does not resolve in material inputs.`);
        }
        current = child as Record<string, JsonValue> | JsonValue[];
      }
    } else if (part in current) {
      if (last) current[part] = replacement;
      else {
        const child = current[part];
        if (typeof child !== "object" || child === null) {
          throw new Error(`Treatment field ${pointer} does not resolve in material inputs.`);
        }
        current = child as Record<string, JsonValue> | JsonValue[];
      }
    } else {
      throw new Error(`Treatment field ${pointer} does not resolve in material inputs.`);
    }
  }
  return result;
}

function validateMatchedContrast(
  eligible: readonly EligibleRun[],
  excluded: readonly ExcludedRun[],
  config: ReportConfiguration,
): void {
  if (config.claimType !== "matched-contrast") return;
  const incompatibleVersion = excluded.find((item) =>
    ["incompatible-grader-version", "incompatible-rubric-version"].includes(item.reasonCode),
  );
  if (incompatibleVersion !== undefined) {
    throw new Error(
      `Matched contrast requires compatible analysis versions: ${incompatibleVersion.reason}`,
    );
  }
  if (eligible.length < 2) throw new Error("Matched contrast requires at least two eligible runs.");
  for (const pointer of config.matchingFields) {
    const values = eligible.map(({ record }) =>
      canonicalJson(resolvePointer(record, pointer, `Matching field ${pointer}`)),
    );
    if (new Set(values).size !== 1) {
      throw new Error(`Matched contrast rejected because matching field ${pointer} differs.`);
    }
  }
  const treatmentField = config.treatmentField!;
  const treatments = eligible.map(({ record }) =>
    canonicalJson(resolvePointer(record, treatmentField, `Treatment field ${treatmentField}`)),
  );
  if (new Set(treatments).size < 2) {
    throw new Error("Matched contrast requires at least two distinct treatment values.");
  }
  const matchedInputs = eligible.map(({ record }) =>
    canonicalJson(replacePointer(materialInputs(record), treatmentField, "[declared-treatment]")),
  );
  if (new Set(matchedInputs).size !== 1) {
    throw new Error(
      "Matched contrast rejected because material run inputs differ outside the declared treatment.",
    );
  }
}

function aggregateScalars(value: unknown, name: string): readonly AggregateScalar[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.flatMap<AggregateScalar>((item, index) => {
    const decoded = object(item, `${name}[${index}]`);
    const measureId = controlledId(decoded.measureId, `${name}[${index}].measureId`);
    if (decoded.state === "observed") {
      if (typeof decoded.value !== "number" || !Number.isFinite(decoded.value)) return [];
      return [{ measureId, state: "observed" as const, value: decoded.value }];
    }
    if (decoded.state !== "unavailable" && decoded.state !== "not-applicable") {
      throw new Error(`${name}[${index}].state is invalid.`);
    }
    const eligibility =
      typeof decoded.eligibility === "object" && decoded.eligibility !== null
        ? (decoded.eligibility as Record<string, unknown>).explanation
        : undefined;
    const reason =
      typeof decoded.reason === "string"
        ? decoded.reason
        : typeof eligibility === "string"
          ? eligibility
          : "The scorecard records this measure as missing.";
    return [{ measureId, state: decoded.state, reason }];
  });
}

function aggregateDimensions(value: unknown, name: string): readonly AggregateDimension[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.map((item, index) => {
    const decoded = object(item, `${name}[${index}]`);
    const dimensionId = controlledId(decoded.dimensionId, `${name}[${index}].dimensionId`);
    if (decoded.state === "rated") {
      if (
        !Number.isSafeInteger(decoded.rating) ||
        (decoded.rating as number) < 0 ||
        (decoded.rating as number) > 4
      ) {
        throw new Error(`${name}[${index}].rating must be an integer from 0 through 4.`);
      }
      return { dimensionId, state: "rated" as const, rating: decoded.rating as number };
    }
    if (decoded.state !== "unobservable" && decoded.state !== "not-applicable") {
      throw new Error(`${name}[${index}].state is invalid.`);
    }
    const reason =
      typeof decoded.reason === "string"
        ? decoded.reason
        : typeof decoded.rationale === "string"
          ? decoded.rationale
          : "The reviewer records this dimension as missing.";
    return { dimensionId, state: decoded.state, reason };
  });
}

function aggregateReviews(
  ledgers: readonly Record<string, unknown>[],
  name: string,
): readonly AggregateReview[] {
  const reviews = new Map<string, AggregateDimension[]>();
  for (const [ledgerIndex, ledger] of ledgers.entries()) {
    const value = ledger.reviewers;
    if (!Array.isArray(value)) {
      throw new Error(`${name}[${ledgerIndex}].reviewers must be an array.`);
    }
    for (const [reviewIndex, item] of value.entries()) {
      const decoded = object(item, `${name}[${ledgerIndex}].reviewers[${reviewIndex}]`);
      if (decoded.judge !== 1 && decoded.judge !== 2) {
        throw new Error(`${name}[${ledgerIndex}].reviewers[${reviewIndex}].judge is invalid.`);
      }
      const reviewerId = `judge-${String(decoded.judge)}`;
      const dimensions = aggregateDimensions(
        decoded.dimensions,
        `${name}[${ledgerIndex}].reviewers[${reviewIndex}].dimensions`,
      );
      const existing = reviews.get(reviewerId) ?? [];
      const ids = new Set(existing.map(({ dimensionId }) => dimensionId));
      if (dimensions.some(({ dimensionId }) => ids.has(dimensionId))) {
        throw new Error(`${name} repeats a dimension for reviewer ${reviewerId}.`);
      }
      existing.push(...dimensions);
      reviews.set(reviewerId, existing);
    }
  }
  if (reviews.size !== 2) throw new Error(`${name} must preserve exactly two reviewer views.`);
  return [...reviews]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reviewerId, dimensions]) => ({ reviewerId, dimensions }));
}

function scorecardMeasures(
  ledger: Record<string, unknown>,
  expectedLedger: "epistemic" | "social" | "instrumental",
  name: string,
): readonly QuantitativeMeasure[] {
  if (!Array.isArray(ledger.measures)) {
    throw new Error(`${name}.measures must be an array.`);
  }
  const measures = ledger.measures.map((measure, index) =>
    decodeQuantitativeMeasure(measure, `${name}.measures[${index}]`),
  );
  if (measures.some(({ ledger: measureLedger }) => measureLedger !== expectedLedger)) {
    throw new Error(`${name}.measures must belong to the ${expectedLedger} ledger.`);
  }
  return measures;
}

function uniqueMeasures(
  measures: readonly QuantitativeMeasure[],
  name: string,
): readonly QuantitativeMeasure[] {
  const ids = measures.map(({ measureId }) => measureId);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${name} repeats measure IDs.`);
  }
  return measures;
}

function canonicalMeasures(measures: readonly QuantitativeMeasure[]): string {
  return canonicalJson(
    [...measures].sort((left, right) => left.measureId.localeCompare(right.measureId)),
  );
}

function toAggregateScorecards(run: EligibleRun): readonly AggregateScorecard[] {
  return run.scorecards.map((scorecard, index) => {
    const originId = scorecard.canonicalOrigins[0]!.originId;
    const metricGroup = run.metrics[index]!;
    const processLedgers = [
      {
        id: "epistemic" as const,
        value: object(scorecard.epistemic, "epistemic scorecard ledger"),
      },
      { id: "social" as const, value: object(scorecard.social, "social scorecard ledger") },
      {
        id: "instrumental" as const,
        value: object(scorecard.instrumental, "instrumental scorecard ledger"),
      },
    ];
    const outcomes = aggregateScalars(
      metricGroup.values.filter(({ ledger }) => ledger === "outcome"),
      "outcome measures",
    );
    const immutableProcessMeasures = uniqueMeasures(
      metricGroup.values.filter(({ ledger }) => ledger !== "outcome"),
      `Performance process measures for origin ${originId}`,
    );
    if (immutableProcessMeasures.some(({ basis }) => basis !== "mechanical")) {
      throw new Error(`Performance process measures for origin ${originId} must be mechanical.`);
    }
    const reviewedProcessMeasures = uniqueMeasures(
      processLedgers.flatMap(({ id, value }) =>
        scorecardMeasures(value, id, `${id} scorecard ledger`),
      ),
      `Scorecard process measures for origin ${originId}`,
    );
    const reviewedMechanicalMeasures = reviewedProcessMeasures.filter(
      ({ basis }) => basis === "mechanical",
    );
    if (
      canonicalMeasures(reviewedMechanicalMeasures) !== canonicalMeasures(immutableProcessMeasures)
    ) {
      throw new Error(
        `Scorecard mechanical process measures differ from performance metrics for origin ${originId}.`,
      );
    }
    return {
      runId: controlledId(run.record.runId, "Scorecard runId"),
      originId: controlledId(originId, "Scorecard originId"),
      clusterId: controlledId(run.performance.sourceDigest, "Scorecard clusterId"),
      outcomes,
      processMeasures: aggregateScalars(reviewedProcessMeasures, "process measures"),
      reviews: aggregateReviews(
        processLedgers.map(({ value }) => value),
        `scorecard origin ${originId}`,
      ),
    };
  });
}

function aggregateObjects(value: unknown, field: string): readonly JsonObject[] {
  const decoded = object(value, "Python aggregate result");
  const items = decoded[field];
  if (!Array.isArray(items)) throw new Error(`Python aggregate result.${field} must be an array.`);
  return items.map((item, index) => jsonObject(item, `Python aggregate result.${field}[${index}]`));
}

function combineDimensions(aggregate: Record<string, unknown>): readonly JsonObject[] {
  const dimensions = aggregateObjects(aggregate, "dimensions");
  const missingness = aggregateObjects(aggregate, "missingness");
  const uncertainty = aggregateObjects(aggregate, "clusteredUncertainty");
  return dimensions.map((dimension) => {
    const dimensionId = dimension.dimensionId;
    return {
      ...dimension,
      missingness: missingness.find((item) => item.dimensionId === dimensionId) ?? {
        state: "unavailable",
        reason: "Missingness summary is unavailable.",
      },
      uncertainty: uncertainty.find((item) => item.dimensionId === dimensionId) ?? {
        state: "unavailable",
        reason: "Clustered uncertainty is unavailable.",
      },
    };
  });
}

async function runAggregate(
  root: string,
  config: ReportConfiguration,
  scorecards: readonly AggregateScorecard[],
): Promise<Record<string, unknown>> {
  const aggregate = await runPythonJson(
    resolve(root),
    "palimpsest.evaluation.process",
    [],
    undefined,
    `${canonicalJson({
      schemaVersion: 1,
      kind: "aggregate",
      design: { experimentalUnit: config.experimentalUnit, clusterBy: "run" },
      scorecards,
    })}\n`,
  );
  if (aggregate.schemaVersion !== 1 || aggregate.kind !== "aggregate") {
    throw new Error("Python aggregate result has an unsupported schema or kind.");
  }
  return aggregate;
}

function treatmentContrasts(groups: readonly JsonObject[]): readonly JsonObject[] {
  const contrasts: JsonObject[] = [];
  for (const [leftIndex, left] of groups.entries()) {
    for (const right of groups.slice(leftIndex + 1)) {
      const leftMean = left.mean;
      const rightMean = right.mean;
      contrasts.push({
        leftTreatment: left.treatment!,
        rightTreatment: right.treatment!,
        ...(typeof leftMean === "number" && typeof rightMean === "number"
          ? { state: "observed", meanDifference: rightMean - leftMean }
          : {
              state: "unavailable",
              reason: "Both treatment groups require an observed mean for this contrast.",
            }),
      });
    }
  }
  return contrasts;
}

function matchedDimensions(aggregates: readonly TreatmentAggregate[]): readonly JsonObject[] {
  const decoded = aggregates.map(({ treatment, aggregate }) => ({
    treatment,
    dimensions: combineDimensions(aggregate),
  }));
  const ids = [
    ...new Set(
      decoded.flatMap(({ dimensions }) => dimensions.map(({ dimensionId }) => String(dimensionId))),
    ),
  ].sort();
  return ids.map((dimensionId) => {
    const treatmentGroups = decoded.map(({ treatment, dimensions }) => ({
      treatment,
      ...(dimensions.find((dimension) => dimension.dimensionId === dimensionId) ?? {
        dimensionId,
        ratingCount: 0,
        distribution: [0, 0, 0, 0, 0],
        missingness: { state: "unavailable", reason: "Dimension absent for this treatment." },
        uncertainty: { state: "unavailable", reason: "Dimension absent for this treatment." },
      }),
    }));
    return {
      dimensionId,
      treatmentGroups,
      treatmentContrasts: treatmentContrasts(treatmentGroups),
    };
  });
}

function matchedObjects(
  aggregates: readonly TreatmentAggregate[],
  field: "reviewerAgreement" | "processOutcomeAssociations",
  identity: (value: JsonObject) => string,
): readonly JsonObject[] {
  const decoded = aggregates.map(({ treatment, aggregate }) => ({
    treatment,
    values: aggregateObjects(aggregate, field),
  }));
  const identities = [
    ...new Set(decoded.flatMap(({ values }) => values.map((value) => identity(value)))),
  ].sort();
  return identities.map((key) => ({
    ...(field === "reviewerAgreement"
      ? { dimensionId: key }
      : (() => {
          const [processMeasureId, outcomeMeasureId] = key.split("\0");
          if (processMeasureId === undefined || outcomeMeasureId === undefined) {
            throw new Error("Aggregate outcome-link identity is invalid.");
          }
          return { processMeasureId, outcomeMeasureId };
        })()),
    treatmentGroups: decoded.map(({ treatment, values }) => ({
      treatment,
      ...(values.find((value) => identity(value) === key) ?? {
        state: "unavailable",
        reason: "No eligible observations exist for this treatment.",
      }),
    })),
  }));
}

async function aggregateMatched(
  root: string,
  config: ReportConfiguration,
  eligible: readonly EligibleRun[],
): Promise<readonly TreatmentAggregate[]> {
  const groups = new Map<string, { treatment: JsonValue; runs: EligibleRun[] }>();
  for (const run of eligible) {
    const treatment = resolvePointer(
      run.record,
      config.treatmentField!,
      `Treatment field ${config.treatmentField!}`,
    );
    const key = canonicalJson(treatment);
    const group = groups.get(key) ?? { treatment, runs: [] };
    group.runs.push(run);
    groups.set(key, group);
  }
  return Promise.all(
    [...groups]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([, { treatment, runs }]) => ({
        treatment,
        aggregate: await runAggregate(root, config, runs.flatMap(toAggregateScorecards)),
      })),
  );
}

function includedReference(run: EligibleRun, config: ReportConfiguration): JsonObject {
  const treatment =
    config.treatmentField === undefined
      ? undefined
      : resolvePointer(
          run.record,
          config.treatmentField,
          `Treatment field ${config.treatmentField}`,
        );
  return {
    runId: run.record.runId,
    runRoot: run.relativeRunRoot,
    performanceAnalysisId: run.performance.analysisId,
    processReviewAnalysisId: run.review.analysisId,
    scorecardPath: join(dirname(run.review.detailsPath), "scorecard.json").split(sep).join("/"),
    originIds: run.scorecards.map((scorecard) => scorecard.canonicalOrigins[0]!.originId),
    ...(treatment === undefined ? {} : { treatment }),
  };
}

function excludedReference(excluded: ExcludedRun): JsonObject {
  return {
    ...(excluded.runId === undefined ? {} : { runId: excluded.runId }),
    runRoot: excluded.relativeRunRoot,
    reasonCode: excluded.reasonCode,
    reason: excluded.reason,
  };
}

function limitations(
  config: ReportConfiguration,
  eligible: readonly EligibleRun[],
  excluded: readonly ExcludedRun[],
): readonly string[] {
  const values = [
    config.claimType === "descriptive"
      ? "This report is descriptive and does not support causal claims or stable model-trait claims."
      : "This matched contrast is limited to the declared treatment and matching fields.",
    "Reviewer judgments remain independent advisory interpretations; disagreement and missingness are retained.",
    "Process-outcome associations are observational and are not composite rankings.",
  ];
  if (eligible.length === 1) {
    values.push(
      "A single run is mechanism evidence, not evidence of a stable behavioral tendency.",
    );
  }
  if (excluded.length > 0)
    values.push(`${excluded.length} discovered run(s) were explicitly excluded.`);
  return values;
}

function dossierMechanisms(
  eligible: readonly EligibleRun[],
  config: ReportConfiguration,
): readonly JsonObject[] {
  const groups = new Map<
    string,
    {
      readonly judge: number;
      readonly predicate: string;
      readonly opportunityKind: string;
      readonly treatment?: JsonValue;
      observedCount: number;
      claimCount: number;
      opportunityCount: number;
    }
  >();
  for (const run of eligible) {
    const treatment =
      config.treatmentField === undefined
        ? undefined
        : resolvePointer(
            run.record,
            config.treatmentField,
            `Treatment field ${config.treatmentField}`,
          );
    for (const scorecard of run.scorecards) {
      if (scorecard.schemaVersion !== 2) continue;
      for (const reviewer of scorecard.dossier.reviewers) {
        const opportunityById = new Map(
          reviewer.evidence.opportunities.map(
            (opportunity) => [opportunity.opportunityId, opportunity] as const,
          ),
        );
        const claimsByGroup = new Map<string, typeof reviewer.evidence.claims>();
        for (const claim of reviewer.evidence.claims) {
          const opportunityKind = opportunityById.get(claim.opportunityId)?.kind ?? "unresolved";
          const key = `${claim.predicate}\0${opportunityKind}`;
          claimsByGroup.set(key, [...(claimsByGroup.get(key) ?? []), claim]);
        }
        for (const [claimKey, claims] of claimsByGroup) {
          const [predicate, opportunityKind] = claimKey.split("\0") as [string, string];
          const groupKey = canonicalJson({
            judge: reviewer.judge,
            predicate,
            opportunityKind,
            ...(treatment === undefined ? {} : { treatment }),
          });
          const existing = groups.get(groupKey) ?? {
            judge: reviewer.judge,
            predicate,
            opportunityKind,
            ...(treatment === undefined ? {} : { treatment }),
            observedCount: 0,
            claimCount: 0,
            opportunityCount: 0,
          };
          existing.observedCount += claims.filter(({ state }) => state === "observed").length;
          existing.claimCount += claims.length;
          existing.opportunityCount += reviewer.evidence.opportunities.filter(
            ({ kind }) => kind === opportunityKind,
          ).length;
          groups.set(groupKey, existing);
        }
      }
    }
  }
  return [...groups.values()]
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
    .map((group) => ({
      ...group,
      state: group.opportunityCount === 0 ? "unavailable" : "observed",
      ...(group.opportunityCount === 0
        ? {}
        : { opportunityConditionedRate: group.observedCount / group.opportunityCount }),
    }));
}

function reportProvenance(eligible: readonly EligibleRun[]): readonly JsonObject[] {
  return eligible.flatMap((run) =>
    run.scorecards.flatMap((scorecard) =>
      scorecard.schemaVersion === 2
        ? [
            {
              runId: run.record.runId,
              originId: scorecard.canonicalOrigins[0]!.originId,
              ...scorecard.provenance,
            } as unknown as JsonObject,
          ]
        : [],
    ),
  );
}

function reportFailureAccounts(eligible: readonly EligibleRun[]): readonly JsonObject[] {
  return eligible.flatMap((run) =>
    run.scorecards.flatMap((scorecard) =>
      scorecard.schemaVersion === 2
        ? [
            {
              runId: run.record.runId,
              originId: scorecard.canonicalOrigins[0]!.originId,
              account: scorecard.failureAccount,
            } as unknown as JsonObject,
          ]
        : [],
    ),
  );
}

async function publishReport(output: string, report: BehaviorReport): Promise<string> {
  const resolvedOutput = resolve(output);
  try {
    await lstat(resolvedOutput);
    throw new Error(`Report output directory already exists: ${resolvedOutput}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = dirname(resolvedOutput);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.${basename(resolvedOutput)}-${randomUUID()}-`));
  try {
    await writeFile(join(staging, "report.json"), `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(staging, resolvedOutput);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return join(resolvedOutput, "report.json");
}

export async function reportRuns(options: ReportRunsOptions): Promise<ReportRunsResult> {
  const config = await loadReportConfiguration(options.configPath);
  const artifactsRoot = await realpath(resolve(options.artifactsRoot));
  const runRoots = await discoverRunRoots(artifactsRoot);
  if (runRoots.length === 0)
    throw new Error("No run.json records were discovered under the artifacts root.");
  const output = await physicalFuturePath(options.output);
  if (runRoots.some((runRoot) => isContained(runRoot, output) || isContained(output, runRoot))) {
    throw new Error("Report output must not overlap a discovered frozen run root.");
  }
  const { eligible, excluded } = await resolveEligibility(
    resolve(options.root),
    artifactsRoot,
    runRoots,
    config,
  );
  validateMatchedContrast(eligible, excluded, config);
  if (eligible.length === 0) {
    const reasons = excluded.map(({ runId, reason }) => `${runId ?? "unknown run"}: ${reason}`);
    throw new Error(
      `No eligible completed run scorecards remain for reporting.${reasons.length === 0 ? "" : ` ${reasons.join("; ")}`}`,
    );
  }
  const aggregate =
    config.claimType === "descriptive"
      ? await runAggregate(options.root, config, eligible.flatMap(toAggregateScorecards))
      : undefined;
  const treatmentAggregates =
    config.claimType === "matched-contrast"
      ? await aggregateMatched(options.root, config, eligible)
      : undefined;
  const included = eligible.map((run) => includedReference(run, config));
  const excludedEntries = excluded.map(excludedReference);
  const reportId = `behavior-report-${contentDigest({
    config,
    included: eligible.map(({ record, performance, review }) => ({
      runId: record.runId,
      performanceAnalysisId: performance.analysisId,
      processReviewAnalysisId: review.analysisId,
    })),
  }).slice(0, 24)}`;
  const report = decodeBehaviorReport({
    schemaVersion: 2,
    reportId,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    claimType: config.claimType,
    experimentalUnit: { unit: config.experimentalUnit, clusterByRun: true },
    matchingFields: config.matchingFields,
    ...(config.treatmentField === undefined ? {} : { treatmentField: config.treatmentField }),
    included,
    excluded: excludedEntries,
    dimensions:
      aggregate === undefined
        ? matchedDimensions(treatmentAggregates!)
        : combineDimensions(aggregate),
    reviewerAgreement:
      aggregate === undefined
        ? matchedObjects(treatmentAggregates!, "reviewerAgreement", (value) =>
            String(value.dimensionId),
          )
        : aggregateObjects(aggregate, "reviewerAgreement"),
    outcomeLinks:
      aggregate === undefined
        ? matchedObjects(
            treatmentAggregates!,
            "processOutcomeAssociations",
            (value) => `${String(value.processMeasureId)}\0${String(value.outcomeMeasureId)}`,
          )
        : aggregateObjects(aggregate, "processOutcomeAssociations"),
    mechanisms: dossierMechanisms(eligible, config),
    provenance: reportProvenance(eligible),
    failureAccounts: reportFailureAccounts(eligible),
    limitations: limitations(config, eligible, excluded),
  });
  const path = await publishReport(output, report);
  return {
    reportId,
    claimType: config.claimType,
    includedRunCount: eligible.length,
    excludedRunCount: excluded.length,
    path,
    report,
  };
}
