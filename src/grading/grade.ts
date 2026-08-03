import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { canonicalJson, contentDigest } from "../canonical.js";
import { requiredFlag } from "../flags.js";
import type { GitRepositoryId } from "../git.js";
import { runPythonJson } from "../python.js";
import {
  appendRunAnalysis,
  loadRunRecord,
  type PerformanceRunAnalysis,
  type RunAnalysis,
  type RunEvaluation,
  type RunRecord,
} from "../run/record.js";
import {
  decodeQuantitativeMeasure,
  type EvidenceItem,
  type EvidenceReference,
  type QuantitativeMeasure,
} from "./contracts.js";
import { compileEvidence } from "./evidence.js";

export const GRADER_VERSION = "epistemic-process-v1";
const DEFAULT_CONFIGURATION_PATH = "grading/epistemic-process-v1.yaml";

export interface GradeRunOptions {
  readonly root: string;
  readonly runRoot: string;
  readonly projectRoot?: string;
  readonly configPath?: string;
  readonly now?: () => Date;
}

export interface GradeRunDependencies {
  readonly appendAnalysis?: typeof appendRunAnalysis;
  readonly invokePython?: typeof runPythonJson;
}

export interface MeasureGroup {
  readonly originId: GitRepositoryId;
  readonly values: readonly QuantitativeMeasure[];
}

export interface PerformanceMetrics {
  readonly schemaVersion: 1;
  readonly kind: "measure";
  readonly measures: readonly MeasureGroup[];
}

interface NormalizedEvent {
  readonly sequence: number;
  readonly atMs: number;
  readonly kind:
    | "stage"
    | "response"
    | "tool"
    | "checker"
    | "message"
    | "read"
    | "git"
    | "usage"
    | "termination"
    | "publication";
  readonly originId: GitRepositoryId;
  readonly actorId?: string;
  readonly data: Record<string, unknown>;
  readonly evidence: EvidenceReference;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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

export function decodePerformanceMetrics(
  value: Record<string, unknown>,
  origins: readonly GitRepositoryId[],
): PerformanceMetrics {
  const decoded = exact(value, ["schemaVersion", "kind", "measures"], "Process measure response");
  if (
    decoded.schemaVersion !== 1 ||
    decoded.kind !== "measure" ||
    !Array.isArray(decoded.measures)
  ) {
    throw new Error("Process measure response has an unsupported schema or kind.");
  }
  const measures = decoded.measures.map((value, index): MeasureGroup => {
    const group = exact(
      value,
      ["originId", "values"],
      `Process measure group ${String(index + 1)}`,
    );
    if (
      typeof group.originId !== "string" ||
      !origins.includes(group.originId as GitRepositoryId)
    ) {
      throw new Error(`Process measure group ${String(index + 1)} has an unknown origin.`);
    }
    if (!Array.isArray(group.values)) {
      throw new Error(`Process measure group ${String(index + 1)} values must be an array.`);
    }
    const values = group.values.map((item, measureIndex) =>
      decodeQuantitativeMeasure(
        item,
        `Process measure group ${String(index + 1)} value ${String(measureIndex + 1)}`,
      ),
    );
    const ids = values.map(({ measureId }) => measureId);
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Process measure group ${String(index + 1)} has duplicate measure IDs.`);
    }
    return { originId: group.originId as GitRepositoryId, values };
  });
  if (
    measures.length !== origins.length ||
    measures.some(({ originId }, index) => originId !== origins[index])
  ) {
    throw new Error("Process measure response must cover canonical origins exactly once in order.");
  }
  return { schemaVersion: 1, kind: "measure", measures };
}

function runRecordReference(pointer: string, value: unknown): EvidenceReference {
  return {
    source: "run-record",
    recordPointer: pointer,
    excerptDigest: sha256(JSON.stringify(value)),
    role: "context",
  };
}

function originForActor(
  record: RunRecord,
  actorId: string,
  actors: readonly string[],
): GitRepositoryId {
  const index = actors.indexOf(actorId);
  const session = record.sessions[index];
  if (session === undefined) throw new Error(`Unknown anonymized actor ${actorId}.`);
  const origin = record.topology.origins.find(({ agentIds }) => agentIds.includes(session.agentId));
  if (origin === undefined) throw new Error(`Actor ${actorId} is not assigned to a frozen origin.`);
  return origin.originId;
}

function contentObject(item: EvidenceItem): Record<string, unknown> | undefined {
  return typeof item.content === "object" && item.content !== null && !Array.isArray(item.content)
    ? (item.content as Record<string, unknown>)
    : undefined;
}

function traceEvent(
  item: EvidenceItem,
  record: RunRecord,
  actors: readonly string[],
): Omit<NormalizedEvent, "sequence"> | undefined {
  if (item.reference.source !== "trace") return undefined;
  const content = contentObject(item);
  const actorId = item.actorId === "runner" ? undefined : item.actorId;
  let originId: GitRepositoryId;
  if (record.topology.communicationMode === "shared") {
    originId = "shared";
  } else if (actorId !== undefined) {
    originId = originForActor(record, actorId, actors);
  } else if (item.kind === "git.changed" && typeof content?.repositoryId === "string") {
    const index = Number(content.repositoryId.replace("origin-", "")) - 1;
    const origin = record.topology.origins[index];
    if (origin === undefined) return undefined;
    originId = origin.originId;
  } else {
    return undefined;
  }
  const common = {
    atMs: item.atMs,
    originId,
    ...(actorId === undefined ? {} : { actorId }),
    evidence: item.reference,
  };
  if (item.kind === "stage.released") {
    const ordinal =
      typeof content?.ordinal === "number" ? content.ordinal : item.reference.traceSequence;
    return { ...common, kind: "stage", data: { stageId: `stage-${String(ordinal)}` } };
  }
  if (item.kind === "model.response") return { ...common, kind: "response", data: {} };
  if (item.kind === "team.message") {
    const author = typeof content?.author === "string" ? content.author : actorId;
    return {
      ...common,
      ...(author === undefined ? {} : { actorId: author }),
      kind: "message",
      data: {},
    };
  }
  if (item.kind === "git.changed") {
    return { ...common, kind: "git", data: { refTargetsKnown: Array.isArray(content?.targets) } };
  }
  if (item.kind === "tool.started") {
    const name = typeof content?.name === "string" ? content.name : "unknown-tool";
    if (name === "check_published_solver") return { ...common, kind: "checker", data: {} };
    if (name === "get_team_messages") return { ...common, kind: "read", data: {} };
    const controlledName = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(name)
      ? name
      : `tool-${sha256(name).slice(0, 12)}`;
    return { ...common, kind: "tool", data: { toolName: controlledName } };
  }
  return undefined;
}

function evaluationFor(
  record: RunRecord,
  originId: GitRepositoryId,
): { value: RunEvaluation; pointer: string } {
  for (let batchIndex = record.evaluations.length - 1; batchIndex >= 0; batchIndex -= 1) {
    const batch = record.evaluations[batchIndex]!;
    if (batch.kind !== "automatic") continue;
    const resultIndex = batch.results.findIndex((result) => result.originId === originId);
    if (resultIndex >= 0) {
      return {
        value: batch.results[resultIndex]!,
        pointer: `/evaluations/${String(batchIndex)}/results/${String(resultIndex)}`,
      };
    }
  }
  throw new Error(`Canonical origin ${originId} has no automatic evaluation.`);
}

export interface ReviewMeasureInput {
  readonly reviewerId: string;
  readonly revisionOpportunities: readonly {
    readonly episodeId: string;
    readonly status: string;
    readonly evidence: readonly EvidenceReference[];
  }[];
  readonly collaborationOpportunities: readonly {
    readonly episodeId: string;
    readonly status: string;
    readonly contributionActorId: string;
    readonly contributedAtMs: number;
    readonly uptakeActorId?: string;
    readonly uptakeAtMs?: number;
    readonly integratedAtMs?: number;
    readonly evidence: readonly EvidenceReference[];
  }[];
}

export function createMeasureRequest(
  record: RunRecord,
  items: readonly EvidenceItem[],
  actors: readonly string[],
  reviews: readonly ReviewMeasureInput[] = [],
) {
  const origins = record.topology.origins.map(({ originId }) => {
    const evaluation = evaluationFor(record, originId);
    return {
      originId,
      startedAtMs: 0,
      endedAtMs: new Date(record.frozenAt).valueOf() - new Date(record.startedAt).valueOf(),
      outcome: {
        runnable: evaluation.value.status === "scored",
        ...evaluation.value.score,
        evidence: [runRecordReference(evaluation.pointer, evaluation.value)],
      },
    };
  });
  const events: Omit<NormalizedEvent, "sequence">[] = items.flatMap((item) => {
    const normalized = traceEvent(item, record, actors);
    return normalized === undefined ? [] : [normalized];
  });
  for (const [sessionIndex, session] of record.sessions.entries()) {
    const actorId = actors[sessionIndex]!;
    events.push({
      atMs: new Date(record.frozenAt).valueOf() - new Date(record.startedAt).valueOf(),
      kind: "usage",
      originId: originForActor(record, actorId, actors),
      actorId,
      data: { inputTokens: session.inputTokens, outputTokens: session.outputTokens },
      evidence: runRecordReference(`/sessions/${String(sessionIndex)}`, session),
    });
  }
  for (const origin of record.topology.origins) {
    const originIndex = record.topology.origins.indexOf(origin);
    const assigned = record.sessions.filter(({ agentId }) => origin.agentIds.includes(agentId));
    const termination = assigned.some(({ state }) => state === "infrastructure-error")
      ? "infrastructure-failed"
      : "completed";
    const evaluation = evaluationFor(record, origin.originId);
    events.push(
      {
        atMs: new Date(record.frozenAt).valueOf() - new Date(record.startedAt).valueOf(),
        kind: "termination",
        originId: origin.originId,
        data: { value: termination },
        evidence: runRecordReference(`/topology/origins/${String(originIndex)}`, origin),
      },
      {
        atMs: new Date(record.frozenAt).valueOf() - new Date(record.startedAt).valueOf(),
        kind: "publication",
        originId: origin.originId,
        data: { runnable: evaluation.value.status === "scored" },
        evidence: runRecordReference(evaluation.pointer, evaluation.value),
      },
    );
  }
  events.sort(
    (left, right) =>
      left.atMs - right.atMs ||
      left.originId.localeCompare(right.originId) ||
      left.kind.localeCompare(right.kind) ||
      (left.actorId ?? "").localeCompare(right.actorId ?? ""),
  );
  return {
    schemaVersion: 1,
    kind: "measure",
    communicationMode: record.topology.communicationMode,
    actors,
    origins,
    events: events.map((event, index) => ({ sequence: index + 1, ...event })),
    reviews,
  };
}

function duplicatePerformance(
  analyses: readonly RunAnalysis[],
  sourceDigest: string,
  configurationDigest: string,
): PerformanceRunAnalysis | undefined {
  return analyses.find(
    (analysis): analysis is PerformanceRunAnalysis =>
      analysis.kind === "performance" &&
      analysis.sourceDigest === sourceDigest &&
      analysis.configurationDigest === configurationDigest,
  );
}

export async function gradeRun(
  options: GradeRunOptions,
  dependencies: GradeRunDependencies = {},
): Promise<PerformanceRunAnalysis> {
  const root = resolve(options.root);
  const runRoot = resolve(options.runRoot);
  const projectRoot = resolve(options.projectRoot ?? ".");
  const configurationPath = resolve(projectRoot, options.configPath ?? DEFAULT_CONFIGURATION_PATH);
  const configurationBytes = await readFile(configurationPath);
  const configurationDigest = contentDigest({
    graderVersion: GRADER_VERSION,
    configurationFileDigest: sha256(configurationBytes),
  });
  const { bundle, record } = await compileEvidence({ root, runRoot });
  const duplicate = duplicatePerformance(record.analyses, bundle.sourceDigest, configurationDigest);
  if (duplicate !== undefined) {
    throw new Error(
      `Performance analysis ${duplicate.analysisId} already exists for this source and configuration.`,
    );
  }
  const request = createMeasureRequest(record, bundle.items, bundle.actors);
  const invokePython = dependencies.invokePython ?? runPythonJson;
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
  const analysisId = `performance-${randomUUID()}`;
  const detailsPath = `grading/${analysisId}/manifest.json`;
  const originStatuses = record.topology.origins.map(({ originId }) => ({
    originId,
    status: "eligible" as const,
  }));
  const evidenceDigest = bundle.contentDigest;
  const metricsDigest = contentDigest(metrics);
  const manifest = {
    schemaVersion: 1,
    kind: "performance",
    analysisId,
    graderVersion: GRADER_VERSION,
    configurationDigest,
    sourceDigest: bundle.sourceDigest,
    evidence: { path: "evidence.json", contentDigest: evidenceDigest },
    metrics: { path: "metrics.json", contentDigest: metricsDigest },
    origins: originStatuses,
  };
  const detailsDigest = contentDigest(manifest);
  const analysis: PerformanceRunAnalysis = {
    analysisId,
    kind: "performance",
    analyzedAt: (options.now ?? (() => new Date()))().toISOString(),
    graderVersion: GRADER_VERSION,
    configurationDigest,
    sourceDigest: bundle.sourceDigest,
    detailsPath,
    detailsDigest,
    origins: originStatuses,
  };
  const gradingRoot = join(runRoot, "grading");
  await mkdir(gradingRoot, { recursive: true });
  const stagingRoot = await mkdtemp(join(gradingRoot, ".performance-"));
  const finalRoot = join(gradingRoot, analysisId);
  let published = false;
  try {
    const files = [
      [join(stagingRoot, "evidence.json"), `${JSON.stringify(bundle, null, 2)}\n`],
      [join(stagingRoot, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`],
      [join(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`],
    ] as const;
    await Promise.all(
      files.map(async ([path, value]) => {
        await writeFile(path, value, { encoding: "utf8", flag: "wx", mode: 0o444 });
        await chmod(path, 0o444);
      }),
    );
    await rename(stagingRoot, finalRoot);
    published = true;
    const latest = await loadRunRecord(root, runRoot);
    const raced = duplicatePerformance(
      latest.record.analyses,
      bundle.sourceDigest,
      configurationDigest,
    );
    if (raced !== undefined) {
      throw new Error(`Performance analysis ${raced.analysisId} was published concurrently.`);
    }
    await (dependencies.appendAnalysis ?? appendRunAnalysis)(runRoot, latest.record, analysis);
    return analysis;
  } finally {
    if (published) {
      const current = await loadRunRecord(root, runRoot).catch(() => undefined);
      const retained =
        current?.record.analyses.some(({ analysisId: id }) => id === analysisId) ?? false;
      if (!retained) await rm(finalRoot, { recursive: true, force: true });
    } else {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}

export function gradeRunFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<PerformanceRunAnalysis> {
  for (const flag of flags.keys()) {
    if (flag !== "--run-root" && flag !== "--config") {
      throw new Error(`Unknown grading option ${flag}.`);
    }
  }
  const configPath = flags.get("--config");
  return gradeRun({
    root,
    projectRoot: root,
    runRoot: requiredFlag(flags, "--run-root"),
    ...(configPath === undefined ? {} : { configPath }),
  });
}

export function performanceDetailsRoot(runRoot: string, analysis: PerformanceRunAnalysis): string {
  return dirname(resolve(runRoot, analysis.detailsPath));
}
