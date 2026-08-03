import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { canonicalJson, contentDigest } from "../canonical.js";
import type { GitRepositoryId } from "../git.js";
import { createAiSdkModelAdapter } from "../model/ai-sdk-adapter.js";
import type {
  AgentId,
  JsonObject,
  ModelAdapter,
  ModelFinishReason,
  ModelResponseIdentity,
  ModelTurn,
  ProviderDriver,
  StructuredOutputRequest,
  TokenUsage,
} from "../model/contracts.js";
import { runPythonJson } from "../python.js";
import {
  appendRunAnalysis,
  loadRunRecord,
  type PerformanceRunAnalysis,
  type ProcessReviewRunAnalysis,
  type RunRecord,
} from "../run/record.js";
import {
  decodeEvidenceBundle,
  decodeDimensionReview,
  decodeEpistemicEpisode,
  decodeJudgeReview,
  decodeReviewerOutput,
  decodeRunScorecard,
  type DimensionReview,
  type EvidenceBundle,
  type EvidenceItem,
  type EvidenceReference,
  type JudgeReview,
  type QuantitativeMeasure,
  type ReviewerOutput,
  type RunScorecard,
} from "./contracts.js";
import {
  loadGradingConfigurationSource,
  type GradingConfiguration,
  type OfficialProviderFamily,
} from "./config.js";
import { assertOutcomeBlindEvidenceBundle, compileEvidence } from "./evidence.js";
import {
  createMeasureRequest,
  decodePerformanceMetrics,
  type PerformanceMetrics,
  type ReviewMeasureInput,
} from "./grade.js";
import { EPISTEMIC_PROCESS_RUBRIC, EPISTEMIC_PROCESS_RUBRIC_VERSION } from "./rubric.js";
import {
  compileReviewPackets,
  REVIEW_PACKET_PROJECTION_VERSION,
  REVIEW_PACKET_ROUTING_VERSION,
  type ReviewPacket,
  type ReviewPacketLedger,
} from "./packets.js";

export {
  decodeGradingConfiguration,
  gradingConfigurationDigest,
  loadGradingConfig,
  type GradingConfiguration,
  type GradingModelProfile,
  type GradingReviewerProfile,
} from "./config.js";

const OFFICIAL_CREDENTIAL_ENV = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
} as const satisfies Readonly<Record<Exclude<ProviderDriver, "openai-compatible">, string>>;

export interface ReviewAdapterOptions {
  readonly profileId: string;
  readonly providerFamily: OfficialProviderFamily;
  readonly model: string;
  readonly apiKeyEnv: string;
  readonly tokenLimit: number;
  readonly maxOutputTokens: number;
  readonly env: NodeJS.ProcessEnv;
}

export interface ReviewDependencies {
  readonly createAdapter?: (options: ReviewAdapterOptions) => ModelAdapter;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly randomUUID?: () => string;
  readonly appendAnalysis?: typeof appendRunAnalysis;
  readonly invokePython?: typeof runPythonJson;
}

export interface ReviewRunOptions {
  readonly projectRoot: string;
  readonly runRoot: string;
  readonly configPath: string;
  readonly performanceAnalysisId: string;
  readonly allowSpend: unknown;
  readonly resumeAnalysisId?: string;
}

export interface ReviewRunResult {
  readonly analysis: ProcessReviewRunAnalysis;
  readonly record: RunRecord;
  readonly path: string;
  readonly scorecards?: readonly RunScorecard[];
}

export interface ReviewRunFlags {
  readonly "run-root"?: string;
  readonly config?: string;
  readonly "performance-analysis"?: string;
  readonly "allow-spend"?: unknown;
  readonly resume?: string;
}

export const REVIEW_PROTOCOL_VERSION = "ledger-packets-v1" as const;
export const REVIEW_PROMPT_VERSION = "ledger-packet-prompt-v1" as const;
export const REVIEW_OUTPUT_SCHEMA_VERSION = "ledger-packet-output-v1" as const;

interface RetainedTurn {
  readonly response: string;
  readonly responseIdentity: ModelResponseIdentity;
  readonly usage: TokenUsage;
  readonly finishReason?: ModelFinishReason;
  readonly rawFinishReason?: string;
  readonly responseId?: string;
  readonly structuredOutputValidation?: ModelTurn["structuredOutputValidation"];
}

interface OriginTranscript {
  readonly originId: string;
  readonly packets: readonly PacketCallArtifact[];
}

interface JudgeTranscript {
  readonly schemaVersion: 1;
  readonly reviewId: string;
  readonly providerFamily: OfficialProviderFamily;
  readonly requestedModel: string;
  readonly reviewerProfile: string;
  readonly bundleDigest: string;
  readonly origins: readonly OriginTranscript[];
  readonly cumulativeTokens: number;
  readonly error?: string;
}

interface ValidatedOriginReview {
  readonly originId: string;
  readonly output: ReviewerOutput;
}

interface ValidatedJudgeReview {
  readonly schemaVersion: 1;
  readonly reviewId: string;
  readonly providerFamily: OfficialProviderFamily;
  readonly requestedModel: string;
  readonly bundleDigest: string;
  readonly origins: readonly ValidatedOriginReview[];
}

interface ExactPerformanceDetails {
  readonly bundle: EvidenceBundle;
  readonly metrics: PerformanceMetrics;
}

interface JudgeAttempt {
  readonly transcript: JudgeTranscript;
  readonly review?: ValidatedJudgeReview;
  readonly status: "completed" | "invalid" | "provider-error";
}

interface DetailFile {
  readonly path: string;
  readonly role: string;
  readonly content: unknown;
}

interface PacketRequestIdentity {
  readonly schemaVersion: 1;
  readonly protocolVersion: typeof REVIEW_PROTOCOL_VERSION;
  readonly promptVersion: typeof REVIEW_PROMPT_VERSION;
  readonly outputSchemaVersion: typeof REVIEW_OUTPUT_SCHEMA_VERSION;
  readonly routingVersion: typeof REVIEW_PACKET_ROUTING_VERSION;
  readonly projectionVersion: typeof REVIEW_PACKET_PROJECTION_VERSION;
  readonly bundleDigest: string;
  readonly configurationDigest: string;
  readonly rubricDigest: string;
  readonly reviewerProfile: string;
  readonly providerFamily: OfficialProviderFamily;
  readonly requestedModel: string;
  readonly packetId: string;
  readonly packetDigest: string;
}

interface CompletedPacketCallArtifact {
  readonly schemaVersion: 1;
  readonly status: "completed";
  readonly artifactKey: string;
  readonly request: PacketRequestIdentity;
  readonly actualProvider: string;
  readonly actualModel: string;
  readonly turn: RetainedTurn;
  readonly output: PacketReviewerOutput;
}

interface FailedPacketCallArtifact {
  readonly schemaVersion: 1;
  readonly status: "failed";
  readonly artifactKey: string;
  readonly request: PacketRequestIdentity;
  readonly failure: {
    readonly classification: string;
    readonly message: string;
    readonly finishReason: ModelFinishReason | UnavailableMetadata;
    readonly rawFinishReason: string | UnavailableMetadata;
    readonly usage: TokenUsage | UnavailableMetadata;
    readonly responseId: string | UnavailableMetadata;
    readonly responseIdentity: ModelResponseIdentity | UnavailableMetadata;
    readonly structuredOutputValidation:
      | NonNullable<ModelTurn["structuredOutputValidation"]>
      | UnavailableMetadata;
    readonly textReturned: boolean;
    readonly responseText: string;
  };
}

interface UnavailableMetadata {
  readonly status: "unavailable";
}

const UNAVAILABLE_METADATA: UnavailableMetadata = { status: "unavailable" };

type PacketCallArtifact = CompletedPacketCallArtifact | FailedPacketCallArtifact;

interface PacketReview {
  readonly ledger: ReviewPacketLedger;
  readonly dimensions: readonly DimensionReview[];
  readonly episodes: ReviewerOutput["episodes"];
  readonly cautions: readonly string[];
}

export interface PacketDimensionOutput {
  readonly state: "rated" | "unobservable" | "not-applicable";
  readonly rating?: 0 | 1 | 2 | 3 | 4;
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
  readonly counterevidenceIds: readonly string[];
  readonly confidence: "low" | "medium" | "high";
}

export interface PacketEpisodeOutput {
  readonly episodeId: string;
  readonly summary: string;
  readonly status:
    | "supported-revision"
    | "asserted-only"
    | "missed-revision"
    | "unchanged"
    | "ambiguous";
  readonly evidenceIds: readonly string[];
  readonly commitmentIds: readonly string[];
  readonly testIds: readonly string[];
  readonly revisionIds: readonly string[];
  readonly transmissionIds: readonly string[];
  readonly uptakeIds: readonly string[];
  readonly integrationIds: readonly string[];
  readonly counterevidenceIds: readonly string[];
  readonly confidence: "low" | "medium" | "high";
}

export interface PacketReviewerOutput {
  readonly schemaVersion: 1;
  readonly rubricVersion: string;
  readonly bundleDigest: string;
  readonly packetId: string;
  readonly packetDigest: string;
  readonly ledger: ReviewPacketLedger;
  readonly dimensions: Readonly<Record<string, PacketDimensionOutput>>;
  readonly episodes?: readonly PacketEpisodeOutput[];
  readonly cautions: readonly string[];
}

interface DecodedPacketReviewerOutput {
  readonly output: PacketReviewerOutput;
  readonly review: PacketReview;
}

const object = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
};

function exact(value: unknown, required: readonly string[], name: string): Record<string, unknown> {
  const decoded = object(value, name);
  const actual = Object.keys(decoded).sort();
  const expected = [...required].sort();
  if (actual.join("\0") !== expected.join("\0")) {
    throw new Error(`${name} contains unknown or missing fields.`);
  }
  return decoded;
}

function nonEmptyText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function credentialPreflight(
  config: GradingConfiguration,
  env: NodeJS.ProcessEnv,
): readonly ReviewAdapterOptions[] {
  return config.reviewers.map((reviewer) => {
    const model = config.models[reviewer.profile]!;
    const apiKeyEnv = OFFICIAL_CREDENTIAL_ENV[model.provider];
    if (env[apiKeyEnv] === undefined || env[apiKeyEnv] === "") {
      throw new Error(
        `Reviewer profile ${reviewer.profile} requires environment variable ${apiKeyEnv}.`,
      );
    }
    return {
      profileId: reviewer.profile,
      providerFamily: model.provider,
      model: model.model,
      apiKeyEnv,
      tokenLimit: reviewer.tokenLimit,
      maxOutputTokens: reviewer.maxOutputTokens,
      env,
    };
  });
}

function defaultCreateAdapter(options: ReviewAdapterOptions): ModelAdapter {
  return createAiSdkModelAdapter({
    providerId: options.providerFamily,
    provider: { driver: options.providerFamily, apiKeyEnv: options.apiKeyEnv },
    model: options.model,
    settings: { maxOutputTokens: options.maxOutputTokens },
    env: options.env,
  });
}

const LEAKED_KEY =
  /(?:^|[-_.])(model|models|provider|providers|requestedmodel|actualmodel|actualprovider|responseidentity|evaluation|evaluations|matchedwords|coverage|accuracy|success|score|oracle|plaintext|key|manipulationcheck|analyses|reviews?)(?:$|[-_.])/i;
const LEAKED_TEXT =
  /\b(?:final score|matched words|reconstruction score|successful run|unsuccessful run|evaluation\.completed)\b/i;

function scanForLeakage(
  value: unknown,
  sensitiveValues: readonly string[],
  path = "$bundle",
): void {
  if (typeof value === "string") {
    if (LEAKED_TEXT.test(value))
      throw new Error(`Reviewer bundle contains outcome leakage at ${path}.`);
    const leaked = sensitiveValues.find(
      (candidate) => candidate.length >= 4 && value.includes(candidate),
    );
    if (leaked !== undefined)
      throw new Error(`Reviewer bundle contains identity leakage at ${path}.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanForLeakage(item, sensitiveValues, `${path}[${String(index)}]`),
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase();
    if (LEAKED_KEY.test(key) || LEAKED_KEY.test(normalizedKey)) {
      throw new Error(`Reviewer bundle contains prohibited field ${path}.${key}.`);
    }
    scanForLeakage(child, sensitiveValues, `${path}.${key}`);
  }
}

export function validateReviewerBundleLeakage(bundle: EvidenceBundle, record?: RunRecord): void {
  const sensitive =
    record === undefined
      ? []
      : record.configuration.models.flatMap(({ binding }) =>
          [
            binding.profile,
            binding.provider,
            binding.driver,
            binding.requestedModel,
            binding.actualProvider,
            binding.actualModel,
          ].filter((item): item is string => item !== undefined && item.length > 0),
        );
  scanForLeakage(bundle, [...new Set(sensitive)]);
}

function referenceLocator(reference: EvidenceReference): string {
  switch (reference.source) {
    case "trace":
      return `trace:${String(reference.traceSequence)}:${reference.excerptDigest}`;
    case "run-record":
      return `run-record:${reference.recordPointer}:${reference.excerptDigest}`;
    case "git":
      return `git:${reference.originId}:${reference.commit}:${reference.path ?? ""}:${reference.excerptDigest}`;
  }
}

function validateReferences(
  references: readonly EvidenceReference[],
  allowed: ReadonlySet<string>,
  name: string,
): void {
  for (const reference of references) {
    if (!allowed.has(referenceLocator(reference))) {
      throw new Error(`${name} contains a citation outside the exact evidence bundle.`);
    }
  }
}

const HIDDEN_STATE_CLAIM =
  /\b(?:believed|thought|knew|understood|realized|intended|wanted|felt|private reasoning|hidden state)\b/i;
const OUTCOME_CLAIM =
  /\b(?:final outcome|final score|matched words|coverage|accuracy|successful run|unsuccessful run|won|lost)\b/i;

function validateObservableText(value: string, name: string): void {
  if (HIDDEN_STATE_CLAIM.test(value))
    throw new Error(`${name} makes a prohibited hidden-state claim.`);
  if (OUTCOME_CLAIM.test(value)) throw new Error(`${name} makes a prohibited outcome claim.`);
}

function validateReviewerOutputAgainstBundle(
  output: ReviewerOutput,
  bundle: EvidenceBundle,
): ReviewerOutput {
  if (output.rubricVersion !== EPISTEMIC_PROCESS_RUBRIC_VERSION) {
    throw new Error("Reviewer output rubricVersion differs from the configured rubric.");
  }
  if (output.bundleDigest !== bundle.contentDigest) {
    throw new Error("Reviewer output bundleDigest differs from the exact evidence bundle.");
  }
  const expectedDimensions = EPISTEMIC_PROCESS_RUBRIC.dimensions;
  if (
    output.dimensions.length !== expectedDimensions.length ||
    output.dimensions.some(
      (dimension, index) =>
        dimension.dimensionId !== expectedDimensions[index]!.dimensionId ||
        dimension.ledger !== expectedDimensions[index]!.ledger,
    )
  ) {
    throw new Error("Reviewer output dimensions must exactly match the ordered rubric dimensions.");
  }
  if (
    bundle.communicationMode === "isolated" &&
    output.dimensions.some(
      (dimension) => dimension.ledger === "social" && dimension.state !== "not-applicable",
    )
  ) {
    throw new Error(
      "Social dimensions must be not-applicable when peer collaboration is unavailable.",
    );
  }
  const allowed = new Set(bundle.items.map(({ reference }) => referenceLocator(reference)));
  const itemsByReference = new Map(
    bundle.items.map((item) => [referenceLocator(item.reference), item] as const),
  );
  for (const dimension of output.dimensions) {
    validateObservableText(dimension.rationale, `Dimension ${dimension.dimensionId}.rationale`);
    validateReferences(dimension.evidence, allowed, `Dimension ${dimension.dimensionId}.evidence`);
    validateReferences(
      dimension.counterevidence,
      allowed,
      `Dimension ${dimension.dimensionId}.counterevidence`,
    );
  }
  for (const episode of output.episodes) {
    validateObservableText(episode.summary, `Episode ${episode.episodeId}.summary`);
    for (const [stage, references] of Object.entries({
      evidence: episode.evidence,
      commitment: episode.commitment,
      test: episode.test,
      revision: episode.revision,
      transmission: episode.transmission,
      uptake: episode.uptake,
      integration: episode.integration,
      counterevidence: episode.counterevidence,
    })) {
      validateReferences(references, allowed, `Episode ${episode.episodeId}.${stage}`);
    }
    if (episode.status === "supported-revision" && episode.revision.length === 0) {
      throw new Error(`Episode ${episode.episodeId} requires observable revision evidence.`);
    }
    if (episode.status === "asserted-only" && episode.revision.length === 0) {
      throw new Error(`Episode ${episode.episodeId} requires the asserted revision citation.`);
    }
    if (episode.uptake.length > 0 && episode.transmission.length === 0) {
      throw new Error(
        `Episode ${episode.episodeId} uptake requires a cited transmitted contribution.`,
      );
    }
    if (episode.uptake.length > 0) {
      const transmissions = episode.transmission.map((reference) =>
        itemsByReference.get(referenceLocator(reference))!,
      );
      const uptakes = episode.uptake.map((reference) =>
        itemsByReference.get(referenceLocator(reference))!,
      );
      if (
        !transmissions.some((transmission) =>
          uptakes.some(
            (uptake) => transmission.actorId !== uptake.actorId && transmission.atMs <= uptake.atMs,
          ),
        )
      ) {
        throw new Error(
          `Episode ${episode.episodeId} uptake must link an earlier contribution to a different actor's action.`,
        );
      }
    }
    if (episode.integration.length > 0 && episode.uptake.length === 0) {
      throw new Error(`Episode ${episode.episodeId} integration requires cited uptake.`);
    }
    if (episode.integration.length > 0) {
      const latestUptake = Math.max(
        ...episode.uptake.map(
          (reference) => itemsByReference.get(referenceLocator(reference))!.atMs,
        ),
      );
      if (
        episode.integration.every(
          (reference) => itemsByReference.get(referenceLocator(reference))!.atMs < latestUptake,
        )
      ) {
        throw new Error(`Episode ${episode.episodeId} integration must follow its cited uptake.`);
      }
    }
  }
  output.overallCautions.forEach((caution, index) =>
    validateObservableText(caution, `Reviewer output overallCautions[${String(index)}]`),
  );
  return output;
}

function decodePacketReviewerOutput(
  value: unknown,
  packet: ReviewPacket,
): DecodedPacketReviewerOutput {
  const required = [
    "schemaVersion",
    "rubricVersion",
    "bundleDigest",
    "packetId",
    "packetDigest",
    "ledger",
    "dimensions",
    ...(packet.ledger === "epistemic" ? ["episodes"] : []),
    "cautions",
  ];
  const decoded = exact(value, required, "Packet reviewer output");
  if (
    decoded.schemaVersion !== 1 ||
    decoded.rubricVersion !== EPISTEMIC_PROCESS_RUBRIC_VERSION ||
    decoded.bundleDigest !== packet.bundleDigest ||
    decoded.packetId !== packet.packetId ||
    decoded.packetDigest !== packet.contentDigest ||
    decoded.ledger !== packet.ledger
  ) {
    throw new Error("Packet reviewer output identity differs from the exact packet request.");
  }
  const references = new Map(
    packet.citations.map(({ citationId, reference }) => [citationId, reference] as const),
  );
  const resolveCitations = (citations: unknown, name: string): readonly EvidenceReference[] => {
    if (!Array.isArray(citations)) throw new Error(`${name} must be an array.`);
    const resolved = citations.map((citation, index) => {
      const citationId = nonEmptyText(citation, `${name}[${String(index)}]`);
      const reference = references.get(citationId);
      if (reference === undefined) {
        throw new Error(`${name}[${String(index)}] cites an ID outside the exact packet.`);
      }
      return reference;
    });
    if (new Set(citations).size !== citations.length) throw new Error(`${name} must be unique.`);
    return resolved;
  };
  const rubricDimensions = EPISTEMIC_PROCESS_RUBRIC.dimensions.filter(
    ({ ledger }) => ledger === packet.ledger,
  );
  const dimensions = exact(
    decoded.dimensions,
    rubricDimensions.map(({ dimensionId }) => dimensionId),
    "Packet reviewer dimensions",
  );
  const resolvedDimensions = rubricDimensions.map(({ dimensionId, ledger }, index) => {
    const name = `Packet reviewer dimension ${String(index + 1)}`;
    const candidate = object(dimensions[dimensionId], name);
    const common = ["state", "rationale", "evidenceIds", "counterevidenceIds", "confidence"];
    const item =
      candidate.state === "rated"
        ? exact(candidate, [...common, "rating"], name)
        : exact(candidate, common, name);
    const resolved = decodeDimensionReview(
      {
        dimensionId,
        ledger,
        state: item.state,
        ...(item.rating === undefined ? {} : { rating: item.rating }),
        rationale: item.rationale,
        evidence: resolveCitations(item.evidenceIds, `${name}.evidenceIds`),
        counterevidence: resolveCitations(item.counterevidenceIds, `${name}.counterevidenceIds`),
        confidence: item.confidence,
      },
      name,
    );
    validateObservableText(resolved.rationale, `${name}.rationale`);
    return resolved;
  });
  const episodesValue = packet.ledger === "epistemic" ? decoded.episodes : [];
  if (!Array.isArray(episodesValue)) throw new Error("Packet reviewer episodes must be an array.");
  const episodes = episodesValue.map((episode, index) => {
    const name = `Packet reviewer episode ${String(index + 1)}`;
    const item = exact(
      episode,
      [
        "episodeId",
        "summary",
        "status",
        "evidenceIds",
        "commitmentIds",
        "testIds",
        "revisionIds",
        "transmissionIds",
        "uptakeIds",
        "integrationIds",
        "counterevidenceIds",
        "confidence",
      ],
      name,
    );
    const resolved = decodeEpistemicEpisode(
      {
        episodeId: item.episodeId,
        summary: item.summary,
        status: item.status,
        evidence: resolveCitations(item.evidenceIds, `${name}.evidenceIds`),
        commitment: resolveCitations(item.commitmentIds, `${name}.commitmentIds`),
        test: resolveCitations(item.testIds, `${name}.testIds`),
        revision: resolveCitations(item.revisionIds, `${name}.revisionIds`),
        transmission: resolveCitations(item.transmissionIds, `${name}.transmissionIds`),
        uptake: resolveCitations(item.uptakeIds, `${name}.uptakeIds`),
        integration: resolveCitations(item.integrationIds, `${name}.integrationIds`),
        counterevidence: resolveCitations(item.counterevidenceIds, `${name}.counterevidenceIds`),
        confidence: item.confidence,
      },
      name,
    );
    validateObservableText(resolved.summary, `${name}.summary`);
    return resolved;
  });
  if (!Array.isArray(decoded.cautions))
    throw new Error("Packet reviewer cautions must be an array.");
  const cautions = decoded.cautions.map((value, index) => {
    const caution = nonEmptyText(value, `Packet reviewer cautions[${String(index)}]`);
    validateObservableText(caution, `Packet reviewer cautions[${String(index)}]`);
    return caution;
  });
  return {
    output: value as PacketReviewerOutput,
    review: {
      ledger: packet.ledger,
      dimensions: resolvedDimensions,
      episodes,
      cautions,
    },
  };
}

function strictObjectSchema(
  properties: Readonly<Record<string, JsonObject>>,
  required: readonly string[] = Object.keys(properties),
): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function evidenceIdDefinitions(evidenceIds: readonly string[]): JsonObject {
  return {
    citationId: {
      type: "string",
      ...(evidenceIds.length === 0 ? { const: "__no_valid_evidence_id__" } : { enum: evidenceIds }),
    },
  };
}

function citationIdsSchema(): JsonObject {
  return {
    type: "array",
    items: { $ref: "#/$defs/citationId" },
  };
}

function dimensionOutputSchema(
  ledger: "epistemic" | "social" | "instrumental",
  communicationMode: EvidenceBundle["communicationMode"],
): JsonObject {
  const common = {
    rationale: { type: "string" },
    counterevidenceIds: citationIdsSchema(),
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  } as const satisfies Readonly<Record<string, JsonObject>>;
  if (communicationMode === "isolated" && ledger === "social") {
    return strictObjectSchema({
      state: { type: "string", const: "not-applicable" },
      ...common,
      evidenceIds: citationIdsSchema(),
    });
  }
  return {
    anyOf: [
      strictObjectSchema({
        state: { type: "string", const: "rated" },
        rating: { type: "integer", enum: [0, 1, 2, 3, 4] },
        ...common,
        evidenceIds: citationIdsSchema(),
      }),
      strictObjectSchema({
        state: { type: "string", enum: ["unobservable", "not-applicable"] },
        ...common,
        evidenceIds: citationIdsSchema(),
      }),
    ],
  };
}

function episodeOutputSchema(): JsonObject {
  return strictObjectSchema({
    episodeId: { type: "string" },
    summary: { type: "string" },
    status: {
      type: "string",
      enum: ["supported-revision", "asserted-only", "missed-revision", "unchanged", "ambiguous"],
    },
    evidenceIds: citationIdsSchema(),
    commitmentIds: citationIdsSchema(),
    testIds: citationIdsSchema(),
    revisionIds: citationIdsSchema(),
    transmissionIds: citationIdsSchema(),
    uptakeIds: citationIdsSchema(),
    integrationIds: citationIdsSchema(),
    counterevidenceIds: citationIdsSchema(),
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  });
}

function packetOutputSchema(packet: ReviewPacket): JsonObject {
  const dimensions = EPISTEMIC_PROCESS_RUBRIC.dimensions.filter(
    ({ ledger }) => ledger === packet.ledger,
  );
  return {
    ...strictObjectSchema({
      schemaVersion: { type: "integer", const: 1 },
      rubricVersion: { type: "string", const: EPISTEMIC_PROCESS_RUBRIC_VERSION },
      bundleDigest: { type: "string", const: packet.bundleDigest },
      packetId: { type: "string", const: packet.packetId },
      packetDigest: { type: "string", const: packet.contentDigest },
      ledger: { type: "string", const: packet.ledger },
      dimensions: strictObjectSchema(
        Object.fromEntries(
          dimensions.map(({ dimensionId, ledger }) => [
            dimensionId,
            dimensionOutputSchema(ledger, "shared"),
          ]),
        ),
      ),
      ...(packet.ledger === "epistemic"
        ? { episodes: { type: "array", items: episodeOutputSchema() } }
        : {}),
      cautions: { type: "array", items: { type: "string" } },
    }),
    $defs: evidenceIdDefinitions(packet.citations.map(({ citationId }) => citationId)),
  };
}

async function callReviewer(
  adapter: ModelAdapter,
  agentId: AgentId,
  prompt: string,
  structuredOutput: StructuredOutputRequest,
): Promise<ModelTurn> {
  try {
    const session = await adapter.openSession({ agentId, tools: [] });
    const signal = new AbortController().signal;
    return await session.respond({ prompt, toolResults: [], signal, structuredOutput });
  } catch (error) {
    throw new ProviderCallError(error);
  }
}

function retainedCompletedTurn(turn: ModelTurn): RetainedTurn {
  if (turn.toolCalls.length > 0) throw new Error("Reviewer responses cannot invoke tools.");
  const response = turn.responseText ?? turn.finalResponse ?? "";
  if (response.trim() === "") throw new Error("Reviewer returned no response text.");
  if (turn.finishReason !== undefined && turn.finishReason !== "stop") {
    throw new Error(`Reviewer response did not stop normally (${turn.finishReason}).`);
  }
  if (
    turn.structuredOutputValidation !== undefined &&
    turn.structuredOutputValidation.status !== "validated"
  ) {
    throw new Error(turn.structuredOutputValidation.error);
  }
  if (turn.usage === undefined) {
    throw new Error("Reviewer response token usage is unavailable.");
  }
  if (
    turn.responseIdentity?.actualProvider === undefined ||
    turn.responseIdentity.actualModel === undefined
  ) {
    throw new Error("Reviewer response did not report its actual provider and model identity.");
  }
  return {
    response,
    responseIdentity: turn.responseIdentity,
    usage: turn.usage,
    ...(turn.finishReason === undefined ? {} : { finishReason: turn.finishReason }),
    ...(turn.rawFinishReason === undefined ? {} : { rawFinishReason: turn.rawFinishReason }),
    ...(turn.responseId === undefined ? {} : { responseId: turn.responseId }),
    ...(turn.structuredOutputValidation === undefined
      ? {}
      : { structuredOutputValidation: turn.structuredOutputValidation }),
  };
}

class ProviderCallError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error));
    this.name = "ProviderCallError";
  }
}

class ReviewerTokenLimitError extends Error {
  constructor(tokenLimit: number, observedTokens: number) {
    super(
      observedTokens > tokenLimit
        ? `Reviewer token limit ${String(tokenLimit)} was exceeded by the retained response (${String(observedTokens)} cumulative tokens).`
        : `Reviewer token limit ${String(tokenLimit)} was reached; no further provider calls are allowed.`,
    );
    this.name = "ReviewerTokenLimitError";
  }
}

function addTurnUsage(total: number, turn: RetainedTurn): number {
  if (
    !Number.isSafeInteger(turn.usage.inputTokens) ||
    turn.usage.inputTokens < 0 ||
    !Number.isSafeInteger(turn.usage.outputTokens) ||
    turn.usage.outputTokens < 0
  ) {
    throw new Error("Reviewer token usage must contain non-negative safe integers.");
  }
  const next = total + turn.usage.inputTokens + turn.usage.outputTokens;
  if (!Number.isSafeInteger(next) || next < total) {
    throw new Error("Reviewer cumulative token usage must be a non-negative safe integer.");
  }
  return next;
}

function reviewSurfaceForOrigin(
  bundle: EvidenceBundle,
  record: RunRecord,
  originId: string,
): EvidenceBundle {
  if (bundle.communicationMode === "shared") return bundle;
  const originIndex = record.topology.origins.findIndex(
    (candidate) => candidate.originId === originId,
  );
  const origin = record.topology.origins[originIndex];
  if (origin === undefined) throw new Error(`Unknown canonical origin ${originId}.`);
  const repositoryId = `origin-${String(originIndex + 1)}`;
  const actorIds = new Set(
    origin.agentIds.map((agentId) => {
      const sessionIndex = record.sessions.findIndex((session) => session.agentId === agentId);
      const actorId = bundle.actors[sessionIndex];
      if (actorId === undefined) {
        throw new Error(`Canonical origin ${originId} has no anonymized evidence actor.`);
      }
      return actorId;
    }),
  );
  const items = bundle.items.filter((item) => {
    if (item.actorId !== "runner") return actorIds.has(item.actorId);
    const content =
      typeof item.content === "object" && item.content !== null && !Array.isArray(item.content)
        ? (item.content as Record<string, unknown>)
        : undefined;
    if (typeof content?.repositoryId === "string") {
      return content.repositoryId === repositoryId;
    }
    // Git changes are origin-scoped; missing or excerpted scope must not cross isolated origins.
    return item.kind !== "git.changed";
  });
  const visibleIds = new Set(items.map(({ evidenceId }) => evidenceId));
  const windows = bundle.windows.flatMap((window) => {
    const evidenceIds = window.evidenceIds.filter((evidenceId) => visibleIds.has(evidenceId));
    if (evidenceIds.length === 0) return [];
    const byteCount = items
      .filter((item) => evidenceIds.includes(item.evidenceId))
      .reduce((total, item) => total + Buffer.byteLength(canonicalJson(item)), 0);
    return [{ ...window, evidenceIds, byteCount }];
  });
  return { ...bundle, items, windows };
}

function packetPrompt(packet: ReviewPacket): string {
  const rubric = {
    ...EPISTEMIC_PROCESS_RUBRIC,
    dimensions: EPISTEMIC_PROCESS_RUBRIC.dimensions.filter(
      ({ ledger }) => ledger === packet.ledger,
    ),
  };
  return [
    "PALIMPSEST_PROCESS_REVIEW_LEDGER_PACKET_V1",
    `Ledger: ${packet.ledger}`,
    `Anonymous canonical origin ordinal: ${String(packet.origin.ordinal)}`,
    "Judge only observable retained behavior. Never infer private beliefs, intentions, hidden reasoning, outcome, success, score, model identity, or provider identity.",
    "Return one concise evidence-bounded assessment for every rubric dimension in this packet. Preserve missingness, ambiguity, and counterevidence.",
    packet.ledger === "epistemic"
      ? "Also reconstruct at most eight highest-value observable episodes. Transmission, uptake, and integration require exact cited behavior; leave unsupported stages empty."
      : "Do not return epistemic episodes; this packet owns only its ledger dimensions and cautions.",
    "Every citation field must contain exact short citationId values from this packet. Never return reference objects, evidenceId values, or partial IDs.",
    "Use one concise sentence per rationale, at most six citation IDs per field, and at most four concise cautions. Begin final JSON early and reserve enough output budget to complete it.",
    `Rubric: ${canonicalJson(rubric)}`,
    `Packet: ${canonicalJson(packet)}`,
  ].join("\n\n");
}

function packetRequestIdentity(
  packet: ReviewPacket,
  options: ReviewAdapterOptions,
): PacketRequestIdentity {
  return {
    schemaVersion: 1,
    protocolVersion: REVIEW_PROTOCOL_VERSION,
    promptVersion: REVIEW_PROMPT_VERSION,
    outputSchemaVersion: REVIEW_OUTPUT_SCHEMA_VERSION,
    routingVersion: packet.routingVersion,
    projectionVersion: packet.projectionVersion,
    bundleDigest: packet.bundleDigest,
    configurationDigest: packet.configurationDigest,
    rubricDigest: packet.rubricDigest,
    reviewerProfile: options.profileId,
    providerFamily: options.providerFamily,
    requestedModel: options.model,
    packetId: packet.packetId,
    packetDigest: packet.contentDigest,
  };
}

function completedPacketArtifact(
  request: PacketRequestIdentity,
  turn: ModelTurn,
  output: PacketReviewerOutput,
): CompletedPacketCallArtifact {
  const retained = retainedCompletedTurn(turn);
  const actualProvider = retained.responseIdentity.actualProvider!;
  const actualModel = retained.responseIdentity.actualModel!;
  const content = {
    schemaVersion: 1 as const,
    status: "completed" as const,
    request,
    actualProvider,
    actualModel,
    turn: retained,
    output,
  };
  return { ...content, artifactKey: contentDigest(content) };
}

function failureClassification(error: unknown, turn?: ModelTurn): string {
  if (turn?.finishReason !== undefined && turn.finishReason !== "stop") {
    return `finish-${turn.finishReason}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/overload/i.test(message)) return "overloaded";
  if (/refus/i.test(message)) return "refusal";
  if (/token usage is unavailable/i.test(message)) return "usage-unavailable";
  if (error instanceof ProviderCallError) return "provider-error";
  const responseText = turn?.responseText ?? turn?.finalResponse ?? "";
  if (responseText.trim() === "" || /no response text|no output|empty/i.test(message)) {
    return "empty-output";
  }
  if (turn?.structuredOutputValidation?.status === "invalid") {
    try {
      JSON.parse(responseText);
      return "schema-invalid";
    } catch {
      return "malformed-json";
    }
  }
  return "invalid-output";
}

function failedPacketArtifact(
  request: PacketRequestIdentity,
  error: unknown,
  turn?: ModelTurn,
): FailedPacketCallArtifact {
  const responseText = turn?.responseText ?? turn?.finalResponse ?? "";
  const message = error instanceof Error ? error.message : String(error);
  const content = {
    schemaVersion: 1 as const,
    status: "failed" as const,
    request,
    failure: {
      classification: failureClassification(error, turn),
      message,
      finishReason: turn?.finishReason ?? UNAVAILABLE_METADATA,
      rawFinishReason: turn?.rawFinishReason ?? UNAVAILABLE_METADATA,
      usage: turn?.usage ?? UNAVAILABLE_METADATA,
      responseId: turn?.responseId ?? UNAVAILABLE_METADATA,
      responseIdentity: turn?.responseIdentity ?? UNAVAILABLE_METADATA,
      structuredOutputValidation: turn?.structuredOutputValidation ?? UNAVAILABLE_METADATA,
      textReturned: responseText.length > 0,
      responseText,
    },
  };
  return { ...content, artifactKey: contentDigest(content) };
}

function deterministicSocialDimensions(): readonly DimensionReview[] {
  return EPISTEMIC_PROCESS_RUBRIC.dimensions
    .filter(({ ledger }) => ledger === "social")
    .map(({ dimensionId, ledger }) => ({
      dimensionId,
      ledger,
      state: "not-applicable" as const,
      rationale: "No peer collaboration channel was available in this condition.",
      evidence: [],
      counterevidence: [],
      confidence: "high" as const,
    }));
}

async function runJudge(
  adapter: ModelAdapter,
  adapterOptions: ReviewAdapterOptions,
  bundle: EvidenceBundle,
  originPackets: readonly {
    readonly originId: string;
    readonly surface: EvidenceBundle;
    readonly packets: readonly [ReviewPacket, ReviewPacket, ReviewPacket];
  }[],
  reviewId: string,
  judgeIndex: number,
  resumeArtifacts: readonly PacketCallArtifact[],
  initialCumulativeTokens: number,
  onArtifact: (artifact: PacketCallArtifact) => Promise<void>,
): Promise<JudgeAttempt> {
  const origins: OriginTranscript[] = [];
  const reviewedOrigins: ValidatedOriginReview[] = [];
  let cumulativeTokens = initialCumulativeTokens;
  let usageUnavailable = false;
  const errors: string[] = [];
  let providerFailure = false;
  let actualIdentity: string | undefined;
  const reusable = new Map(
    resumeArtifacts
      .filter(
        (artifact): artifact is CompletedPacketCallArtifact => artifact.status === "completed",
      )
      .map((artifact) => [contentDigest(artifact.request), artifact] as const),
  );
  const requireRemainingBudget = (): void => {
    if (usageUnavailable) {
      throw new Error(
        "Reviewer token usage is unavailable; no further provider calls are allowed.",
      );
    }
    if (cumulativeTokens >= adapterOptions.tokenLimit) {
      throw new ReviewerTokenLimitError(adapterOptions.tokenLimit, cumulativeTokens);
    }
  };
  const transcript = (error?: string): JudgeTranscript => ({
    schemaVersion: 1,
    reviewId,
    providerFamily: adapterOptions.providerFamily,
    requestedModel: adapterOptions.model,
    reviewerProfile: adapterOptions.profileId,
    bundleDigest: bundle.contentDigest,
    origins,
    cumulativeTokens,
    ...(error === undefined ? {} : { error }),
  });
  for (const { originId, surface, packets } of originPackets) {
    const artifacts: PacketCallArtifact[] = [];
    const reviews = new Map<ReviewPacketLedger, PacketReview>();
    origins.push({ originId, packets: artifacts });
    const selectedPackets = packets.filter(
      ({ ledger }) => !(surface.communicationMode === "isolated" && ledger === "social"),
    );
    for (const packet of selectedPackets) {
      const request = packetRequestIdentity(packet, adapterOptions);
      let artifact: PacketCallArtifact | undefined = reusable.get(contentDigest(request));
      if (artifact !== undefined) {
        try {
          const { review } = decodePacketReviewerOutput(artifact.output, packet);
          reviews.set(packet.ledger, review);
          await onArtifact(artifact);
        } catch {
          artifact = undefined;
        }
      }
      if (artifact === undefined) {
        try {
          requireRemainingBudget();
          const turn = await callReviewer(
            adapter,
            `agent-${String(judgeIndex + 1)}` as AgentId,
            packetPrompt(packet),
            {
              name: `palimpsest_${packet.ledger}_packet`,
              description: `Outcome-blind ${packet.ledger} ledger review with exact packet citations.`,
              schema: packetOutputSchema(packet),
            },
          );
          if (turn.usage !== undefined) {
            cumulativeTokens = addTurnUsage(cumulativeTokens, {
              response: turn.responseText ?? turn.finalResponse ?? "",
              responseIdentity: turn.responseIdentity ?? {},
              usage: turn.usage,
            });
          } else {
            usageUnavailable = true;
          }
          let value: unknown;
          try {
            const retained = retainedCompletedTurn(turn);
            value = JSON.parse(retained.response) as unknown;
            const decodedOutput = decodePacketReviewerOutput(value, packet);
            artifact = completedPacketArtifact(request, turn, decodedOutput.output);
            reviews.set(packet.ledger, decodedOutput.review);
          } catch (error) {
            artifact = failedPacketArtifact(request, error, turn);
          }
        } catch (error) {
          artifact = failedPacketArtifact(request, error);
        }
        await onArtifact(artifact);
      }
      artifacts.push(artifact);
      if (artifact.status === "failed") {
        errors.push(`${packet.packetId}: ${artifact.failure.message}`);
        if (
          artifact.failure.classification === "provider-error" ||
          artifact.failure.classification === "overloaded" ||
          artifact.failure.classification.startsWith("finish-")
        ) {
          providerFailure = true;
        }
        continue;
      }
      const identity = `${artifact.actualProvider}\0${artifact.actualModel}`;
      if (actualIdentity === undefined) actualIdentity = identity;
      else if (actualIdentity !== identity) {
        errors.push("Reviewer packets reported inconsistent actual provider or model identities.");
      }
      if (!reviews.has(packet.ledger)) {
        reviews.set(packet.ledger, decodePacketReviewerOutput(artifact.output, packet).review);
      }
    }
    if (
      reviews.has("epistemic") &&
      reviews.has("instrumental") &&
      (surface.communicationMode === "isolated" || reviews.has("social")) &&
      !errors.some((message) => message.includes("inconsistent actual"))
    ) {
      const epistemic = reviews.get("epistemic")!;
      const socialDimensions =
        surface.communicationMode === "isolated"
          ? deterministicSocialDimensions()
          : reviews.get("social")!.dimensions;
      const instrumental = reviews.get("instrumental")!;
      try {
        const output = validateReviewerOutputAgainstBundle(
          decodeReviewerOutput({
            schemaVersion: 1,
            rubricVersion: EPISTEMIC_PROCESS_RUBRIC_VERSION,
            bundleDigest: bundle.contentDigest,
            dimensions: [...epistemic.dimensions, ...socialDimensions, ...instrumental.dimensions],
            episodes: epistemic.episodes,
            overallCautions: [
              ...epistemic.cautions,
              ...(surface.communicationMode === "isolated" ? [] : reviews.get("social")!.cautions),
              ...instrumental.cautions,
            ],
          }),
          surface,
        );
        reviewedOrigins.push({ originId, output });
      } catch (error) {
        errors.push(`${originId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (reviewedOrigins.length === originPackets.length && errors.length === 0) {
    return {
      status: "completed",
      transcript: transcript(),
      review: {
        schemaVersion: 1,
        reviewId,
        providerFamily: adapterOptions.providerFamily,
        requestedModel: adapterOptions.model,
        bundleDigest: bundle.contentDigest,
        origins: reviewedOrigins,
      },
    };
  }
  const failureTranscript = transcript(errors.join(" | ") || "Reviewer packets are incomplete.");
  return {
    status: providerFailure ? "provider-error" : "invalid",
    transcript: failureTranscript,
  };
}

function dimensionsByLedger(
  reviews: readonly [ValidatedOriginReview, ValidatedOriginReview],
  ledger: "epistemic" | "social" | "instrumental",
  measures: readonly QuantitativeMeasure[],
): JsonObject {
  return {
    measures: measures.filter(
      (measure) => measure.ledger === ledger,
    ) as unknown as JsonObject["measures"],
    reviewers: reviews.map(({ output }, index) => ({
      judge: index + 1,
      dimensions: output.dimensions.filter((dimension) => dimension.ledger === ledger),
      ...(ledger === "epistemic" ? { episodes: output.episodes } : {}),
    })) as unknown as JsonObject["reviewers"],
  };
}

function uniqueReferences(references: readonly EvidenceReference[]): readonly EvidenceReference[] {
  return [
    ...new Map(references.map((reference) => [referenceLocator(reference), reference])).values(),
  ];
}

function episodeReferences(
  output: ReviewerOutput["episodes"][number],
): readonly EvidenceReference[] {
  return uniqueReferences([
    ...output.evidence,
    ...output.commitment,
    ...output.test,
    ...output.revision,
    ...output.transmission,
    ...output.uptake,
    ...output.integration,
    ...output.counterevidence,
  ]);
}

function reviewMeasureInputs(
  reviews: readonly [ValidatedOriginReview, ValidatedOriginReview],
  bundle: EvidenceBundle,
): readonly ReviewMeasureInput[] {
  const itemsByReference = new Map(
    bundle.items.map((item) => [referenceLocator(item.reference), item] as const),
  );
  return reviews.map(({ output }, index) => ({
    reviewerId: `judge-${String(index + 1)}`,
    revisionOpportunities: output.episodes.map((episode) => ({
      episodeId: episode.episodeId,
      status: episode.status,
      evidence: episodeReferences(episode),
    })),
    collaborationOpportunities: output.episodes.flatMap((episode) => {
      if (episode.transmission.length === 0) return [];
      const contribution = episode.transmission
        .map((reference) => itemsByReference.get(referenceLocator(reference)))
        .filter((item): item is EvidenceItem => item !== undefined)
        .sort((left, right) => left.atMs - right.atMs)[0];
      if (contribution === undefined || contribution.actorId === "runner") return [];
      const uptake = episode.uptake
        .map((reference) => itemsByReference.get(referenceLocator(reference)))
        .filter(
          (item): item is EvidenceItem =>
            item !== undefined &&
            item.actorId !== "runner" &&
            item.actorId !== contribution.actorId &&
            item.atMs >= contribution.atMs,
        )
        .sort((left, right) => left.atMs - right.atMs)[0];
      const integration = episode.integration
        .map((reference) => itemsByReference.get(referenceLocator(reference)))
        .filter(
          (item): item is EvidenceItem => item !== undefined && item.atMs >= (uptake?.atMs ?? 0),
        )
        .sort((left, right) => left.atMs - right.atMs)[0];
      const status =
        uptake === undefined ? "missed" : integration === undefined ? "uptaken" : "integrated";
      return [
        {
          episodeId: episode.episodeId,
          status,
          contributionActorId: contribution.actorId,
          contributedAtMs: contribution.atMs,
          ...(uptake === undefined
            ? {}
            : { uptakeActorId: uptake.actorId, uptakeAtMs: uptake.atMs }),
          ...(integration === undefined ? {} : { integratedAtMs: integration.atMs }),
          evidence: episodeReferences(episode),
        },
      ];
    }),
  }));
}

async function reviewCodedMeasures(
  projectRoot: string,
  record: RunRecord,
  bundle: EvidenceBundle,
  reviews: readonly [ValidatedJudgeReview, ValidatedJudgeReview],
  invokePython: typeof runPythonJson,
): Promise<readonly (readonly QuantitativeMeasure[])[]> {
  return Promise.all(
    record.topology.origins.map(async (_origin, originIndex) => {
      const originReviews = [
        reviews[0].origins[originIndex]!,
        reviews[1].origins[originIndex]!,
      ] as const;
      const request = createMeasureRequest(
        record,
        bundle.items,
        bundle.actors,
        reviewMeasureInputs(originReviews, bundle),
      );
      const metrics = decodePerformanceMetrics(
        await invokePython(
          projectRoot,
          "palimpsest.evaluation.process",
          [],
          undefined,
          `${canonicalJson(request)}\n`,
        ),
        record.topology.origins.map(({ originId }) => originId),
      );
      return metrics.measures[originIndex]!.values.filter(
        (measure) => measure.basis === "review-coded",
      );
    }),
  );
}

function disagreement(left: DimensionReview, right: DimensionReview): JsonObject | undefined {
  if (
    left.state === right.state &&
    (left.state !== "rated" || right.state !== "rated" || left.rating === right.rating)
  ) {
    return undefined;
  }
  return {
    dimensionId: left.dimensionId,
    judge1: left.state === "rated" ? left.rating : left.state,
    judge2: right.state === "rated" ? right.rating : right.state,
  };
}

function buildScorecards(
  record: RunRecord,
  reviews: readonly [ValidatedJudgeReview, ValidatedJudgeReview],
  performanceMetrics: PerformanceMetrics,
  codedMeasures: readonly (readonly QuantitativeMeasure[])[],
): readonly RunScorecard[] {
  return record.topology.origins.map((origin, originIndex) => {
    const originReviews = [
      reviews[0].origins[originIndex]!,
      reviews[1].origins[originIndex]!,
    ] as const;
    const differences = originReviews[0].output.dimensions
      .map((dimension, index) =>
        disagreement(dimension, originReviews[1].output.dimensions[index]!),
      )
      .filter((item): item is JsonObject => item !== undefined);
    const evaluationHistory = record.evaluations.map((batch) => ({
      evaluationId: batch.evaluationId,
      kind: batch.kind,
      evaluatedAt: batch.evaluatedAt,
      result: batch.results[originIndex]!,
    }));
    const deterministic = performanceMetrics.measures[originIndex]!.values;
    const processMeasures = [
      ...deterministic.filter(({ ledger }) => ledger !== "outcome"),
      ...codedMeasures[originIndex]!,
    ];
    return decodeRunScorecard({
      schemaVersion: 1,
      runId: record.runId,
      canonicalOrigins: [{ originId: origin.originId, status: "eligible" }],
      outcome: {
        evaluations: evaluationHistory,
        measures: deterministic.filter(({ ledger }) => ledger === "outcome"),
      },
      epistemic: dimensionsByLedger(originReviews, "epistemic", processMeasures),
      social: dimensionsByLedger(originReviews, "social", processMeasures),
      instrumental: dimensionsByLedger(originReviews, "instrumental", processMeasures),
      disagreements: differences,
      eligibility: { status: "completed" },
      limitations: [
        "Process judgments describe observable retained evidence and do not reveal hidden model state.",
        "Reviewer disagreement is preserved; ratings are not averaged into a composite.",
      ],
    });
  });
}

function jsonBytes(value: unknown): string {
  return `${canonicalJson(value)}\n`;
}

function artifactFileName(artifact: PacketCallArtifact): string {
  return `packet-${artifact.artifactKey}.json`;
}

function assertPacketArtifact(value: unknown, name: string): PacketCallArtifact {
  const decoded = object(value, name);
  if (
    decoded.schemaVersion !== 1 ||
    (decoded.status !== "completed" && decoded.status !== "failed")
  ) {
    throw new Error(`${name} has an unsupported schema or status.`);
  }
  const artifactKey = nonEmptyText(decoded.artifactKey, `${name}.artifactKey`);
  const { artifactKey: _artifactKey, ...content } = decoded;
  if (contentDigest(content) !== artifactKey) throw new Error(`${name} content digest is invalid.`);
  const request = object(decoded.request, `${name}.request`);
  if (
    request.schemaVersion !== 1 ||
    request.protocolVersion !== REVIEW_PROTOCOL_VERSION ||
    request.promptVersion !== REVIEW_PROMPT_VERSION ||
    request.outputSchemaVersion !== REVIEW_OUTPUT_SCHEMA_VERSION ||
    request.routingVersion !== REVIEW_PACKET_ROUTING_VERSION ||
    request.projectionVersion !== REVIEW_PACKET_PROJECTION_VERSION
  ) {
    throw new Error(`${name} request protocol is incompatible.`);
  }
  return decoded as unknown as PacketCallArtifact;
}

async function writePacketArtifact(path: string, artifact: PacketCallArtifact): Promise<void> {
  const file = join(path, artifactFileName(artifact));
  try {
    await writeFile(file, jsonBytes(artifact), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (canonicalJson(existing) !== canonicalJson(artifact)) {
      throw new Error(
        `Packet artifact ${artifact.artifactKey} already exists with different bytes.`,
      );
    }
  }
}

interface ResumeState {
  readonly analysis: ProcessReviewRunAnalysis;
  readonly artifactsByProfile: ReadonlyMap<string, readonly PacketCallArtifact[]>;
  readonly cumulativeTokensByProfile: ReadonlyMap<string, number>;
}

async function loadResumeState(
  runRoot: string,
  record: RunRecord,
  analysisId: string,
): Promise<ResumeState> {
  const analysis = record.analyses.find(
    (item): item is ProcessReviewRunAnalysis =>
      item.kind === "process-review" && item.analysisId === analysisId,
  );
  if (analysis === undefined) throw new Error(`Unknown process review ${analysisId}.`);
  if (analysis.status !== "incomplete")
    throw new Error("Only an incomplete process review can resume.");
  if (analysis.protocolVersion !== REVIEW_PROTOCOL_VERSION) {
    throw new Error("Legacy or incompatible process reviews cannot resume into ledger packets.");
  }
  const resolvedRoot = await realpath(resolve(runRoot));
  const manifestPath = resolve(resolvedRoot, analysis.detailsPath);
  if (!manifestPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error("Resume detail manifest escapes its run root.");
  }
  const manifestValue = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  const manifest = exact(manifestValue, ["schemaVersion", "files"], "Resume detail manifest");
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.files) ||
    contentDigest(manifestValue) !== analysis.detailsDigest
  ) {
    throw new Error("Resume detail manifest differs from its analysis reference.");
  }
  const artifacts: PacketCallArtifact[] = [];
  const cumulativeTokensByProfile = new Map<string, number>();
  const artifactsByProfile = new Map<string, PacketCallArtifact[]>();
  for (const [index, entryValue] of manifest.files.entries()) {
    const entry = object(entryValue, `Resume manifest file ${String(index + 1)}`);
    if (entry.role !== "packet-call-result") continue;
    const path = nonEmptyText(entry.path, `Resume manifest file ${String(index + 1)}.path`);
    if (!/^packet-[0-9a-f]{64}\.json$/.test(path)) {
      throw new Error("Resume packet artifact path is invalid.");
    }
    const value = JSON.parse(await readFile(join(dirname(manifestPath), path), "utf8")) as unknown;
    if (contentDigest(value) !== entry.contentDigest) {
      throw new Error(`Resume packet artifact ${path} differs from its manifest digest.`);
    }
    artifacts.push(assertPacketArtifact(value, `Resume packet artifact ${path}`));
  }
  for (const artifact of artifacts) {
    const list = artifactsByProfile.get(artifact.request.reviewerProfile) ?? [];
    list.push(artifact);
    artifactsByProfile.set(artifact.request.reviewerProfile, list);
  }
  for (const [judgeIndex, summary] of analysis.reviews.entries()) {
    const rawPath = join(dirname(manifestPath), `judge-${String(judgeIndex + 1)}.raw.json`);
    const value = object(
      JSON.parse(await readFile(rawPath, "utf8")) as unknown,
      `Resume judge ${String(judgeIndex + 1)} transcript`,
    );
    const profile = nonEmptyText(value.reviewerProfile, "Resume transcript reviewerProfile");
    if (!Number.isSafeInteger(value.cumulativeTokens) || (value.cumulativeTokens as number) < 0) {
      throw new Error("Resume transcript cumulativeTokens is invalid.");
    }
    if (summary.providerFamily !== value.providerFamily) {
      throw new Error("Resume transcript provider family differs from its analysis summary.");
    }
    cumulativeTokensByProfile.set(profile, value.cumulativeTokens as number);
  }
  return { analysis, artifactsByProfile, cumulativeTokensByProfile };
}

async function writeTranscriptSnapshot(path: string, transcript: JudgeTranscript): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, jsonBytes(transcript), { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function publishedJudgeReviews(
  attempt: JudgeAttempt,
  judgeIndex: number,
): JudgeReview | readonly JudgeReview[] {
  if (attempt.review === undefined) throw new Error("Cannot publish an invalid judge review.");
  const rawResponsePath = `judge-${String(judgeIndex + 1)}.raw.json`;
  const rawResponseDigest = contentDigest(attempt.transcript);
  const reviews = attempt.review.origins.map(({ output }, originIndex) => {
    const identity = attempt.transcript.origins[originIndex]?.packets.find(
      (artifact): artifact is CompletedPacketCallArtifact => artifact.status === "completed",
    );
    return decodeJudgeReview({
      reviewId:
        attempt.review!.origins.length === 1
          ? attempt.review!.reviewId
          : `${attempt.review!.reviewId}-origin-${String(originIndex + 1)}`,
      status: "completed",
      rubricVersion: output.rubricVersion,
      bundleDigest: output.bundleDigest,
      judge: {
        providerFamily: attempt.review!.providerFamily,
        requestedModel: attempt.review!.requestedModel,
        ...(identity === undefined ? {} : { actualProvider: identity.actualProvider }),
        ...(identity === undefined ? {} : { actualModel: identity.actualModel }),
      },
      dimensions: output.dimensions,
      episodes: output.episodes,
      overallCautions: output.overallCautions,
      rawResponsePath,
      rawResponseDigest,
    });
  });
  return reviews.length === 1 ? reviews[0]! : reviews;
}

async function publishDetails(
  runRoot: string,
  analysisId: string,
  files: readonly DetailFile[],
  uuid: () => string,
): Promise<{ detailsPath: string; detailsDigest: string; absolutePath: string }> {
  const gradingRoot = join(resolve(runRoot), "grading");
  const finalDirectory = join(gradingRoot, analysisId);
  const temporaryDirectory = join(gradingRoot, `.review-${uuid()}.tmp`);
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    const entries = [];
    for (const file of files) {
      const bytes = jsonBytes(file.content);
      await writeFile(join(temporaryDirectory, file.path), bytes, { encoding: "utf8", flag: "wx" });
      entries.push({
        path: file.path,
        contentDigest: contentDigest(file.content),
        byteCount: Buffer.byteLength(bytes),
        role: file.role,
      });
    }
    const manifest = { schemaVersion: 1, files: entries };
    const manifestBytes = jsonBytes(manifest);
    await writeFile(join(temporaryDirectory, "manifest.json"), manifestBytes, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryDirectory, finalDirectory);
    return {
      detailsPath: `grading/${analysisId}/manifest.json`,
      detailsDigest: contentDigest(manifest),
      absolutePath: finalDirectory,
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function loadExactBundle(
  runRoot: string,
  performance: PerformanceRunAnalysis,
  configurationDigest: string,
  originIds: readonly GitRepositoryId[],
): Promise<ExactPerformanceDetails> {
  if (performance.configurationDigest !== configurationDigest) {
    throw new Error(
      "Performance analysis configuration digest differs from the exact grading config.",
    );
  }
  if (!performance.detailsPath.endsWith("/manifest.json")) {
    throw new Error("Performance analysis detailsPath must identify its immutable manifest.");
  }
  const resolvedRunRoot = await realpath(resolve(runRoot));
  const manifestCandidate = resolve(resolvedRunRoot, performance.detailsPath);
  if (!manifestCandidate.startsWith(`${resolvedRunRoot}${sep}`)) {
    throw new Error("Performance detail manifest escapes its run root.");
  }
  const manifestPath = await realpath(manifestCandidate);
  if (!manifestPath.startsWith(`${resolvedRunRoot}${sep}`)) {
    throw new Error("Performance detail manifest resolves outside its run root.");
  }
  const detailDirectory = dirname(manifestPath);
  const manifestValue = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  const manifest = exact(
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
    throw new Error("Performance detail manifest differs from the exact performance analysis.");
  }
  const evidenceDetail = exact(
    manifest.evidence,
    ["path", "contentDigest"],
    "Performance detail manifest evidence",
  );
  if (evidenceDetail.path !== "evidence.json") {
    throw new Error("Performance detail manifest must identify evidence.json.");
  }
  const metricsDetail = exact(
    manifest.metrics,
    ["path", "contentDigest"],
    "Performance detail manifest metrics",
  );
  if (metricsDetail.path !== "metrics.json") {
    throw new Error("Performance detail manifest must identify metrics.json.");
  }
  const bundle = decodeEvidenceBundle(
    JSON.parse(await readFile(join(detailDirectory, "evidence.json"), "utf8")) as unknown,
  );
  const metricsValue = JSON.parse(
    await readFile(join(detailDirectory, "metrics.json"), "utf8"),
  ) as Record<string, unknown>;
  const metrics = decodePerformanceMetrics(metricsValue, originIds);
  if (
    bundle.sourceDigest !== performance.sourceDigest ||
    evidenceDetail.contentDigest !== bundle.contentDigest ||
    metricsDetail.contentDigest !== contentDigest(metricsValue)
  ) {
    throw new Error("Performance evidence or metrics digest differs from its analysis.");
  }
  return { bundle, metrics };
}

export class PublishedIncompleteReviewError extends Error {
  readonly result: ReviewRunResult;

  constructor(result: ReviewRunResult) {
    super(`Process review ${result.analysis.analysisId} was published incomplete.`);
    this.name = "PublishedIncompleteReviewError";
    this.result = result;
  }
}

export async function reviewRun(
  options: ReviewRunOptions,
  dependencies: ReviewDependencies = {},
): Promise<ReviewRunResult> {
  if (options.allowSpend !== true && options.allowSpend !== "true") {
    throw new Error("Qualitative review requires literal --allow-spend true.");
  }
  const loadedConfiguration = await loadGradingConfigurationSource(options.configPath);
  const config = loadedConfiguration.config;
  const configurationDigest = loadedConfiguration.digest;
  const loaded = await loadRunRecord(options.projectRoot, options.runRoot);
  if (loaded.record.status !== "completed")
    throw new Error("Qualitative review requires a completed run.");
  const performance = loaded.record.analyses.find(
    (analysis): analysis is PerformanceRunAnalysis =>
      analysis.kind === "performance" && analysis.analysisId === options.performanceAnalysisId,
  );
  if (performance === undefined) {
    throw new Error(`Unknown performance analysis ${options.performanceAnalysisId}.`);
  }
  if (
    loaded.record.analyses.some(
      (analysis) =>
        analysis.kind === "process-review" &&
        analysis.status === "completed" &&
        analysis.performanceAnalysisId === performance.analysisId &&
        analysis.configurationDigest === configurationDigest &&
        analysis.rubricVersion === config.rubric,
    )
  ) {
    throw new Error(
      "A completed process review already exists for this performance analysis, configuration, and rubric.",
    );
  }

  const originIds = loaded.record.topology.origins.map(({ originId }) => originId);
  const exactPerformance = await loadExactBundle(
    options.runRoot,
    performance,
    configurationDigest,
    originIds,
  );
  const { bundle } = exactPerformance;
  const currentEvidence = await compileEvidence({
    root: options.projectRoot,
    runRoot: options.runRoot,
  });
  if (
    currentEvidence.bundle.sourceDigest !== bundle.sourceDigest ||
    currentEvidence.bundle.contentDigest !== bundle.contentDigest
  ) {
    throw new Error("Frozen run evidence differs from the exact performance analysis bundle.");
  }
  assertOutcomeBlindEvidenceBundle(bundle, loaded.record);
  validateReviewerBundleLeakage(bundle, loaded.record);
  const rubricDigest = contentDigest(EPISTEMIC_PROCESS_RUBRIC);
  const originPackets = originIds.map((originId, originIndex) => {
    const surface = reviewSurfaceForOrigin(bundle, loaded.record, originId);
    return {
      originId,
      surface,
      packets: compileReviewPackets({
        bundle,
        originId,
        originOrdinal: originIndex + 1,
        configurationDigest,
        rubricDigest,
        items: surface.items,
      }),
    };
  });
  const resume =
    options.resumeAnalysisId === undefined
      ? undefined
      : await loadResumeState(options.runRoot, loaded.record, options.resumeAnalysisId);
  if (
    resume !== undefined &&
    (resume.analysis.performanceAnalysisId !== performance.analysisId ||
      resume.analysis.configurationDigest !== configurationDigest ||
      resume.analysis.rubricVersion !== config.rubric ||
      resume.analysis.bundleDigest !== bundle.contentDigest)
  ) {
    throw new Error("Resume analysis differs from the exact review inputs.");
  }
  const env = dependencies.env ?? process.env;
  const adapterOptions = credentialPreflight(config, env);
  const createAdapter = dependencies.createAdapter ?? defaultCreateAdapter;
  const adapters = adapterOptions.map((item) => createAdapter(item));
  const uuid = dependencies.randomUUID ?? randomUUID;
  const analysisId = `process-review-${uuid()}`;
  const rawJournal = join(resolve(options.runRoot), "grading", `.${analysisId}.raw`);
  await mkdir(rawJournal, { recursive: false });
  const attempts = await Promise.all(
    adapters.map((adapter, index) =>
      runJudge(
        adapter,
        adapterOptions[index]!,
        bundle,
        originPackets,
        `review-${uuid()}`,
        index,
        resume?.artifactsByProfile.get(adapterOptions[index]!.profileId) ?? [],
        resume?.cumulativeTokensByProfile.get(adapterOptions[index]!.profileId) ?? 0,
        (artifact) => writePacketArtifact(rawJournal, artifact),
      ),
    ),
  );
  await Promise.all(
    attempts.map((attempt, index) =>
      writeTranscriptSnapshot(
        join(rawJournal, `judge-${String(index + 1)}.raw.json`),
        attempt.transcript,
      ),
    ),
  );
  const completed = attempts.every(
    (attempt): attempt is JudgeAttempt & { review: ValidatedJudgeReview; status: "completed" } =>
      attempt.status === "completed" && attempt.review !== undefined,
  );

  const files: DetailFile[] = attempts.flatMap((attempt, index) => [
    {
      path: `judge-${String(index + 1)}.raw.json`,
      role: "raw-review-transcript",
      content: attempt.transcript,
    },
    ...(attempt.review === undefined
      ? []
      : [
          {
            path: `judge-${String(index + 1)}.review.json`,
            role: "validated-process-review",
            content: publishedJudgeReviews(attempt, index),
          },
        ]),
    ...attempt.transcript.origins.flatMap(({ packets }) =>
      packets.map((artifact) => ({
        path: artifactFileName(artifact),
        role: "packet-call-result",
        content: artifact,
      })),
    ),
  ]);
  let scorecards: readonly RunScorecard[] | undefined;
  let scorecardRecord = loaded.record;
  if (completed) {
    const firstReview = attempts[0]!.review!;
    const secondReview = attempts[1]!.review!;
    // Serialize validated process judgments before outcome data is reintroduced below.
    attempts.forEach((attempt) => canonicalJson(attempt.review));
    const refreshed = await loadRunRecord(options.projectRoot, options.runRoot);
    const currentPerformance = refreshed.record.analyses.find(
      (analysis): analysis is PerformanceRunAnalysis =>
        analysis.kind === "performance" && analysis.analysisId === performance.analysisId,
    );
    if (
      currentPerformance === undefined ||
      currentPerformance.detailsDigest !== performance.detailsDigest
    ) {
      throw new Error("Performance analysis changed while qualitative review was running.");
    }
    if (
      refreshed.record.analyses.some(
        (analysis) =>
          analysis.kind === "process-review" &&
          analysis.status === "completed" &&
          analysis.performanceAnalysisId === performance.analysisId &&
          analysis.configurationDigest === configurationDigest &&
          analysis.rubricVersion === config.rubric,
      )
    ) {
      throw new Error("A completed process review was published concurrently.");
    }
    const refreshedEvidence = await compileEvidence({
      root: options.projectRoot,
      runRoot: options.runRoot,
    });
    if (
      refreshedEvidence.bundle.sourceDigest !== bundle.sourceDigest ||
      refreshedEvidence.bundle.contentDigest !== bundle.contentDigest
    ) {
      throw new Error("Frozen run evidence changed while qualitative review was running.");
    }
    scorecardRecord = refreshed.record;
    const codedMeasures = await reviewCodedMeasures(
      options.projectRoot,
      scorecardRecord,
      bundle,
      [firstReview, secondReview],
      dependencies.invokePython ?? runPythonJson,
    );
    scorecards = buildScorecards(
      scorecardRecord,
      [firstReview, secondReview],
      exactPerformance.metrics,
      codedMeasures,
    );
    files.push({ path: "scorecard.json", role: "run-scorecard", content: scorecards });
  }
  const detail = await publishDetails(options.runRoot, analysisId, files, uuid);
  await rm(rawJournal, { recursive: true, force: true });
  const reviewedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const analysis: ProcessReviewRunAnalysis = {
    analysisId,
    kind: "process-review",
    reviewedAt,
    status: completed ? "completed" : "incomplete",
    performanceAnalysisId: performance.analysisId,
    rubricVersion: config.rubric,
    configurationDigest,
    bundleDigest: bundle.contentDigest,
    protocolVersion: REVIEW_PROTOCOL_VERSION,
    ...(resume === undefined ? {} : { resumedFromAnalysisId: resume.analysis.analysisId }),
    detailsPath: detail.detailsPath,
    detailsDigest: detail.detailsDigest,
    reviews: [
      {
        reviewId: attempts[0]!.transcript.reviewId,
        providerFamily: attempts[0]!.transcript.providerFamily,
        status: attempts[0]!.status,
      },
      {
        reviewId: attempts[1]!.transcript.reviewId,
        providerFamily: attempts[1]!.transcript.providerFamily,
        status: attempts[1]!.status,
      },
    ],
  };
  let record: RunRecord;
  const latest = await loadRunRecord(options.projectRoot, options.runRoot);
  const duplicate = latest.record.analyses.find(
    (item) =>
      item.kind === "process-review" &&
      item.status === "completed" &&
      item.performanceAnalysisId === performance.analysisId &&
      item.configurationDigest === configurationDigest &&
      item.rubricVersion === config.rubric,
  );
  if (duplicate !== undefined) {
    throw new Error(`Process review ${duplicate.analysisId} was published concurrently.`);
  }
  if (
    completed &&
    contentDigest({ ...latest.record, analyses: [] }) !==
      contentDigest({ ...scorecardRecord, analyses: [] })
  ) {
    throw new Error("Run record changed after scorecard construction.");
  }
  record = await (dependencies.appendAnalysis ?? appendRunAnalysis)(
    options.runRoot,
    latest.record,
    analysis,
  );
  const result: ReviewRunResult = {
    analysis,
    record,
    path: detail.absolutePath,
    ...(scorecards === undefined ? {} : { scorecards }),
  };
  if (!completed) throw new PublishedIncompleteReviewError(result);
  return result;
}

export async function reviewRunFromFlags(
  projectRoot: string,
  flags: ReviewRunFlags,
  dependencies: ReviewDependencies = {},
): Promise<ReviewRunResult> {
  return reviewRun(
    {
      projectRoot,
      runRoot: nonEmptyText(flags["run-root"], "--run-root"),
      configPath: nonEmptyText(flags.config, "--config"),
      performanceAnalysisId: nonEmptyText(flags["performance-analysis"], "--performance-analysis"),
      allowSpend: flags["allow-spend"],
      ...(flags.resume === undefined
        ? {}
        : { resumeAnalysisId: nonEmptyText(flags.resume, "--resume") }),
    },
    dependencies,
  );
}
