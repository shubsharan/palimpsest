import { isAbsolute, win32 } from "node:path";

import { contentDigest as digestContent } from "../canonical.js";
import type { JsonObject, JsonValue } from "../model/contracts.js";

const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const CONTROLLED_ID = /^[a-z0-9][a-z0-9._-]*$/;
const OBSERVATION_KIND = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)+$/;

export type EvidenceRole = "support" | "counterevidence" | "context";

interface EvidenceReferenceBase {
  readonly excerptDigest: string;
  readonly role: EvidenceRole;
}

export interface TraceEvidenceReference extends EvidenceReferenceBase {
  readonly source: "trace";
  readonly traceSequence: number;
}

export interface RunRecordEvidenceReference extends EvidenceReferenceBase {
  readonly source: "run-record";
  readonly recordPointer: string;
}

export interface GitEvidenceReference extends EvidenceReferenceBase {
  readonly source: "git";
  readonly originId: string;
  readonly commit: string;
  readonly path?: string;
}

export type EvidenceReference =
  | TraceEvidenceReference
  | RunRecordEvidenceReference
  | GitEvidenceReference;

export type EvidenceAvailability = "full" | "excerpted" | "metadata-only";

export interface EvidenceItem {
  readonly evidenceId: string;
  readonly atMs: number;
  readonly actorId: string;
  readonly kind: string;
  readonly content: JsonValue;
  readonly reference: EvidenceReference;
  readonly availability: EvidenceAvailability;
  readonly omissionReason?: string;
}

export interface EvidenceWindow {
  readonly windowId: string;
  readonly evidenceIds: readonly string[];
  readonly byteCount: number;
}

export interface EvidenceOmission {
  readonly sourcePath: string;
  readonly byteCount: number;
  readonly contentDigest: string;
  readonly reason: string;
}

export interface EvidenceBundle {
  readonly schemaVersion: 1;
  readonly bundleId: string;
  readonly runFingerprint: string;
  readonly communicationMode: "shared" | "isolated";
  readonly actors: readonly string[];
  readonly items: readonly EvidenceItem[];
  readonly windows: readonly EvidenceWindow[];
  readonly omissions: readonly EvidenceOmission[];
  readonly sourceDigest: string;
  readonly contentDigest: string;
}

export type GradingLedger = "outcome" | "epistemic" | "social" | "instrumental";
export type ProcessLedger = Exclude<GradingLedger, "outcome">;
export type MeasureBasis = "mechanical" | "review-coded";
export type MeasureState = "observed" | "unavailable" | "not-applicable";

export interface MeasureEligibility {
  readonly ruleId: string;
  readonly explanation: string;
}

interface QuantitativeMeasureBase {
  readonly measureId: string;
  readonly ledger: GradingLedger;
  readonly basis: MeasureBasis;
  readonly eligibility: MeasureEligibility;
  readonly evidence: readonly EvidenceReference[];
}

export interface ObservedQuantitativeMeasure extends QuantitativeMeasureBase {
  readonly state: "observed";
  readonly value: number | string | boolean;
  readonly unit: string;
  readonly numerator?: number;
  readonly denominator?: number;
}

export interface MissingQuantitativeMeasure extends QuantitativeMeasureBase {
  readonly state: "unavailable" | "not-applicable";
}

export type QuantitativeMeasure = ObservedQuantitativeMeasure | MissingQuantitativeMeasure;

export type EpisodeStatus =
  | "supported-revision"
  | "asserted-only"
  | "missed-revision"
  | "unchanged"
  | "ambiguous";
export type ReviewConfidence = "low" | "medium" | "high";

export interface EpistemicEpisode {
  readonly episodeId: string;
  readonly summary: string;
  readonly status: EpisodeStatus;
  readonly evidence: readonly EvidenceReference[];
  readonly commitment: readonly EvidenceReference[];
  readonly test: readonly EvidenceReference[];
  readonly revision: readonly EvidenceReference[];
  readonly transmission: readonly EvidenceReference[];
  readonly uptake: readonly EvidenceReference[];
  readonly integration: readonly EvidenceReference[];
  readonly counterevidence: readonly EvidenceReference[];
  readonly confidence: ReviewConfidence;
}

interface DimensionReviewBase {
  readonly dimensionId: string;
  readonly ledger: ProcessLedger;
  readonly rationale: string;
  readonly evidence: readonly EvidenceReference[];
  readonly counterevidence: readonly EvidenceReference[];
  readonly confidence: ReviewConfidence;
}

export interface RatedDimensionReview extends DimensionReviewBase {
  readonly state: "rated";
  readonly rating: 0 | 1 | 2 | 3 | 4;
}

export interface UnratedDimensionReview extends DimensionReviewBase {
  readonly state: "unobservable" | "not-applicable";
}

export type DimensionReview = RatedDimensionReview | UnratedDimensionReview;

export interface JudgeProvenance {
  readonly providerFamily: string;
  readonly requestedModel: string;
  readonly actualProvider?: string;
  readonly actualModel?: string;
}

export type JudgeReviewStatus = "completed" | "invalid" | "provider-error";

export interface JudgeReview {
  readonly reviewId: string;
  readonly status: JudgeReviewStatus;
  readonly rubricVersion: string;
  readonly bundleDigest: string;
  readonly judge: JudgeProvenance;
  readonly dimensions: readonly DimensionReview[];
  readonly episodes: readonly EpistemicEpisode[];
  readonly overallCautions: readonly string[];
  readonly rawResponsePath: string;
  readonly rawResponseDigest?: string;
}

export interface ReviewerOutput {
  readonly schemaVersion: 1;
  readonly rubricVersion: string;
  readonly bundleDigest: string;
  readonly dimensions: readonly DimensionReview[];
  readonly episodes: readonly EpistemicEpisode[];
  readonly overallCautions: readonly string[];
}

export interface CanonicalOriginScorecardSummary {
  readonly originId: string;
  readonly status: "eligible" | "unavailable" | "not-applicable";
  readonly reason?: string;
}

export interface RunScorecard {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly canonicalOrigins: readonly CanonicalOriginScorecardSummary[];
  readonly outcome: JsonObject;
  readonly epistemic: JsonObject;
  readonly social: JsonObject;
  readonly instrumental: JsonObject;
  readonly disagreements: readonly JsonObject[];
  readonly eligibility: {
    readonly status: "completed" | "censored" | "excluded";
    readonly reason?: string;
  };
  readonly limitations: readonly string[];
}

export interface BehaviorReport {
  readonly schemaVersion: 1;
  readonly reportId: string;
  readonly createdAt: string;
  readonly claimType: "descriptive" | "matched-contrast";
  readonly experimentalUnit: {
    readonly unit: "team" | "origin";
    readonly clusterByRun: boolean;
  };
  readonly matchingFields: readonly string[];
  readonly treatmentField?: string;
  readonly included: readonly JsonObject[];
  readonly excluded: readonly JsonObject[];
  readonly dimensions: readonly JsonObject[];
  readonly reviewerAgreement: readonly JsonObject[];
  readonly outcomeLinks: readonly JsonObject[];
  readonly limitations: readonly string[];
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

function exact(value: unknown, required: readonly string[], name: string): Record<string, unknown> {
  return fields(value, required, [], name);
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

function digest(value: unknown, name: string): string {
  const decoded = text(value, name);
  if (!DIGEST.test(decoded)) throw new Error(`${name} must be a lowercase SHA-256 digest.`);
  return decoded;
}

function integer(value: unknown, minimum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    const qualifier = minimum === 1 ? "positive " : "non-negative ";
    throw new Error(`${name} must be a ${qualifier}safe integer.`);
  }
  return value as number;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return value;
}

function timestamp(value: unknown, name: string): string {
  const decoded = text(value, name);
  const date = new Date(decoded);
  if (!decoded.endsWith("Z") || Number.isNaN(date.valueOf()) || date.toISOString() !== decoded) {
    throw new Error(`${name} must be a canonical UTC timestamp.`);
  }
  return decoded;
}

function relativePath(value: unknown, name: string): string {
  const decoded = text(value, name);
  if (
    isAbsolute(decoded) ||
    win32.isAbsolute(decoded) ||
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    decoded.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${name} must be a safe relative path.`);
  }
  return decoded;
}

function jsonPointer(value: unknown, name: string): string {
  const decoded = text(value, name);
  if (!decoded.startsWith("/") || /~(?:[^01]|$)/.test(decoded)) {
    throw new Error(`${name} must be a valid non-root JSON Pointer.`);
  }
  return decoded;
}

function jsonValue(value: unknown, name: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return finite(value, name);
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

function array<T>(
  value: unknown,
  decode: (item: unknown, name: string) => T,
  name: string,
): readonly T[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.map((item, index) => decode(item, `${name}[${index}]`));
}

function strings(value: unknown, name: string): readonly string[] {
  return array(value, text, name);
}

function unique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${name} must be unique.`);
}

function evidenceRole(value: unknown, name: string): EvidenceRole {
  if (value !== "support" && value !== "counterevidence" && value !== "context") {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

export function decodeEvidenceReference(
  value: unknown,
  name = "Evidence reference",
): EvidenceReference {
  const common = object(value, name);
  if (common.source === "trace") {
    const decoded = exact(value, ["source", "traceSequence", "excerptDigest", "role"], name);
    return {
      source: "trace",
      traceSequence: integer(decoded.traceSequence, 1, `${name}.traceSequence`),
      excerptDigest: digest(decoded.excerptDigest, `${name}.excerptDigest`),
      role: evidenceRole(decoded.role, `${name}.role`),
    };
  }
  if (common.source === "run-record") {
    const decoded = exact(value, ["source", "recordPointer", "excerptDigest", "role"], name);
    return {
      source: "run-record",
      recordPointer: jsonPointer(decoded.recordPointer, `${name}.recordPointer`),
      excerptDigest: digest(decoded.excerptDigest, `${name}.excerptDigest`),
      role: evidenceRole(decoded.role, `${name}.role`),
    };
  }
  if (common.source === "git") {
    const decoded = fields(
      value,
      ["source", "originId", "commit", "excerptDigest", "role"],
      ["path"],
      name,
    );
    const commit = text(decoded.commit, `${name}.commit`);
    if (!COMMIT.test(commit)) throw new Error(`${name}.commit must be a 40-character object ID.`);
    return {
      source: "git",
      originId: controlledId(decoded.originId, `${name}.originId`),
      commit,
      ...(decoded.path === undefined ? {} : { path: relativePath(decoded.path, `${name}.path`) }),
      excerptDigest: digest(decoded.excerptDigest, `${name}.excerptDigest`),
      role: evidenceRole(decoded.role, `${name}.role`),
    };
  }
  throw new Error(`${name}.source is invalid.`);
}

export function decodeEvidenceItem(value: unknown, name = "Evidence item"): EvidenceItem {
  const decoded = fields(
    value,
    ["evidenceId", "atMs", "actorId", "kind", "content", "reference", "availability"],
    ["omissionReason"],
    name,
  );
  if (
    decoded.availability !== "full" &&
    decoded.availability !== "excerpted" &&
    decoded.availability !== "metadata-only"
  ) {
    throw new Error(`${name}.availability is invalid.`);
  }
  if ((decoded.availability === "full") === (decoded.omissionReason !== undefined)) {
    throw new Error(`${name}.omissionReason must exist exactly for non-full evidence.`);
  }
  const kind = text(decoded.kind, `${name}.kind`);
  if (!OBSERVATION_KIND.test(kind))
    throw new Error(`${name}.kind is not a controlled observation kind.`);
  return {
    evidenceId: controlledId(decoded.evidenceId, `${name}.evidenceId`),
    atMs: (() => {
      const result = finite(decoded.atMs, `${name}.atMs`);
      if (result < 0) throw new Error(`${name}.atMs must be non-negative.`);
      return result;
    })(),
    actorId: controlledId(decoded.actorId, `${name}.actorId`),
    kind,
    content: jsonValue(decoded.content, `${name}.content`),
    reference: decodeEvidenceReference(decoded.reference, `${name}.reference`),
    availability: decoded.availability,
    ...(decoded.omissionReason === undefined
      ? {}
      : { omissionReason: text(decoded.omissionReason, `${name}.omissionReason`) }),
  };
}

function decodeEvidenceWindow(value: unknown, name: string): EvidenceWindow {
  const decoded = exact(value, ["windowId", "evidenceIds", "byteCount"], name);
  const evidenceIds = strings(decoded.evidenceIds, `${name}.evidenceIds`).map((item, index) =>
    controlledId(item, `${name}.evidenceIds[${index}]`),
  );
  unique(evidenceIds, `${name}.evidenceIds`);
  return {
    windowId: controlledId(decoded.windowId, `${name}.windowId`),
    evidenceIds,
    byteCount: integer(decoded.byteCount, 0, `${name}.byteCount`),
  };
}

function decodeEvidenceOmission(value: unknown, name: string): EvidenceOmission {
  const decoded = exact(value, ["sourcePath", "byteCount", "contentDigest", "reason"], name);
  return {
    sourcePath: text(decoded.sourcePath, `${name}.sourcePath`),
    byteCount: integer(decoded.byteCount, 0, `${name}.byteCount`),
    contentDigest: digest(decoded.contentDigest, `${name}.contentDigest`),
    reason: text(decoded.reason, `${name}.reason`),
  };
}

export function decodeEvidenceBundle(value: unknown, name = "Evidence bundle"): EvidenceBundle {
  const decoded = exact(
    value,
    [
      "schemaVersion",
      "bundleId",
      "runFingerprint",
      "communicationMode",
      "actors",
      "items",
      "windows",
      "omissions",
      "sourceDigest",
      "contentDigest",
    ],
    name,
  );
  if (decoded.schemaVersion !== 1) throw new Error(`${name}.schemaVersion is unsupported.`);
  if (decoded.communicationMode !== "shared" && decoded.communicationMode !== "isolated") {
    throw new Error(`${name}.communicationMode is invalid.`);
  }
  const actors = strings(decoded.actors, `${name}.actors`).map((actor, index) =>
    controlledId(actor, `${name}.actors[${index}]`),
  );
  unique(actors, `${name}.actors`);
  if (actors.length === 0) throw new Error(`${name}.actors must be non-empty.`);
  const items = array(decoded.items, decodeEvidenceItem, `${name}.items`);
  unique(
    items.map(({ evidenceId }) => evidenceId),
    `${name}.items evidence IDs`,
  );
  if (items.some((item, index) => index > 0 && item.atMs < items[index - 1]!.atMs)) {
    throw new Error(`${name}.items must be chronological.`);
  }
  const windows = array(decoded.windows, decodeEvidenceWindow, `${name}.windows`);
  unique(
    windows.map(({ windowId }) => windowId),
    `${name}.windowIds`,
  );
  const covered = windows.flatMap(({ evidenceIds }) => evidenceIds);
  if (
    covered.length !== items.length ||
    covered.some((id, index) => id !== items[index]?.evidenceId)
  ) {
    throw new Error(`${name}.windows must cover every evidence item exactly once in order.`);
  }
  const bundle = {
    schemaVersion: 1,
    bundleId: controlledId(decoded.bundleId, `${name}.bundleId`),
    runFingerprint: digest(decoded.runFingerprint, `${name}.runFingerprint`),
    communicationMode: decoded.communicationMode,
    actors,
    items,
    windows,
    omissions: array(decoded.omissions, decodeEvidenceOmission, `${name}.omissions`),
    sourceDigest: digest(decoded.sourceDigest, `${name}.sourceDigest`),
    contentDigest: digest(decoded.contentDigest, `${name}.contentDigest`),
  } as const;
  const { bundleId, contentDigest, ...bundleBase } = bundle;
  const expectedBundleId = `bundle-${digestContent(bundleBase).slice(0, 24)}`;
  if (bundleId !== expectedBundleId) {
    throw new Error(`${name}.bundleId does not match its canonical decoded content.`);
  }
  if (contentDigest !== digestContent({ ...bundleBase, bundleId })) {
    throw new Error(`${name}.contentDigest does not match its canonical decoded content.`);
  }
  return bundle;
}

function decodeEligibility(value: unknown, name: string): MeasureEligibility {
  const decoded = exact(value, ["ruleId", "explanation"], name);
  return {
    ruleId: controlledId(decoded.ruleId, `${name}.ruleId`),
    explanation: text(decoded.explanation, `${name}.explanation`),
  };
}

function gradingLedger(value: unknown, name: string): GradingLedger {
  if (
    value !== "outcome" &&
    value !== "epistemic" &&
    value !== "social" &&
    value !== "instrumental"
  ) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

export function decodeQuantitativeMeasure(
  value: unknown,
  name = "Quantitative measure",
): QuantitativeMeasure {
  const base = object(value, name);
  if (base.state === "observed") {
    const decoded = fields(
      value,
      ["measureId", "ledger", "basis", "state", "value", "unit", "eligibility", "evidence"],
      ["numerator", "denominator"],
      name,
    );
    if (decoded.basis !== "mechanical" && decoded.basis !== "review-coded") {
      throw new Error(`${name}.basis is invalid.`);
    }
    if (
      typeof decoded.value !== "string" &&
      typeof decoded.value !== "boolean" &&
      typeof decoded.value !== "number"
    ) {
      throw new Error(`${name}.value must be finite or categorical.`);
    }
    const result: ObservedQuantitativeMeasure = {
      measureId: controlledId(decoded.measureId, `${name}.measureId`),
      ledger: gradingLedger(decoded.ledger, `${name}.ledger`),
      basis: decoded.basis,
      state: "observed",
      value:
        typeof decoded.value === "number" ? finite(decoded.value, `${name}.value`) : decoded.value,
      unit: controlledId(decoded.unit, `${name}.unit`),
      ...(decoded.numerator === undefined
        ? {}
        : { numerator: finite(decoded.numerator, `${name}.numerator`) }),
      ...(decoded.denominator === undefined
        ? {}
        : { denominator: finite(decoded.denominator, `${name}.denominator`) }),
      eligibility: decodeEligibility(decoded.eligibility, `${name}.eligibility`),
      evidence: array(decoded.evidence, decodeEvidenceReference, `${name}.evidence`),
    };
    if (result.denominator !== undefined && result.denominator <= 0) {
      throw new Error(`${name}.denominator must be positive.`);
    }
    if (result.unit === "ratio" && result.denominator === undefined) {
      throw new Error(`${name}.denominator is required for rates.`);
    }
    if (result.evidence.length === 0) throw new Error(`${name} observed values require evidence.`);
    return result;
  }
  if (base.state === "unavailable" || base.state === "not-applicable") {
    const decoded = exact(
      value,
      ["measureId", "ledger", "basis", "state", "eligibility", "evidence"],
      name,
    );
    if (decoded.basis !== "mechanical" && decoded.basis !== "review-coded") {
      throw new Error(`${name}.basis is invalid.`);
    }
    return {
      measureId: controlledId(decoded.measureId, `${name}.measureId`),
      ledger: gradingLedger(decoded.ledger, `${name}.ledger`),
      basis: decoded.basis,
      state: base.state,
      eligibility: decodeEligibility(decoded.eligibility, `${name}.eligibility`),
      evidence: array(decoded.evidence, decodeEvidenceReference, `${name}.evidence`),
    };
  }
  throw new Error(`${name}.state is invalid.`);
}

function confidence(value: unknown, name: string): ReviewConfidence {
  if (value !== "low" && value !== "medium" && value !== "high") {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function references(value: unknown, name: string): readonly EvidenceReference[] {
  return array(value, decodeEvidenceReference, name);
}

export function decodeEpistemicEpisode(
  value: unknown,
  name = "Epistemic episode",
): EpistemicEpisode {
  const decoded = exact(
    value,
    [
      "episodeId",
      "summary",
      "status",
      "evidence",
      "commitment",
      "test",
      "revision",
      "transmission",
      "uptake",
      "integration",
      "counterevidence",
      "confidence",
    ],
    name,
  );
  if (
    decoded.status !== "supported-revision" &&
    decoded.status !== "asserted-only" &&
    decoded.status !== "missed-revision" &&
    decoded.status !== "unchanged" &&
    decoded.status !== "ambiguous"
  ) {
    throw new Error(`${name}.status is invalid.`);
  }
  const result: EpistemicEpisode = {
    episodeId: controlledId(decoded.episodeId, `${name}.episodeId`),
    summary: text(decoded.summary, `${name}.summary`),
    status: decoded.status,
    evidence: references(decoded.evidence, `${name}.evidence`),
    commitment: references(decoded.commitment, `${name}.commitment`),
    test: references(decoded.test, `${name}.test`),
    revision: references(decoded.revision, `${name}.revision`),
    transmission: references(decoded.transmission, `${name}.transmission`),
    uptake: references(decoded.uptake, `${name}.uptake`),
    integration: references(decoded.integration, `${name}.integration`),
    counterevidence: references(decoded.counterevidence, `${name}.counterevidence`),
    confidence: confidence(decoded.confidence, `${name}.confidence`),
  };
  if (
    (result.status === "missed-revision" || result.status === "ambiguous") &&
    result.counterevidence.length === 0
  ) {
    throw new Error(`${name}.counterevidence is required for disputed or missed episodes.`);
  }
  return result;
}

function processLedger(value: unknown, name: string): ProcessLedger {
  if (value !== "epistemic" && value !== "social" && value !== "instrumental") {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

export function decodeDimensionReview(value: unknown, name = "Dimension review"): DimensionReview {
  const common = object(value, name);
  const required = [
    "dimensionId",
    "ledger",
    "state",
    "rationale",
    "evidence",
    "counterevidence",
    "confidence",
  ];
  const decoded =
    common.state === "rated"
      ? exact(value, [...required, "rating"], name)
      : exact(value, required, name);
  const ledger = processLedger(decoded.ledger, `${name}.ledger`);
  const dimensionId = controlledId(decoded.dimensionId, `${name}.dimensionId`);
  if (!dimensionId.startsWith(`${ledger}.`)) {
    throw new Error(`${name}.dimensionId does not match its ledger.`);
  }
  const base = {
    dimensionId,
    ledger,
    rationale: text(decoded.rationale, `${name}.rationale`),
    evidence: references(decoded.evidence, `${name}.evidence`),
    counterevidence: references(decoded.counterevidence, `${name}.counterevidence`),
    confidence: confidence(decoded.confidence, `${name}.confidence`),
  };
  if (decoded.state === "rated") {
    const rating = integer(decoded.rating, 0, `${name}.rating`);
    if (rating > 4) throw new Error(`${name}.rating must be an integer from 0 through 4.`);
    if (base.evidence.length === 0) throw new Error(`${name} requires supporting evidence.`);
    return { ...base, state: "rated", rating: rating as 0 | 1 | 2 | 3 | 4 };
  }
  if (decoded.state !== "unobservable" && decoded.state !== "not-applicable") {
    throw new Error(`${name}.state is invalid.`);
  }
  return { ...base, state: decoded.state };
}

function judgeProvenance(value: unknown, name: string): JudgeProvenance {
  const decoded = fields(
    value,
    ["providerFamily", "requestedModel"],
    ["actualProvider", "actualModel"],
    name,
  );
  return {
    providerFamily: controlledId(decoded.providerFamily, `${name}.providerFamily`),
    requestedModel: text(decoded.requestedModel, `${name}.requestedModel`),
    ...(decoded.actualProvider === undefined
      ? {}
      : { actualProvider: text(decoded.actualProvider, `${name}.actualProvider`) }),
    ...(decoded.actualModel === undefined
      ? {}
      : { actualModel: text(decoded.actualModel, `${name}.actualModel`) }),
  };
}

function completedReviewContent(
  decoded: Record<string, unknown>,
  name: string,
): Pick<JudgeReview, "dimensions" | "episodes" | "overallCautions"> {
  const dimensions = array(decoded.dimensions, decodeDimensionReview, `${name}.dimensions`);
  unique(
    dimensions.map(({ dimensionId }) => dimensionId),
    `${name}.dimensionIds`,
  );
  return {
    dimensions,
    episodes: array(decoded.episodes, decodeEpistemicEpisode, `${name}.episodes`),
    overallCautions: strings(decoded.overallCautions, `${name}.overallCautions`),
  };
}

export function decodeJudgeReview(value: unknown, name = "Judge review"): JudgeReview {
  const decoded = fields(
    value,
    [
      "reviewId",
      "status",
      "rubricVersion",
      "bundleDigest",
      "judge",
      "dimensions",
      "episodes",
      "overallCautions",
      "rawResponsePath",
    ],
    ["rawResponseDigest"],
    name,
  );
  if (
    decoded.status !== "completed" &&
    decoded.status !== "invalid" &&
    decoded.status !== "provider-error"
  ) {
    throw new Error(`${name}.status is invalid.`);
  }
  const content = completedReviewContent(decoded, name);
  if (decoded.status === "completed" && content.dimensions.length === 0) {
    throw new Error(`${name}.dimensions must be non-empty when completed.`);
  }
  if (
    decoded.status !== "completed" &&
    (content.dimensions.length > 0 || content.episodes.length > 0)
  ) {
    throw new Error(`${name} failed reviews cannot contain findings.`);
  }
  if (decoded.status === "completed" && decoded.rawResponseDigest === undefined) {
    throw new Error(`${name}.rawResponseDigest is required when completed.`);
  }
  return {
    reviewId: controlledId(decoded.reviewId, `${name}.reviewId`),
    status: decoded.status,
    rubricVersion: controlledId(decoded.rubricVersion, `${name}.rubricVersion`),
    bundleDigest: digest(decoded.bundleDigest, `${name}.bundleDigest`),
    judge: judgeProvenance(decoded.judge, `${name}.judge`),
    ...content,
    rawResponsePath: relativePath(decoded.rawResponsePath, `${name}.rawResponsePath`),
    ...(decoded.rawResponseDigest === undefined
      ? {}
      : { rawResponseDigest: digest(decoded.rawResponseDigest, `${name}.rawResponseDigest`) }),
  };
}

export function decodeReviewerOutput(value: unknown, name = "Reviewer output"): ReviewerOutput {
  const decoded = exact(
    value,
    ["schemaVersion", "rubricVersion", "bundleDigest", "dimensions", "episodes", "overallCautions"],
    name,
  );
  if (decoded.schemaVersion !== 1) throw new Error(`${name}.schemaVersion is unsupported.`);
  const content = completedReviewContent(decoded, name);
  if (content.dimensions.length === 0) throw new Error(`${name}.dimensions must be non-empty.`);
  return {
    schemaVersion: 1,
    rubricVersion: controlledId(decoded.rubricVersion, `${name}.rubricVersion`),
    bundleDigest: digest(decoded.bundleDigest, `${name}.bundleDigest`),
    ...content,
  };
}

function originSummary(value: unknown, name: string): CanonicalOriginScorecardSummary {
  const decoded = fields(value, ["originId", "status"], ["reason"], name);
  if (
    decoded.status !== "eligible" &&
    decoded.status !== "unavailable" &&
    decoded.status !== "not-applicable"
  ) {
    throw new Error(`${name}.status is invalid.`);
  }
  if ((decoded.status === "eligible") === (decoded.reason !== undefined)) {
    throw new Error(`${name}.reason must exist exactly when the origin is not eligible.`);
  }
  return {
    originId: controlledId(decoded.originId, `${name}.originId`),
    status: decoded.status,
    ...(decoded.reason === undefined ? {} : { reason: text(decoded.reason, `${name}.reason`) }),
  };
}

export function decodeRunScorecard(value: unknown, name = "Run scorecard"): RunScorecard {
  const decoded = exact(
    value,
    [
      "schemaVersion",
      "runId",
      "canonicalOrigins",
      "outcome",
      "epistemic",
      "social",
      "instrumental",
      "disagreements",
      "eligibility",
      "limitations",
    ],
    name,
  );
  if (decoded.schemaVersion !== 1) throw new Error(`${name}.schemaVersion is unsupported.`);
  const canonicalOrigins = array(
    decoded.canonicalOrigins,
    originSummary,
    `${name}.canonicalOrigins`,
  );
  unique(
    canonicalOrigins.map(({ originId }) => originId),
    `${name}.canonicalOrigins`,
  );
  if (canonicalOrigins.length === 0) throw new Error(`${name}.canonicalOrigins must be non-empty.`);
  const eligibility = fields(decoded.eligibility, ["status"], ["reason"], `${name}.eligibility`);
  if (
    eligibility.status !== "completed" &&
    eligibility.status !== "censored" &&
    eligibility.status !== "excluded"
  ) {
    throw new Error(`${name}.eligibility.status is invalid.`);
  }
  if ((eligibility.status === "completed") === (eligibility.reason !== undefined)) {
    throw new Error(`${name}.eligibility.reason is inconsistent with status.`);
  }
  return {
    schemaVersion: 1,
    runId: text(decoded.runId, `${name}.runId`),
    canonicalOrigins,
    outcome: jsonObject(decoded.outcome, `${name}.outcome`),
    epistemic: jsonObject(decoded.epistemic, `${name}.epistemic`),
    social: jsonObject(decoded.social, `${name}.social`),
    instrumental: jsonObject(decoded.instrumental, `${name}.instrumental`),
    disagreements: array(decoded.disagreements, jsonObject, `${name}.disagreements`),
    eligibility: {
      status: eligibility.status,
      ...(eligibility.reason === undefined
        ? {}
        : { reason: text(eligibility.reason, `${name}.eligibility.reason`) }),
    },
    limitations: strings(decoded.limitations, `${name}.limitations`),
  };
}

function reportObjects(value: unknown, name: string): readonly JsonObject[] {
  return array(value, jsonObject, name);
}

export function decodeBehaviorReport(value: unknown, name = "Behavior report"): BehaviorReport {
  const decoded = fields(
    value,
    [
      "schemaVersion",
      "reportId",
      "createdAt",
      "claimType",
      "experimentalUnit",
      "matchingFields",
      "included",
      "excluded",
      "dimensions",
      "reviewerAgreement",
      "outcomeLinks",
      "limitations",
    ],
    ["treatmentField"],
    name,
  );
  if (decoded.schemaVersion !== 1) throw new Error(`${name}.schemaVersion is unsupported.`);
  if (decoded.claimType !== "descriptive" && decoded.claimType !== "matched-contrast") {
    throw new Error(`${name}.claimType is invalid.`);
  }
  const experimentalUnit = exact(
    decoded.experimentalUnit,
    ["unit", "clusterByRun"],
    `${name}.experimentalUnit`,
  );
  if (experimentalUnit.unit !== "team" && experimentalUnit.unit !== "origin") {
    throw new Error(`${name}.experimentalUnit.unit is invalid.`);
  }
  if (typeof experimentalUnit.clusterByRun !== "boolean") {
    throw new Error(`${name}.experimentalUnit.clusterByRun must be boolean.`);
  }
  const matchingFields = strings(decoded.matchingFields, `${name}.matchingFields`).map(
    (pointer, index) => jsonPointer(pointer, `${name}.matchingFields[${index}]`),
  );
  unique(matchingFields, `${name}.matchingFields`);
  if (
    decoded.claimType === "matched-contrast" &&
    (matchingFields.length === 0 || decoded.treatmentField === undefined)
  ) {
    throw new Error(`${name} matched contrasts require matchingFields and treatmentField.`);
  }
  if (decoded.claimType === "descriptive" && decoded.treatmentField !== undefined) {
    throw new Error(`${name}.treatmentField is only valid for matched contrasts.`);
  }
  return {
    schemaVersion: 1,
    reportId: controlledId(decoded.reportId, `${name}.reportId`),
    createdAt: timestamp(decoded.createdAt, `${name}.createdAt`),
    claimType: decoded.claimType,
    experimentalUnit: {
      unit: experimentalUnit.unit,
      clusterByRun: experimentalUnit.clusterByRun,
    },
    matchingFields,
    ...(decoded.treatmentField === undefined
      ? {}
      : { treatmentField: jsonPointer(decoded.treatmentField, `${name}.treatmentField`) }),
    included: reportObjects(decoded.included, `${name}.included`),
    excluded: reportObjects(decoded.excluded, `${name}.excluded`),
    dimensions: reportObjects(decoded.dimensions, `${name}.dimensions`),
    reviewerAgreement: reportObjects(decoded.reviewerAgreement, `${name}.reviewerAgreement`),
    outcomeLinks: reportObjects(decoded.outcomeLinks, `${name}.outcomeLinks`),
    limitations: strings(decoded.limitations, `${name}.limitations`),
  };
}
