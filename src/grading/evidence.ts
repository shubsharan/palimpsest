import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { canonicalJson, contentDigest } from "../canonical.js";
import { loadFixturePackage } from "../fixture/package.js";
import { GitCommandError, runGitCommand, type GitRepository } from "../git.js";
import type { JsonValue } from "../model/contracts.js";
import { loadRunRecord, type RunRecord } from "../run/record.js";
import { verifyTree } from "../seal.js";
import { loadObservationTrace, type ObservationEvent } from "../trace.js";
import {
  decodeEvidenceBundle,
  type EvidenceBundle,
  type EvidenceItem,
  type EvidenceOmission,
  type EvidenceReference,
} from "./contracts.js";

export const EVIDENCE_EXCERPT_BYTES = 8 * 1024;
export const EVIDENCE_WINDOW_BYTES = 48 * 1024;

const ALLOWED_TRACE_KIND =
  /^(?:stage\.|model\.response$|tool\.|team\.|git\.|usage\.|session\.|run\.(?:configured|sessions-ended|frozen)$|checker\.)/;
const FORBIDDEN_FIELD =
  /^(?:model|models|profile|provider|providerFamily|providerOptions|requestedModel|actualModel|actualProvider|responseIdentity|labels|runId|experimentId|fixtureId|fixtureDigest|buildId|constructionId|manifestDigest|spendCeilingCents|oracle|plaintext|expected|expectedWords|evaluation|evaluations|score|matchedWords|totalWords|coverage|accuracy|success)$/i;
const ACTOR_FIELD = /^(?:agentId|author)$/;

interface EvidenceBuildContext {
  readonly actorAliases: ReadonlyMap<string, string>;
  readonly originAliases: ReadonlyMap<string, string>;
  readonly identityValues: readonly string[];
  readonly forbiddenOutcomeValues: readonly string[];
  readonly omissions: EvidenceOmission[];
}

type EvidenceReferenceInput =
  | Omit<Extract<EvidenceReference, { source: "trace" }>, "excerptDigest">
  | Omit<Extract<EvidenceReference, { source: "run-record" }>, "excerptDigest">
  | Omit<Extract<EvidenceReference, { source: "git" }>, "excerptDigest">;

export interface CompileEvidenceOptions {
  readonly root: string;
  readonly runRoot: string;
}

export interface CompiledEvidence {
  readonly bundle: EvidenceBundle;
  readonly record: RunRecord;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}

async function readOptionalOutcomeText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function omission(
  context: EvidenceBuildContext,
  sourcePath: string,
  value: unknown,
  reason: string,
): void {
  const bytes = jsonBytes(value);
  context.omissions.push({
    sourcePath,
    byteCount: bytes.byteLength,
    contentDigest: sha256(bytes),
    reason,
  });
}

const PROHIBITED_OUTCOME_TEXT =
  /\b(?:oracle|plaintext|final\s+(?:answer|reconstruction|score)|final\s+output\s+(?:was|is)\s+(?:correct|incorrect|right|wrong)|(?:checker\s+)?(?:score|accuracy|coverage)\s*(?:is|=|:)?\s*\d+(?:\.\d+)?%?|checker\s+(?:passed|failed|succeeded)|matched\s+\d+\s*(?:of|\/)\s*\d+|(?:i|we|the\s+team|the\s+solver)\s+(?:have\s+)?(?:solved|reconstructed|decoded|decrypted)|(?:we|i)\s+got\s+\d+(?:\.\d+)?\s*(?:percent|%)|the\s+run\s+(?:succeeded|passed|failed))(?!\w)/i;

function sanitizeText(value: string, sourcePath: string, context: EvidenceBuildContext): string {
  let result = value;
  for (const identity of context.identityValues) {
    result = result.replaceAll(identity, "[redacted-identity]");
  }
  for (const [agentId, alias] of context.actorAliases) result = result.replaceAll(agentId, alias);
  for (const [originId, alias] of context.originAliases) {
    if (originId !== "shared") result = result.replaceAll(originId, alias);
  }
  if (
    PROHIBITED_OUTCOME_TEXT.test(result) ||
    context.forbiddenOutcomeValues.some(
      (outcome) => value.includes(outcome) || result.includes(outcome),
    )
  ) {
    omission(
      context,
      sourcePath,
      value,
      "free-form text contained a final-outcome claim or frozen outcome content",
    );
    return "[redacted-outcome-content]";
  }
  return result;
}

function sanitize(value: unknown, sourcePath: string, context: EvidenceBuildContext): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value as JsonValue;
  }
  if (typeof value === "string") return sanitizeText(value, sourcePath, context);
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitize(item, `${sourcePath}/${String(index)}`, context));
  }
  if (typeof value !== "object") {
    omission(context, sourcePath, String(value), "non-JSON payload excluded");
    return null;
  }
  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${sourcePath}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (FORBIDDEN_FIELD.test(key)) {
      omission(
        context,
        childPath,
        child,
        "identity, configuration, oracle, or outcome field excluded",
      );
      continue;
    }
    if (ACTOR_FIELD.test(key) && typeof child === "string") {
      const actor = context.actorAliases.get(child);
      if (actor === undefined) {
        omission(context, childPath, child, "unknown actor identity excluded");
        continue;
      }
      result[key] = actor;
      continue;
    }
    if (key === "repositoryId" && typeof child === "string") {
      result[key] = context.originAliases.get(child) ?? "origin-unknown";
      continue;
    }
    result[key] = sanitize(child, childPath, context);
  }
  return result;
}

function evidenceActor(event: ObservationEvent, actorAliases: ReadonlyMap<string, string>): string {
  if (event.kind === "team.message") {
    const data =
      typeof event.data === "object" && event.data !== null && !Array.isArray(event.data)
        ? (event.data as Record<string, unknown>)
        : undefined;
    const author = typeof data?.author === "string" ? data.author : undefined;
    if (author !== undefined && event.agentId !== undefined && author !== event.agentId) {
      throw new Error(
        `Trace event ${String(event.sequence)} has conflicting team-message authors.`,
      );
    }
    const actor = author ?? event.agentId;
    if (actor === undefined) {
      throw new Error(`Trace event ${String(event.sequence)} team.message has no author.`);
    }
    const alias = actorAliases.get(actor);
    if (alias === undefined) {
      throw new Error(
        `Trace event ${String(event.sequence)} names an unknown team-message author.`,
      );
    }
    return alias;
  }
  if (event.agentId === undefined) return "runner";
  const alias = actorAliases.get(event.agentId);
  if (alias === undefined)
    throw new Error(`Trace event ${String(event.sequence)} names an unknown actor.`);
  return alias;
}

function eventData(event: ObservationEvent, context: EvidenceBuildContext): JsonValue {
  const sourcePath = `trace.jsonl#/${String(event.sequence)}/data`;
  if (event.kind === "run.configured") {
    const data = sanitize(event.data, sourcePath, context);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
    const allowed = new Set([
      "gitVisibility",
      "teamRoom",
      "checker",
      "variantId",
      "releaseOffsetsMs",
      "cutoffMs",
      "tokenBudgetPerAgent",
      "agentCount",
    ]);
    const result: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(data)) {
      if (allowed.has(key)) result[key] = value;
      else omission(context, `${sourcePath}/${key}`, value, "non-review run identity excluded");
    }
    return result;
  }
  if (event.kind === "run.frozen") {
    const value = event.data as Record<string, unknown>;
    return {
      communicationMode:
        value !== null &&
        (value.communicationMode === "shared" || value.communicationMode === "isolated")
          ? value.communicationMode
          : "unknown",
      repositoryCount: Array.isArray(value?.repositories) ? value.repositories.length : 0,
      workspaceCount: Array.isArray(value?.workspaces) ? value.workspaces.length : 0,
    };
  }
  return sanitize(event.data, sourcePath, context);
}

function boundedContent(value: JsonValue): {
  readonly content: JsonValue;
  readonly bytes: Buffer;
  readonly availability: "full" | "excerpted";
} {
  const complete = Buffer.from(JSON.stringify(value), "utf8");
  if (complete.byteLength <= EVIDENCE_EXCERPT_BYTES) {
    return { content: value, bytes: complete, availability: "full" };
  }
  let end = EVIDENCE_EXCERPT_BYTES;
  while (end > 0 && (complete[end]! & 0xc0) === 0x80) end -= 1;
  let excerpt = complete.subarray(0, end).toString("utf8");
  while (Buffer.byteLength(excerpt, "utf8") > EVIDENCE_EXCERPT_BYTES)
    excerpt = excerpt.slice(0, -1);
  return { content: excerpt, bytes: Buffer.from(excerpt, "utf8"), availability: "excerpted" };
}

function evidenceId(referenceKey: string, contentBytes: Buffer): string {
  return `e-${sha256(Buffer.concat([Buffer.from(referenceKey), Buffer.from("\0"), contentBytes])).slice(0, 24)}`;
}

function item(options: {
  readonly atMs: number;
  readonly actorId: string;
  readonly kind: string;
  readonly content: JsonValue;
  readonly reference: EvidenceReferenceInput;
  readonly referenceKey: string;
  readonly sourcePath: string;
  readonly context: EvidenceBuildContext;
  readonly metadataOnlyReason?: string;
}): EvidenceItem {
  const bounded = boundedContent(options.content);
  const excerptDigest = sha256(bounded.bytes);
  if (bounded.availability === "excerpted") {
    omission(
      options.context,
      options.sourcePath,
      options.content,
      `review payload exceeded ${String(EVIDENCE_EXCERPT_BYTES)} bytes and was excerpted`,
    );
  }
  const availability =
    bounded.availability === "excerpted"
      ? "excerpted"
      : options.metadataOnlyReason === undefined
        ? "full"
        : "metadata-only";
  return {
    evidenceId: evidenceId(options.referenceKey, bounded.bytes),
    atMs: options.atMs,
    actorId: options.actorId,
    kind: options.kind,
    content: bounded.content,
    reference: { ...options.reference, excerptDigest } as EvidenceReference,
    availability,
    ...(availability === "full"
      ? {}
      : {
          omissionReason:
            availability === "excerpted"
              ? `payload excerpted at ${String(EVIDENCE_EXCERPT_BYTES)} bytes`
              : options.metadataOnlyReason,
        }),
  };
}

function windows(items: readonly EvidenceItem[]) {
  const result: { windowId: string; evidenceIds: string[]; byteCount: number }[] = [];
  let evidenceIds: string[] = [];
  let byteCount = 0;
  const flush = () => {
    if (evidenceIds.length === 0) return;
    result.push({
      windowId: `window-${String(result.length + 1).padStart(4, "0")}`,
      evidenceIds,
      byteCount,
    });
    evidenceIds = [];
    byteCount = 0;
  };
  for (const evidence of items) {
    const size = Buffer.byteLength(JSON.stringify(evidence), "utf8");
    if (evidenceIds.length > 0 && byteCount + size > EVIDENCE_WINDOW_BYTES) flush();
    evidenceIds.push(evidence.evidenceId);
    byteCount += size;
  }
  flush();
  return result;
}

async function canonicalSolverSource(
  repository: GitRepository,
  commit: string,
): Promise<{ readonly source: string; readonly byteCount: number } | undefined> {
  let size: number;
  try {
    const result = await runGitCommand(["cat-file", "-s", `${commit}:solver.py`], {
      cwd: repository.path,
    });
    size = Number(result.stdout.trim());
  } catch (error) {
    if (error instanceof GitCommandError) return undefined;
    throw error;
  }
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(
      `Frozen Git returned an invalid solver.py size for ${repository.repositoryId}.`,
    );
  }
  if (size > EVIDENCE_EXCERPT_BYTES) return { source: "", byteCount: size };
  const result = await runGitCommand(["show", `${commit}:solver.py`], { cwd: repository.path });
  if (Buffer.byteLength(result.stdout, "utf8") !== size) {
    throw new Error(
      `Frozen Git returned inconsistent solver.py bytes for ${repository.repositoryId}.`,
    );
  }
  return { source: result.stdout, byteCount: size };
}

function identityValues(record: RunRecord): readonly string[] {
  const values = new Set<string>([record.runId]);
  for (const model of record.configuration.models) {
    for (const value of [
      model.binding.profile,
      model.binding.provider,
      model.binding.driver,
      model.binding.requestedModel,
    ]) {
      if (value.length >= 4) values.add(value);
    }
  }
  return [...values].sort((left, right) => right.length - left.length);
}

export function assertOutcomeBlindEvidenceBundle(bundle: EvidenceBundle, record: RunRecord): void {
  const reviewerSurface = JSON.stringify({
    communicationMode: bundle.communicationMode,
    actors: bundle.actors,
    items: bundle.items,
    windows: bundle.windows,
  });
  for (const identity of identityValues(record)) {
    if (reviewerSurface.includes(identity)) {
      throw new Error("Reviewer evidence contains a prohibited run, model, or provider identity.");
    }
  }
  if (
    /"(?:evaluation|score|accuracy|coverage|matchedWords|totalWords|oracle|plaintext)"\s*:/i.test(
      reviewerSurface,
    )
  ) {
    throw new Error("Reviewer evidence contains prohibited oracle or final-outcome data.");
  }
}

export async function compileEvidence(options: CompileEvidenceOptions): Promise<CompiledEvidence> {
  const root = resolve(options.root);
  const runRoot = resolve(options.runRoot);
  const loaded = await loadRunRecord(root, runRoot);
  if (loaded.record.status !== "completed") throw new Error("Only completed runs can be graded.");
  const fixture = await loadFixturePackage(loaded.fixtureRoot);
  if (fixture.contentDigest !== loaded.record.configuration.run.fixture.digest) {
    throw new Error("Frozen fixture package differs from the RunRecord fixture digest.");
  }
  await verifyTree(loaded.topology.root, loaded.topology.treeSeal, "Frozen Git tree");
  const trace = await loadObservationTrace(join(runRoot, loaded.record.trace.path));
  const actorAliases = new Map(
    loaded.record.sessions.map(({ agentId }, index) => [agentId, `actor-${String(index + 1)}`]),
  );
  const originAliases = new Map(
    loaded.record.topology.origins.map(({ originId }, index) => [
      originId,
      `origin-${String(index + 1)}`,
    ]),
  );
  const omissions: EvidenceOmission[] = [];
  const frozenOutcomeTexts = (
    await Promise.all([
      readFile(join(loaded.fixtureRoot, "oracle", "plaintext.txt"), "utf8"),
      ...loaded.record.evaluations.flatMap(({ results }) =>
        results.flatMap(({ outputPath }) =>
          outputPath === undefined ? [] : [readOptionalOutcomeText(join(runRoot, outputPath))],
        ),
      ),
    ])
  ).filter((value): value is string => value !== undefined);
  const forbiddenOutcomeValues = [
    ...new Set(
      frozenOutcomeTexts.flatMap((value) => [
        value.trim(),
        ...value.split(/\r?\n/).map((line) => line.trim()),
      ]),
    ),
  ].filter((value) => Buffer.byteLength(value, "utf8") >= 16);
  const context: EvidenceBuildContext = {
    actorAliases,
    originAliases,
    identityValues: identityValues(loaded.record),
    forbiddenOutcomeValues,
    omissions,
  };
  omission(
    context,
    "run.json#/configuration/models",
    loaded.record.configuration.models,
    "model and provider identities excluded",
  );
  omission(
    context,
    "run.json#/evaluations",
    loaded.record.evaluations,
    "final outcome excluded from process review",
  );
  omission(
    context,
    "run.json#/configuration/run/labels",
    loaded.record.configuration.run.labels,
    "experiment labels excluded",
  );

  const items: EvidenceItem[] = [];
  items.push(
    item({
      atMs: 0,
      actorId: "runner",
      kind: "run.context",
      content: {
        communicationMode: loaded.record.topology.communicationMode,
        stageCount: loaded.record.configuration.run.schedule.releaseOffsetsMs.length,
        cutoffMs: loaded.record.configuration.run.schedule.cutoffMs,
        checker: loaded.record.configuration.run.capabilities.checker ?? true,
        tokenLimitPerActor: loaded.record.configuration.run.limits.tokenLimitPerAgent,
      },
      reference: { source: "run-record", recordPointer: "/configuration/run", role: "context" },
      referenceKey: "run-record:/configuration/run",
      sourcePath: "run.json#/configuration/run",
      context,
    }),
  );
  for (const event of trace.events) {
    if (!ALLOWED_TRACE_KIND.test(event.kind)) {
      omission(
        context,
        `trace.jsonl#/${String(event.sequence)}`,
        event,
        event.kind.startsWith("evaluation.")
          ? "final outcome event excluded from process review"
          : "event kind is outside the process-evidence allowlist",
      );
      continue;
    }
    const actorId = evidenceActor(event, actorAliases);
    items.push(
      item({
        atMs: event.atMs,
        actorId,
        kind: event.kind,
        content: eventData(event, context),
        reference: { source: "trace", traceSequence: event.sequence, role: "context" },
        referenceKey: `trace:${String(event.sequence)}`,
        sourcePath: `trace.jsonl#/${String(event.sequence)}/data`,
        context,
        ...(event.kind === "run.configured" || event.kind === "run.frozen"
          ? { metadataOnlyReason: "only reviewer-safe run metadata is retained" }
          : {}),
      }),
    );
  }
  let finalAtMs = Math.max(0, ...trace.events.map(({ atMs }) => atMs));
  for (const [index, session] of loaded.record.sessions.entries()) {
    finalAtMs += 1;
    items.push(
      item({
        atMs: finalAtMs,
        actorId: actorAliases.get(session.agentId)!,
        kind: "usage.summary",
        content: {
          inputTokens: session.inputTokens,
          outputTokens: session.outputTokens,
          state: session.state,
          terminationReason: session.terminationReason,
        },
        reference: {
          source: "run-record",
          recordPointer: `/sessions/${String(index)}`,
          role: "context",
        },
        referenceKey: `run-record:/sessions/${String(index)}`,
        sourcePath: `run.json#/sessions/${String(index)}`,
        context,
      }),
    );
  }
  for (const [index, origin] of loaded.record.topology.origins.entries()) {
    finalAtMs += 1;
    const content = {
      originId: originAliases.get(origin.originId)!,
      actors: origin.agentIds.map((agentId) => actorAliases.get(agentId)!),
      canonicalMainPublished: origin.mainCommit !== null,
      ...(origin.mainCommit === null ? {} : { commit: origin.mainCommit }),
    };
    const reference =
      origin.mainCommit === null
        ? ({
            source: "run-record",
            recordPointer: `/topology/origins/${String(index)}`,
            role: "context",
          } as const)
        : ({
            source: "git",
            originId: originAliases.get(origin.originId)!,
            commit: origin.mainCommit,
            role: "context",
          } as const);
    items.push(
      item({
        atMs: finalAtMs,
        actorId: origin.agentIds.length === 1 ? actorAliases.get(origin.agentIds[0]!)! : "runner",
        kind: "git.canonical",
        content,
        reference,
        referenceKey: `git:${origin.originId}:${origin.mainCommit ?? "missing"}`,
        sourcePath: `run.json#/topology/origins/${String(index)}`,
        context,
      }),
    );
    const solverPath = `git:${originAliases.get(origin.originId)!}:${origin.mainCommit ?? "missing"}:solver.py`;
    if (origin.mainCommit === null) {
      omission(
        context,
        solverPath,
        { originId: originAliases.get(origin.originId), path: "solver.py" },
        "canonical main commit is unavailable",
      );
      continue;
    }
    const repository = loaded.topology.repositories.find(
      ({ repositoryId }) => repositoryId === origin.originId,
    );
    if (repository === undefined) {
      throw new Error(`Frozen repository is missing for canonical origin ${origin.originId}.`);
    }
    const solver = await canonicalSolverSource(repository, origin.mainCommit);
    if (solver === undefined) {
      omission(
        context,
        solverPath,
        {
          originId: originAliases.get(origin.originId),
          commit: origin.mainCommit,
          path: "solver.py",
        },
        "canonical solver.py is unavailable at the frozen main commit",
      );
      continue;
    }
    if (solver.byteCount > EVIDENCE_EXCERPT_BYTES) {
      omission(
        context,
        solverPath,
        {
          originId: originAliases.get(origin.originId),
          commit: origin.mainCommit,
          path: "solver.py",
          byteCount: solver.byteCount,
        },
        `canonical solver.py exceeded ${String(EVIDENCE_EXCERPT_BYTES)} bytes`,
      );
      continue;
    }
    finalAtMs += 1;
    const sanitizedSource = sanitizeText(solver.source, solverPath, context);
    const outcomeRedacted = sanitizedSource === "[redacted-outcome-content]";
    items.push(
      item({
        atMs: finalAtMs,
        actorId: "runner",
        kind: "git.solver-snapshot",
        content: sanitizedSource,
        reference: {
          source: "git",
          originId: originAliases.get(origin.originId)!,
          commit: origin.mainCommit,
          path: "solver.py",
          role: "context",
        },
        referenceKey: `git:${origin.originId}:${origin.mainCommit}:solver.py`,
        sourcePath: solverPath,
        context,
        ...(outcomeRedacted
          ? { metadataOnlyReason: "canonical solver contained outcome-bearing content" }
          : {}),
      }),
    );
  }
  const sourceDigest = contentDigest({
    record: { ...loaded.record, analyses: [] },
    trace,
  });
  const bundleBase = {
    schemaVersion: 1 as const,
    runFingerprint: contentDigest({
      sourceDigest,
      configurationDigest: loaded.record.configuration.digest,
    }),
    communicationMode: loaded.record.topology.communicationMode,
    actors: [...actorAliases.values()],
    items,
    windows: windows(items),
    omissions,
    sourceDigest,
  };
  const bundleId = `bundle-${contentDigest(bundleBase).slice(0, 24)}`;
  const contentDigestValue = contentDigest({ ...bundleBase, bundleId });
  const bundle = decodeEvidenceBundle({
    ...bundleBase,
    bundleId,
    contentDigest: contentDigestValue,
  });
  assertOutcomeBlindEvidenceBundle(bundle, loaded.record);
  return { bundle, record: loaded.record };
}

export const compileEvidenceBundle = compileEvidence;

export async function evidenceSourceBytes(runRoot: string): Promise<{
  readonly run: Buffer;
  readonly trace: Buffer;
  readonly traceMetadata: Buffer;
}> {
  const resolved = resolve(runRoot);
  const [run, trace, traceMetadata] = await Promise.all([
    readFile(join(resolved, "run.json")),
    readFile(join(resolved, "trace.jsonl")),
    readFile(join(resolved, "trace.meta.json")),
  ]);
  return { run, trace, traceMetadata };
}
