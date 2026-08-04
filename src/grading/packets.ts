import { canonicalJson, contentDigest } from "../canonical.js";
import type { JsonValue } from "../model/contracts.js";
import {
  decodeEvidenceReference,
  type EvidenceBundle,
  type EvidenceItem,
  type EvidenceReference,
  type ProcessLedger,
} from "./contracts.js";

export const REVIEW_PACKET_SCHEMA_VERSION = 1 as const;
export const REVIEW_PACKET_ROUTING_VERSION = "ledger-routing-v2" as const;
export const REVIEW_PACKET_PROJECTION_VERSION = "evidence-projection-v2" as const;
export const REVIEW_PACKET_MAX_BYTES = 128 * 1024;
// OpenAI permits up to 1000 enum values across a schema; reserve one slot below that cap.
export const REVIEW_PACKET_MAX_CITATIONS = 999;
export const REVIEW_PACKET_ITEM_EXCERPT_BYTES = 4 * 1024;

const DIGEST = /^[0-9a-f]{64}$/;
const CONTROLLED_ID = /^[a-z0-9][a-z0-9._-]*$/;
const OBSERVATION_KIND = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)+$/;
const LEDGERS = ["epistemic", "social", "instrumental"] as const;

export type ReviewPacketLedger = ProcessLedger;

export interface PacketOrigin {
  readonly ordinal: number;
}

export interface PacketEvaluationUnit {
  readonly kind: "shared-team" | "isolated-origin";
  readonly actorIds: readonly string[];
}

export type ReviewOpportunityKind =
  | "stage-boundary"
  | "peer-message"
  | "actor-action"
  | "tool-exchange"
  | "checker-exchange"
  | "git-change"
  | "publication"
  | "failure"
  | "session-event";

/** Compact rows keep the complete opportunity registry inside the packet byte bound. */
export type PacketCitation = readonly [
  citationId: string,
  sourceDigest: string,
  reference: EvidenceReference,
];

export type EvidenceProjection = "full" | "excerpted" | "metadata-only" | "paired-tool";

export type ReviewOpportunity = readonly [
  opportunityId: string,
  kind: ReviewOpportunityKind,
  atMs: number,
  actorIds: readonly string[],
  citationIds: readonly string[],
  observationKind: string,
  projection: EvidenceProjection,
  content: JsonValue,
];

export type PacketOmission = readonly [evidenceId: string, sourceDigest: string, reason: string];

export interface ReviewPacket {
  readonly schemaVersion: typeof REVIEW_PACKET_SCHEMA_VERSION;
  readonly packetId: string;
  readonly origin: PacketOrigin;
  readonly evaluationUnit: PacketEvaluationUnit;
  readonly ledger: ProcessLedger;
  readonly bundleDigest: string;
  readonly configurationDigest: string;
  readonly rubricDigest: string;
  readonly routingVersion: typeof REVIEW_PACKET_ROUTING_VERSION;
  readonly projectionVersion: typeof REVIEW_PACKET_PROJECTION_VERSION;
  readonly citations: readonly PacketCitation[];
  readonly opportunities: readonly ReviewOpportunity[];
  readonly omissions: readonly PacketOmission[];
  readonly contentDigest: string;
}

function opportunityKind(source: ProjectionSource): ReviewOpportunityKind {
  if (source.kind.startsWith("stage.")) return "stage-boundary";
  if (source.kind.startsWith("team.")) return "peer-message";
  if (source.kind === "tool.exchange" || source.kind.startsWith("tool.")) return "tool-exchange";
  if (source.kind.startsWith("checker.")) return "checker-exchange";
  if (source.kind.includes("error") || source.kind.includes("failure")) return "failure";
  if (source.kind.startsWith("session.")) return "session-event";
  if (source.kind === "git.published" || source.kind === "git.frozen") return "publication";
  if (source.kind.startsWith("git.")) return "git-change";
  return "actor-action";
}

export interface CompileReviewPacketsOptions {
  readonly bundle: EvidenceBundle;
  readonly originId: string;
  /** One-based ordinal used instead of an identity-bearing label in reviewer prompts. */
  readonly originOrdinal: number;
  readonly configurationDigest: string;
  readonly rubricDigest: string;
  /** An origin-scoped, order-preserving subset of bundle.items. */
  readonly items?: readonly EvidenceItem[];
}

interface RoutedItem {
  readonly item: EvidenceItem;
  readonly sourceDigest: string;
  readonly ledgers: readonly ProcessLedger[];
}

interface ProjectionSource {
  readonly items: readonly RoutedItem[];
  readonly atMs: number;
  readonly actorId: string;
  readonly kind: string;
  readonly pairedTool: boolean;
  readonly content: JsonValue;
}

function byteCount(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

function assertDigest(value: string, name: string): void {
  if (!DIGEST.test(value)) throw new Error(`${name} must be a lowercase SHA-256 digest.`);
}

function assertOptions(options: CompileReviewPacketsOptions): readonly EvidenceItem[] {
  assertDigest(options.bundle.contentDigest, "Evidence bundle digest");
  assertDigest(options.configurationDigest, "Grading configuration digest");
  assertDigest(options.rubricDigest, "Rubric digest");
  if (!CONTROLLED_ID.test(options.originId)) {
    throw new Error("Review packet origin ID must be a controlled identifier.");
  }
  if (!Number.isSafeInteger(options.originOrdinal) || options.originOrdinal < 1) {
    throw new Error("Review packet origin ordinal must be a positive safe integer.");
  }

  const items = options.items ?? options.bundle.items;
  const bundleItems = new Map(
    options.bundle.items.map((item, index) => [item.evidenceId, { item, index }] as const),
  );
  let previousIndex = -1;
  const seen = new Set<string>();
  for (const item of items) {
    const expected = bundleItems.get(item.evidenceId);
    if (expected === undefined || canonicalJson(expected.item) !== canonicalJson(item)) {
      throw new Error(`Packet evidence ${item.evidenceId} is not an exact bundle item.`);
    }
    if (seen.has(item.evidenceId)) {
      throw new Error(`Packet evidence ${item.evidenceId} is duplicated.`);
    }
    if (expected.index <= previousIndex) {
      throw new Error("Packet evidence must preserve bundle order.");
    }
    seen.add(item.evidenceId);
    previousIndex = expected.index;
  }
  return items;
}

function uniqueLedgers(ledgers: readonly ProcessLedger[]): readonly ProcessLedger[] {
  return LEDGERS.filter((ledger) => ledgers.includes(ledger));
}

/** Routes observable kinds, never their semantic content or apparent quality. */
export function packetLedgersForEvidence(item: EvidenceItem): readonly ProcessLedger[] {
  const ledgers: ProcessLedger[] = [];
  const socialActorAction =
    item.actorId !== "runner" &&
    !item.kind.startsWith("tool.") &&
    !item.kind.startsWith("checker.") &&
    !item.kind.startsWith("usage.") &&
    !item.kind.startsWith("session.");
  if (
    item.kind === "run.context" ||
    item.kind.startsWith("stage.") ||
    item.kind === "model.response" ||
    item.kind.startsWith("team.") ||
    item.kind.startsWith("checker.") ||
    item.kind.startsWith("git.")
  ) {
    ledgers.push("epistemic");
  }
  if (
    item.kind === "run.context" ||
    item.kind.startsWith("stage.") ||
    item.kind.startsWith("team.") ||
    item.kind.startsWith("git.") ||
    socialActorAction
  ) {
    ledgers.push("social");
  }
  if (
    item.kind === "run.context" ||
    item.kind.startsWith("tool.") ||
    item.kind.startsWith("checker.") ||
    item.kind.startsWith("git.") ||
    item.kind.startsWith("usage.") ||
    item.kind.startsWith("session.") ||
    item.kind.startsWith("run.")
  ) {
    ledgers.push("instrumental");
  }
  return uniqueLedgers(ledgers);
}

function contentObject(item: EvidenceItem): Readonly<Record<string, JsonValue>> | undefined {
  return typeof item.content === "object" && item.content !== null && !Array.isArray(item.content)
    ? (item.content as Readonly<Record<string, JsonValue>>)
    : undefined;
}

function projectedItemContent(item: EvidenceItem): JsonValue {
  const content = contentObject(item);
  if (item.kind !== "model.response" || content === undefined || !("toolCalls" in content)) {
    return item.content;
  }
  const { toolCalls: _duplicatedToolCalls, ...retained } = content;
  return retained;
}

function toolCallId(item: EvidenceItem): string | undefined {
  const id = contentObject(item)?.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function projectionSources(items: readonly RoutedItem[]): readonly ProjectionSource[] {
  const consumed = new Set<string>();
  const result: ProjectionSource[] = [];
  for (const [index, routed] of items.entries()) {
    if (consumed.has(routed.item.evidenceId)) continue;
    const item = routed.item;
    const callId = item.kind === "tool.started" ? toolCallId(item) : undefined;
    let completion: RoutedItem | undefined;
    if (callId !== undefined) {
      completion = items
        .slice(index + 1)
        .find(
          (candidate) =>
            !consumed.has(candidate.item.evidenceId) &&
            candidate.item.kind === "tool.completed" &&
            candidate.item.actorId === item.actorId &&
            toolCallId(candidate.item) === callId,
        );
    }
    if (completion !== undefined) {
      consumed.add(item.evidenceId);
      consumed.add(completion.item.evidenceId);
      result.push({
        items: [routed, completion],
        atMs: item.atMs,
        actorId: item.actorId,
        kind: "tool.exchange",
        pairedTool: true,
        content: {
          startedAtMs: item.atMs,
          completedAtMs: completion.item.atMs,
          started: projectedItemContent(item),
          completed: projectedItemContent(completion.item),
        },
      });
      continue;
    }
    consumed.add(item.evidenceId);
    result.push({
      items: [routed],
      atMs: item.atMs,
      actorId: item.actorId,
      kind: item.kind,
      pairedTool: false,
      content: projectedItemContent(item),
    });
  }
  return result;
}

function utf8Prefix(value: string, maxBytes: number): string {
  let result = "";
  let used = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (used + size > maxBytes) break;
    result += character;
    used += size;
  }
  return result;
}

function utf8Suffix(value: string, maxBytes: number): string {
  const characters = Array.from(value);
  let result = "";
  let used = 0;
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index]!;
    const size = Buffer.byteLength(character, "utf8");
    if (used + size > maxBytes) break;
    result = character + result;
    used += size;
  }
  return result;
}

function boundedProjection(
  value: JsonValue,
  contentLimit: number,
): { readonly content: JsonValue; readonly excerpted: boolean } {
  const encoded = canonicalJson(value);
  const sourceByteCount = Buffer.byteLength(encoded, "utf8");
  if (sourceByteCount <= contentLimit) return { content: value, excerpted: false };
  if (contentLimit === 0) return { content: null, excerpted: true };

  const emptyExcerpt = {
    sourceByteCount,
    head: "",
    tail: "",
  };
  const available = Math.max(0, contentLimit - byteCount(emptyExcerpt));
  const headBudget = Math.ceil(available / 2);
  const excerpt = {
    sourceByteCount,
    head: utf8Prefix(encoded, headBudget),
    tail: utf8Suffix(encoded, available - headBudget),
  };
  return { content: excerpt, excerpted: true };
}

function buildPacket(
  options: CompileReviewPacketsOptions,
  ledger: ProcessLedger,
  routed: readonly RoutedItem[],
  unrouted: readonly RoutedItem[],
  contentLimit: number,
): ReviewPacket {
  const citations: PacketCitation[] = routed.map(({ item, sourceDigest }, index) => [
    `c${String(index + 1).padStart(3, "0")}`,
    sourceDigest,
    item.reference,
  ]);
  const citationByEvidence = new Map(
    routed.map(({ item }, index) => [item.evidenceId, citations[index]![0]] as const),
  );
  const omissions: PacketOmission[] =
    ledger === "instrumental"
      ? unrouted.map(({ item, sourceDigest }) => [
          item.evidenceId,
          sourceDigest,
          `${REVIEW_PACKET_ROUTING_VERSION} has no route for observation kind ${item.kind}.`,
        ])
      : [];
  const sources = projectionSources(routed);
  const opportunities: ReviewOpportunity[] = sources.map((source, index) => {
    const bounded = boundedProjection(source.content, contentLimit);
    const inheritedAvailability = source.items.some(({ item }) => item.availability !== "full");
    return [
      `opp-${String(index + 1).padStart(4, "0")}`,
      opportunityKind(source),
      source.atMs,
      source.actorId === "runner" ? [] : [source.actorId],
      source.items.map(({ item }) => citationByEvidence.get(item.evidenceId)!),
      source.kind,
      source.pairedTool
        ? "paired-tool"
        : contentLimit === 0
          ? "metadata-only"
          : bounded.excerpted || inheritedAvailability
            ? "excerpted"
            : "full",
      bounded.content,
    ];
  });
  const actorIds = [
    ...new Set(
      (options.items ?? options.bundle.items)
        .map(({ actorId }) => actorId)
        .filter((actorId) => actorId !== "runner"),
    ),
  ].sort();
  const packetBase = {
    schemaVersion: REVIEW_PACKET_SCHEMA_VERSION,
    origin: { ordinal: options.originOrdinal },
    evaluationUnit: {
      kind: options.bundle.communicationMode === "shared" ? "shared-team" : "isolated-origin",
      actorIds,
    },
    ledger,
    bundleDigest: options.bundle.contentDigest,
    configurationDigest: options.configurationDigest,
    rubricDigest: options.rubricDigest,
    routingVersion: REVIEW_PACKET_ROUTING_VERSION,
    projectionVersion: REVIEW_PACKET_PROJECTION_VERSION,
    citations,
    opportunities,
    omissions,
  } as const;
  const packetId = `packet-${ledger}-${contentDigest(packetBase).slice(0, 24)}`;
  const contentDigestValue = contentDigest({ ...packetBase, packetId });
  return { ...packetBase, packetId, contentDigest: contentDigestValue };
}

function compilePacket(
  options: CompileReviewPacketsOptions,
  ledger: ProcessLedger,
  allItems: readonly RoutedItem[],
): ReviewPacket {
  const routed = allItems.filter((item) => item.ledgers.includes(ledger));
  const unrouted = allItems.filter((item) => item.ledgers.length === 0);
  if (routed.length > REVIEW_PACKET_MAX_CITATIONS) {
    throw new Error(
      `${ledger} packet requires ${String(routed.length)} citations, exceeding the portable structured-schema limit ${String(REVIEW_PACKET_MAX_CITATIONS)}.`,
    );
  }

  const referenceOnly = buildPacket(options, ledger, routed, unrouted, 0);
  if (
    byteCount({ citations: referenceOnly.citations, omissions: referenceOnly.omissions }) >
    REVIEW_PACKET_MAX_BYTES
  ) {
    throw new Error(
      `${ledger} packet reference index cannot fit within ${String(REVIEW_PACKET_MAX_BYTES)} bytes.`,
    );
  }

  let low = 0;
  let high = REVIEW_PACKET_ITEM_EXCERPT_BYTES;
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    if (
      byteCount(buildPacket(options, ledger, routed, unrouted, candidate)) <=
      REVIEW_PACKET_MAX_BYTES
    ) {
      low = candidate;
    } else {
      high = candidate - 1;
    }
  }
  const packet = buildPacket(options, ledger, routed, unrouted, low);
  if (byteCount(packet) > REVIEW_PACKET_MAX_BYTES) {
    throw new Error(`${ledger} packet exceeds ${String(REVIEW_PACKET_MAX_BYTES)} bytes.`);
  }
  return packet;
}

export function compileReviewPackets(
  options: CompileReviewPacketsOptions,
): readonly [ReviewPacket, ReviewPacket, ReviewPacket] {
  const items = assertOptions(options);
  const routed: RoutedItem[] = items.map((item) => ({
    item,
    sourceDigest: contentDigest(item),
    ledgers: packetLedgersForEvidence(item),
  }));
  const packets = [
    compilePacket(options, "epistemic", routed),
    compilePacket(options, "social", routed),
    compilePacket(options, "instrumental", routed),
  ] as const;

  const missing = routed.filter(({ ledgers }) => ledgers.length === 0);
  const omitted = new Set(packets[2].omissions.map(([evidenceId]) => evidenceId));
  const unaccounted = missing.filter(({ item }) => !omitted.has(item.evidenceId));
  if (unaccounted.length > 0) {
    throw new Error(`Packet routing left evidence ${unaccounted[0]!.item.evidenceId} unaccounted.`);
  }
  return packets;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  const decoded = object(value, name);
  if (Object.keys(decoded).sort().join("\0") !== [...fields].sort().join("\0")) {
    throw new Error(`${name} contains unknown or missing fields.`);
  }
  return decoded;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be text.`);
  return value;
}

function controlledId(value: unknown, name: string): string {
  const decoded = text(value, name);
  if (!CONTROLLED_ID.test(decoded)) throw new Error(`${name} must be a controlled identifier.`);
  return decoded;
}

function digest(value: unknown, name: string): string {
  const decoded = text(value, name);
  assertDigest(decoded, name);
  return decoded;
}

function integer(value: unknown, minimum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${name} must be a safe integer at least ${String(minimum)}.`);
  }
  return value as number;
}

function values<T>(
  value: unknown,
  decode: (item: unknown, name: string) => T,
  name: string,
): readonly T[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.map((item, index) => decode(item, `${name}[${String(index)}]`));
}

function row(value: unknown, length: number, name: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${name} must be a compact row with ${String(length)} fields.`);
  }
  return value;
}

function packetLedger(value: unknown, name: string): ReviewPacketLedger {
  if (value !== "epistemic" && value !== "social" && value !== "instrumental") {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function decodeCitation(value: unknown, name: string): PacketCitation {
  const decoded = row(value, 3, name);
  const citationId = text(decoded[0], `${name}[0]`);
  if (!/^c[0-9]{3}$/.test(citationId)) {
    throw new Error(`${name}[0] must use the short packet-local form c001.`);
  }
  return [
    citationId,
    digest(decoded[1], `${name}[1]`),
    decodeEvidenceReference(decoded[2], `${name}[2]`),
  ];
}

function decodePacketOmission(value: unknown, name: string): PacketOmission {
  const decoded = row(value, 3, name);
  return [
    controlledId(decoded[0], `${name}[0]`),
    digest(decoded[1], `${name}[1]`),
    text(decoded[2], `${name}[2]`),
  ];
}

/** Strictly decodes and verifies a persisted packet before checkpoint reuse. */
export function decodeReviewPacket(value: unknown, name = "Review packet"): ReviewPacket {
  const decoded = exact(
    value,
    [
      "schemaVersion",
      "packetId",
      "origin",
      "evaluationUnit",
      "ledger",
      "bundleDigest",
      "configurationDigest",
      "rubricDigest",
      "routingVersion",
      "projectionVersion",
      "citations",
      "opportunities",
      "omissions",
      "contentDigest",
    ],
    name,
  );
  if (decoded.schemaVersion !== REVIEW_PACKET_SCHEMA_VERSION) {
    throw new Error(`${name}.schemaVersion is unsupported.`);
  }
  if (decoded.routingVersion !== REVIEW_PACKET_ROUTING_VERSION) {
    throw new Error(`${name}.routingVersion is unsupported.`);
  }
  if (decoded.projectionVersion !== REVIEW_PACKET_PROJECTION_VERSION) {
    throw new Error(`${name}.projectionVersion is unsupported.`);
  }
  const origin = exact(decoded.origin, ["ordinal"], `${name}.origin`);
  const evaluationUnit = exact(
    decoded.evaluationUnit,
    ["kind", "actorIds"],
    `${name}.evaluationUnit`,
  );
  if (evaluationUnit.kind !== "shared-team" && evaluationUnit.kind !== "isolated-origin") {
    throw new Error(`${name}.evaluationUnit.kind is invalid.`);
  }
  const actorIds = values(evaluationUnit.actorIds, controlledId, `${name}.evaluationUnit.actorIds`);
  if (actorIds.length === 0 || new Set(actorIds).size !== actorIds.length) {
    throw new Error(`${name}.evaluationUnit.actorIds must be non-empty and unique.`);
  }
  const citations = values(decoded.citations, decodeCitation, `${name}.citations`);
  if (citations.length > REVIEW_PACKET_MAX_CITATIONS) {
    throw new Error(`${name}.citations exceeds the portable structured-schema limit.`);
  }
  const expectedCitationIds = citations.map(
    (_citation, index) => `c${String(index + 1).padStart(3, "0")}`,
  );
  if (citations.some(([citationId], index) => citationId !== expectedCitationIds[index])) {
    throw new Error(`${name}.citations must use ordered packet-local IDs.`);
  }
  const citationIds = new Set(expectedCitationIds);
  const opportunities = values(
    decoded.opportunities,
    (value, opportunityName): ReviewOpportunity => {
      const opportunity = row(value, 8, opportunityName);
      const opportunityId = text(opportunity[0], `${opportunityName}[0]`);
      if (!/^opp-[0-9]{4}$/.test(opportunityId)) {
        throw new Error(`${opportunityName}[0] is invalid.`);
      }
      const kind = opportunity[1];
      if (
        kind !== "stage-boundary" &&
        kind !== "peer-message" &&
        kind !== "actor-action" &&
        kind !== "tool-exchange" &&
        kind !== "checker-exchange" &&
        kind !== "git-change" &&
        kind !== "publication" &&
        kind !== "failure" &&
        kind !== "session-event"
      )
        throw new Error(`${opportunityName}.kind is invalid.`);
      const opportunityActors = values(opportunity[3], controlledId, `${opportunityName}[3]`);
      const opportunityCitations = values(opportunity[4], text, `${opportunityName}[4]`);
      if (
        opportunityCitations.length === 0 ||
        new Set(opportunityCitations).size !== opportunityCitations.length
      ) {
        throw new Error(`${opportunityName}[4] must be non-empty and unique.`);
      }
      if (opportunityCitations.some((citationId) => !citationIds.has(citationId))) {
        throw new Error(`${opportunityName} cites an ID outside the packet reference index.`);
      }
      const observationKind = text(opportunity[5], `${opportunityName}[5]`);
      if (!OBSERVATION_KIND.test(observationKind)) {
        throw new Error(`${opportunityName}[5] is invalid.`);
      }
      const projection = opportunity[6];
      if (
        projection !== "full" &&
        projection !== "excerpted" &&
        projection !== "metadata-only" &&
        projection !== "paired-tool"
      ) {
        throw new Error(`${opportunityName}[6] is invalid.`);
      }
      return [
        opportunityId,
        kind,
        integer(opportunity[2], 0, `${opportunityName}[2]`),
        opportunityActors,
        opportunityCitations,
        observationKind,
        projection,
        JSON.parse(canonicalJson(opportunity[7])) as JsonValue,
      ];
    },
    `${name}.opportunities`,
  );
  if (
    opportunities.some(
      ([opportunityId], index) => opportunityId !== `opp-${String(index + 1).padStart(4, "0")}`,
    )
  ) {
    throw new Error(`${name}.opportunities must use ordered opportunity IDs.`);
  }
  if (opportunities.some((item, index) => index > 0 && item[2] < opportunities[index - 1]![2])) {
    throw new Error(`${name}.opportunities must be chronological.`);
  }
  const packet = {
    schemaVersion: REVIEW_PACKET_SCHEMA_VERSION,
    packetId: controlledId(decoded.packetId, `${name}.packetId`),
    origin: {
      ordinal: integer(origin.ordinal, 1, `${name}.origin.ordinal`),
    },
    evaluationUnit: { kind: evaluationUnit.kind, actorIds },
    ledger: packetLedger(decoded.ledger, `${name}.ledger`),
    bundleDigest: digest(decoded.bundleDigest, `${name}.bundleDigest`),
    configurationDigest: digest(decoded.configurationDigest, `${name}.configurationDigest`),
    rubricDigest: digest(decoded.rubricDigest, `${name}.rubricDigest`),
    routingVersion: REVIEW_PACKET_ROUTING_VERSION,
    projectionVersion: REVIEW_PACKET_PROJECTION_VERSION,
    citations,
    opportunities,
    omissions: values(decoded.omissions, decodePacketOmission, `${name}.omissions`),
    contentDigest: digest(decoded.contentDigest, `${name}.contentDigest`),
  } as const;
  const { packetId, contentDigest: claimedDigest, ...packetBase } = packet;
  const expectedPacketId = `packet-${packet.ledger}-${contentDigest(packetBase).slice(0, 24)}`;
  if (packetId !== expectedPacketId)
    throw new Error(`${name}.packetId does not match its content.`);
  if (claimedDigest !== contentDigest({ ...packetBase, packetId })) {
    throw new Error(`${name}.contentDigest does not match its canonical decoded content.`);
  }
  if (byteCount(packet) > REVIEW_PACKET_MAX_BYTES) {
    throw new Error(`${name} exceeds ${String(REVIEW_PACKET_MAX_BYTES)} bytes.`);
  }
  return packet;
}
