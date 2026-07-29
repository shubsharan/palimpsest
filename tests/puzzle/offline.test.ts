import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decodeAttemptSummary,
  decodeBuildManifest,
  decodeEvaluationRecord,
  decodeOverlapResult,
} from "../../src/artifacts.js";
import { runOfflinePuzzle } from "../../src/offline.js";
import { runPythonJson } from "../../src/python.js";

interface TraceEvent {
  sequence: number;
  atMs: number;
  kind: string;
  agentId?: string;
  data: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return asRecord(JSON.parse(await readFile(path, "utf8")) as unknown);
}

function sequenceOf(events: readonly TraceEvent[], kind: string): number {
  const event = events.find((candidate) => candidate.kind === kind);
  expect(event, `missing ${kind} trace event`).toBeDefined();
  return event!.sequence;
}

describe("offline behavior-neutral runner", () => {
  it("builds and runs the in-memory fixture puzzle through the current artifact contracts", async () => {
    const parent = await mkdtemp(join(tmpdir(), "palimpsest-offline-cli-"));
    const output = join(parent, "result");
    const result = await runOfflinePuzzle({ output, root: process.cwd() });

    expect(isAbsolute(result.build.buildPath)).toBe(true);
    expect(isAbsolute(result.run.attemptRoot)).toBe(true);
    expect(result.build.agentIds).toEqual(["agent-1", "agent-2", "agent-3"]);
    expect(result.build.stageCount).toBe(6);
    expect(result.run.buildId).toBe(result.build.buildId);
    expect(result.run.runName).toBe("offline");
    expect(result.run.repetition).toBe(1);
    expect(result.run.sessions).toHaveLength(result.build.agentIds.length);
    expect(result.run.sessions.every((session) => session.state !== "infrastructure-error")).toBe(
      true,
    );
    expect(
      result.run.sessions.every(
        (session) =>
          session.model.provider === "fixture" &&
          session.model.requestedModel === "collaborative-revision",
      ),
    ).toBe(true);
    expect(result.evaluation.status).toBe("scored");
    expect(result.run.overlap.findings).toEqual([]);

    await access(join(result.run.attemptRoot, "trace.jsonl"));
    await access(join(result.run.attemptRoot, "trace.meta.json"));
    await access(join(result.run.attemptRoot, "overlap.json"));
    await access(join(result.run.attemptRoot, "frozen", "shared.git"));
    await expect(access(join(result.run.attemptRoot, "preflight.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const buildManifest = decodeBuildManifest(
      await readJson(join(result.build.buildPath, "puzzle-build.json")),
    );
    const attemptSummary = decodeAttemptSummary(
      await readJson(join(result.run.attemptRoot, "attempt.json")),
    );
    const overlapArtifact = decodeOverlapResult(
      await readJson(join(result.run.attemptRoot, "overlap.json")),
    );
    const evaluationArtifact = decodeEvaluationRecord(
      await readJson(join(result.run.attemptRoot, "evaluation", "result.json")),
    );

    expect(buildManifest).toMatchObject({
      schemaVersion: 3,
      blockId: "calibration-theron-ware",
      agentIds: result.build.agentIds,
      stageCount: result.build.stageCount,
      boundaryStage: 4,
      variants: {
        stationary: { variantId: "stationary", keyTransitions: [] },
        rekey: {
          variantId: "rekey",
          buildId: result.build.buildId,
          keyTransitions: [{ atStage: 4, keyVersion: 1 }],
        },
      },
    });
    expect(attemptSummary).toMatchObject({
      schemaVersion: 2,
      attemptId: result.run.attemptId,
      buildId: result.build.buildId,
      agentIds: result.build.agentIds,
    });
    expect(overlapArtifact).toEqual(result.run.overlap);
    expect(evaluationArtifact.status).toBe(result.evaluation.status);

    const checker = await runPythonJson(process.cwd(), "palimpsest.evaluation.checker", [
      "--build",
      result.build.buildPath,
      "--agent",
      "agent-1",
      "--released",
      "1",
      "--candidate",
      join(result.build.buildPath, "oracle", "checker", "agent-1", "stage-01.txt"),
    ]);
    expect(checker).toMatchObject({
      matchedWords: expect.any(Number),
      totalWords: expect.any(Number),
      coverage: 1,
      accuracy: 1,
    });
    expect(asRecord(checker).matchedWords).toBe(asRecord(checker).totalWords);

    const trace = await readFile(join(result.run.attemptRoot, "trace.jsonl"), "utf8");
    const events = trace
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as TraceEvent);
    expect(events[0]?.kind).toBe("attempt.configured");

    const releases = events.filter((event) => event.kind === "stage.released");
    expect(releases).toHaveLength(buildManifest.agentIds.length * buildManifest.stageCount);
    expect(new Set(releases.map((event) => asRecord(event.data).ordinal))).toEqual(
      new Set([1, 2, 3, 4, 5, 6]),
    );
    expect(
      releases.every((event) => {
        const ordinal = asRecord(event.data).ordinal;
        return typeof ordinal === "number" && event.atMs >= (ordinal - 1) * 20;
      }),
    ).toBe(true);

    for (const agentId of buildManifest.agentIds) {
      const firstEvidence = events.find(
        (event) => event.kind === "stage.released" && event.agentId === agentId,
      );
      const firstModelRequest = events.find(
        (event) => event.kind === "session.started" && event.agentId === agentId,
      );
      expect(firstEvidence, `missing first evidence for ${agentId}`).toBeDefined();
      expect(firstModelRequest, `missing first model request for ${agentId}`).toBeDefined();
      expect(firstEvidence!.sequence).toBeLessThan(firstModelRequest!.sequence);
    }
    for (const [before, after] of [
      ["attempt.sessions-ended", "attempt.frozen"],
      ["attempt.frozen", "overlap.observed"],
      ["overlap.observed", "reviewer.selection"],
      ["reviewer.selection", "evaluation.started"],
      ["reviewer.selection", "evaluation.completed"],
      ["reviewer.selection", "evaluation.scored"],
    ] as const) {
      expect(sequenceOf(events, before)).toBeLessThan(sequenceOf(events, after));
    }

    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(
      events.every(
        (event, index) =>
          Number.isFinite(event.atMs) &&
          event.atMs >= 0 &&
          (index === 0 || event.atMs >= events[index - 1]!.atMs),
      ),
    ).toBe(true);
  }, 30_000);
});
