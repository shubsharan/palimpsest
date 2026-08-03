import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadFixturePackage } from "../fixture/package.js";
import { isAgentId, type JsonValue } from "../model/contracts.js";
import { loadRunRecord, validateRunRecordTrace } from "../run/record.js";
import { verifyTree } from "../seal.js";
import { readObservationTrace, type ObservationEvent } from "../trace.js";
import type {
  ViewerEvent,
  ViewerEventCategory,
  ViewerRun,
  ViewerTeamMessage,
  ViewerToolCall,
} from "./contracts.js";

function categoryFor(kind: string): ViewerEventCategory {
  if (kind.startsWith("model.")) return "model";
  if (kind.startsWith("tool.")) return "tool";
  if (kind.startsWith("team.")) return "team";
  if (kind.startsWith("stage.")) return "stage";
  if (kind.startsWith("git.")) return "git";
  if (kind.startsWith("session.")) return "session";
  if (kind.startsWith("run.")) return "run";
  if (kind.startsWith("evaluation.")) return "evaluation";
  if (kind.startsWith("infrastructure.")) return "infrastructure";
  return "other";
}

function jsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value !== "object") return String(value);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonValue(child)]));
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function viewerEvent(event: ObservationEvent): ViewerEvent {
  return {
    sequence: event.sequence,
    atMs: event.atMs,
    kind: event.kind,
    category: categoryFor(event.kind),
    ...(event.agentId === undefined ? {} : { agentId: event.agentId }),
    data: jsonValue(event.data),
  };
}

function pairToolCalls(events: readonly ObservationEvent[]): ViewerToolCall[] {
  const calls = new Map<string, ViewerToolCall>();
  for (const event of events) {
    if (event.agentId === undefined || !event.kind.startsWith("tool.")) continue;
    const data = object(event.data);
    if (data === undefined) continue;
    const id = data?.id;
    const name = data?.name;
    if (typeof id !== "string" || typeof name !== "string") continue;
    const key = `${event.agentId}\0${id}`;
    if (event.kind === "tool.started") {
      calls.set(key, {
        id,
        agentId: event.agentId,
        name,
        startedSequence: event.sequence,
        startedAtMs: event.atMs,
        status: "running",
        arguments: jsonValue(data.arguments ?? null),
      });
      continue;
    }
    const started = calls.get(key);
    if (started === undefined) continue;
    if (event.kind === "tool.completed") {
      calls.set(key, {
        ...started,
        completedSequence: event.sequence,
        completedAtMs: event.atMs,
        status: "completed",
        output: jsonValue(data.output ?? null),
      });
    } else if (event.kind === "tool.error") {
      calls.set(key, {
        ...started,
        completedSequence: event.sequence,
        completedAtMs: event.atMs,
        status: "error",
        error: typeof data.error === "string" ? data.error : "Tool failed without detail.",
      });
    }
  }
  return [...calls.values()].sort(
    (left, right) =>
      left.startedAtMs - right.startedAtMs || left.startedSequence - right.startedSequence,
  );
}

function teamMessages(events: readonly ObservationEvent[]): ViewerTeamMessage[] {
  return events.flatMap((event) => {
    if (event.kind !== "team.message") return [];
    const data = object(event.data);
    if (
      typeof data?.sequence !== "number" ||
      !isAgentId(data.author) ||
      typeof data.message !== "string"
    ) {
      return [];
    }
    return [
      {
        sequence: data.sequence,
        traceSequence: event.sequence,
        atMs: event.atMs,
        author: data.author,
        message: data.message,
      },
    ];
  });
}

export function normalizeViewerTrace(events: readonly ObservationEvent[]): {
  events: readonly ViewerEvent[];
  toolCalls: readonly ViewerToolCall[];
  teamMessages: readonly ViewerTeamMessage[];
} {
  return {
    events: events.map(viewerEvent),
    toolCalls: pairToolCalls(events),
    teamMessages: teamMessages(events),
  };
}

export async function loadViewerRun(root: string, runRoot: string): Promise<ViewerRun> {
  const resolvedRunRoot = resolve(runRoot);
  const loaded = await loadRunRecord(root, resolvedRunRoot);
  await Promise.all([
    validateRunRecordTrace(resolvedRunRoot, loaded.record.trace),
    verifyTree(loaded.topology.root, loaded.topology.treeSeal, "Frozen Git tree"),
  ]);
  const fixture = await loadFixturePackage(loaded.fixtureRoot);
  if (fixture.contentDigest !== loaded.record.configuration.run.fixture.digest) {
    throw new Error("The viewer fixture digest differs from the recorded run fixture digest.");
  }
  const trace = await readObservationTrace(resolve(resolvedRunRoot, loaded.record.trace.path));
  const durationMs = Math.max(
    0,
    trace.events.at(-1)?.atMs ?? 0,
    Date.parse(loaded.record.frozenAt) - Date.parse(loaded.record.startedAt),
  );
  const finalBatch = loaded.record.evaluations.at(-1);
  const finalScores =
    finalBatch?.results.flatMap((result) =>
      result.score === undefined ? [] : [{ originId: result.originId, ...result.score }],
    ) ?? [];
  const normalizedTrace = normalizeViewerTrace(trace.events);
  return {
    runId: loaded.record.runId,
    status: loaded.record.status,
    startedAt: loaded.record.startedAt,
    frozenAt: loaded.record.frozenAt,
    durationMs,
    communicationMode: loaded.record.topology.communicationMode,
    fixtureId: loaded.record.configuration.run.fixture.id,
    variantId: loaded.record.configuration.run.fixture.variant,
    rekeyAtStage: loaded.record.configuration.run.fixture.rekeyAtStage ?? null,
    agents: loaded.record.configuration.models.map(({ agentId, binding }) => ({
      agentId,
      profile: binding.profile,
      requestedModel: binding.requestedModel,
      ...(binding.actualModel === undefined ? {} : { actualModel: binding.actualModel }),
    })),
    origins: loaded.record.topology.origins.map((origin) => ({
      originId: origin.originId,
      agentIds: origin.agentIds,
      finalCommit: origin.mainCommit,
    })),
    finalScores,
    ciphertext: await readFile(resolve(loaded.fixtureRoot, fixture.publicCiphertextPath), "utf8"),
    ...normalizedTrace,
  };
}
