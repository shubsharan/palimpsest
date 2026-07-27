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
import { buildPuzzle } from "../../src/build.js";
import { runPythonJson } from "../../src/python.js";
import { runOfflinePuzzle } from "../../src/offline.js";
import golden from "../golden/behavior.json" with { type: "json" };

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
  it("builds, runs three agents, observes Git/checker behavior, freezes, and scores", async () => {
    const parent = await mkdtemp(join(tmpdir(), "palimpsest-offline-cli-"));
    const fixedBuild = await buildPuzzle({
      root: process.cwd(),
      output: join(parent, "fixed-seed-17"),
      ...golden.fixedSeed17Build.inputs,
    });
    expect(fixedBuild).toMatchObject({
      buildId: golden.fixedSeed17Build.buildId,
      ...golden.fixedSeed17Build.geometry,
    });

    const output = join(parent, "result");
    const result = await runOfflinePuzzle({ output, root: process.cwd() });

    expect(Object.keys(result)).toEqual(expect.arrayContaining(golden.minimumCliResults.offline));
    expect(Object.keys(result.build)).toEqual(
      expect.arrayContaining(golden.minimumCliResults.build),
    );
    expect(Object.keys(result.run)).toEqual(expect.arrayContaining(golden.minimumCliResults.run));
    expect(Object.keys(result.evaluation)).toEqual(
      expect.arrayContaining(golden.minimumCliResults.evaluate),
    );
    expect(isAbsolute(result.build.buildPath)).toBe(true);
    expect(isAbsolute(result.run.attemptRoot)).toBe(true);
    expect(result.build.buildId).toBe(golden.offlineFixture.buildId);
    expect(result.run.sessions).toHaveLength(3);
    expect(result.run.sessions.every((session) => session.state !== "infrastructure-error")).toBe(
      true,
    );
    expect(
      Object.fromEntries(
        result.run.sessions.map(({ agentId, inputTokens, outputTokens }) => [
          agentId,
          { inputTokens, outputTokens },
        ]),
      ),
    ).toEqual(golden.offlineFixture.sessionTokenTotals);
    expect(result.evaluation).toMatchObject({
      status: "scored",
      score: golden.offlineFixture.evaluationScore,
    });
    expect(result.run.overlap).toMatchObject(golden.offlineFixture.overlap);

    await access(join(output, "attempt", "trace.jsonl"));
    await access(join(output, "attempt", "trace.meta.json"));
    await access(join(output, "attempt", "overlap.json"));
    await access(join(output, "attempt", "frozen", "shared.git"));

    const buildManifest = await readJson(join(result.build.buildPath, "puzzle-build.json"));
    const attemptSummary = await readJson(join(result.run.attemptRoot, "attempt.json"));
    const overlapArtifact = await readJson(join(result.run.attemptRoot, "overlap.json"));
    const evaluationArtifact = await readJson(
      join(result.run.attemptRoot, "evaluation", "result.json"),
    );
    const decodedBuild = decodeBuildManifest(buildManifest);
    const decodedAttempt = decodeAttemptSummary(attemptSummary);
    const decodedOverlap = decodeOverlapResult(overlapArtifact);
    const decodedEvaluation = decodeEvaluationRecord(evaluationArtifact);
    expect(decodedBuild).toMatchObject({
      buildId: result.build.buildId,
    });
    expect(decodedAttempt).toMatchObject({
      attemptId: result.run.attemptId,
      buildRoot: result.build.buildPath,
    });
    expect(decodedOverlap).toEqual(result.run.overlap);
    expect(decodedEvaluation).toMatchObject({
      status: result.evaluation.status,
    });
    expect(buildManifest).toMatchObject({
      buildId: golden.offlineFixture.buildId,
      stageIntervalMs: golden.offlineFixture.inputs.stageIntervalMs,
    });
    expect(attemptSummary).toMatchObject({
      attemptId: result.run.attemptId,
      sessions: expect.arrayContaining([
        expect.objectContaining({ agentId: "agent-1" }),
        expect.objectContaining({ agentId: "agent-2" }),
        expect.objectContaining({ agentId: "agent-3" }),
      ]),
    });
    expect(overlapArtifact).toMatchObject(golden.offlineFixture.overlap);
    expect(evaluationArtifact).toMatchObject({
      status: "scored",
      score: golden.offlineFixture.evaluationScore,
    });

    expect(buildManifest.oracleRoot).toBeTypeOf("string");
    const checker = await runPythonJson(process.cwd(), "palimpsest.evaluation.checker", [
      "--build",
      result.build.buildPath,
      "--agent",
      "agent-1",
      "--released",
      "1",
      "--candidate",
      join(
        result.build.buildPath,
        buildManifest.oracleRoot as string,
        "checker",
        "agent-1",
        "stage-01.txt",
      ),
    ]);
    expect(checker).toMatchObject(golden.offlineFixture.agent1Stage1Checker);

    const trace = await readFile(join(output, "attempt", "trace.jsonl"), "utf8");
    const events = trace
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as TraceEvent);
    expect(events[0]?.kind).toBe(golden.traceInvariants.firstEvent);

    const releases = events.filter((event) => event.kind === "stage.released");
    expect(releases).toHaveLength(golden.traceInvariants.stageReleaseCount);
    expect(new Set(releases.map((event) => asRecord(event.data).ordinal))).toEqual(
      new Set([1, 2, 3, 4, 5, 6]),
    );
    expect(
      releases.every((event) => {
        const ordinal = asRecord(event.data).ordinal;
        return (
          typeof ordinal === "number" &&
          event.atMs >= (ordinal - 1) * golden.offlineFixture.inputs.stageIntervalMs
        );
      }),
    ).toBe(true);
    expect(trace).toContain('"kind":"tool.started"');
    expect(trace).toContain('"kind":"reviewer.selection"');
    expect(trace).toContain('"kind":"evaluation.scored"');

    if (golden.traceInvariants.sequencesAreContiguous) {
      expect(events.map((event) => event.sequence)).toEqual(
        events.map((_, index) => golden.traceInvariants.sequencesStartAt + index),
      );
    }
    if (golden.traceInvariants.elapsedTimesAreFiniteNonnegativeAndNondecreasing) {
      expect(
        events.every(
          (event, index) =>
            Number.isFinite(event.atMs) &&
            event.atMs >= 0 &&
            (index === 0 || event.atMs >= events[index - 1]!.atMs),
        ),
      ).toBe(true);
    }

    for (const [before, after] of golden.traceInvariants.requiredOrder) {
      if (before === undefined || after === undefined) {
        throw new Error("Golden trace order entries must contain two event kinds.");
      }
      if (before === "agent-first-evidence" && after === "agent-first-model-request") {
        for (const agentId of ["agent-1", "agent-2", "agent-3"]) {
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
      } else {
        expect(sequenceOf(events, before)).toBeLessThan(sequenceOf(events, after));
      }
    }

    const initialRule = events.find((event) => JSON.stringify(event).includes("mapping=v1"));
    const revisedRule = events.find((event) => JSON.stringify(event).includes("mapping=v2"));
    const transitionEvidenceSequence = Math.max(
      ...releases
        .filter((event) => asRecord(event.data).ordinal === 4)
        .map((event) => event.sequence),
    );
    if (golden.traceInvariants.fixtureInitialRulePrecedesStageFour) {
      expect(initialRule?.sequence).toBeLessThan(transitionEvidenceSequence);
    }
    if (golden.traceInvariants.fixtureRevisedRuleFollowsStageFour) {
      expect(revisedRule?.sequence).toBeGreaterThan(transitionEvidenceSequence);
    }
  }, 30_000);
});
