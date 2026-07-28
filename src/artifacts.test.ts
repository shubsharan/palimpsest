import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decodeAttemptSummary,
  decodeBuildManifest,
  decodeBuildResult,
  decodeEvaluationRecord,
  decodeExperimentSummary,
  decodeOverlapResult,
  publishExperimentSummary,
} from "./artifacts.js";
import { readJsonObject } from "./python.js";
import { testAttemptSummary, testBuildManifest, testExperimentSummary } from "./test-helpers.js";

const digest = "a".repeat(64);

const buildManifest = testBuildManifest;
const attemptSummary = testAttemptSummary;

function overlapResult(): Record<string, unknown> {
  return {
    findings: [
      {
        committedPath: "notes/finding.txt",
        committedBlobId: "b".repeat(40),
        sourceKind: "plaintext",
        sourceId: "complete",
        matchKind: "normalized",
        wordCount: 32,
        sha256: digest,
      },
    ],
    scan: {
      reachableObjectCount: 3,
      reachableBlobReferenceCount: 2,
      uniqueReachableBlobCount: 1,
      uniqueTextBlobCount: 1,
      repeatedTreeReferenceCount: 1,
      skippedNonTextBlobCount: 0,
    },
  };
}

function evaluationRecord(): Record<string, unknown> {
  return {
    status: "scored",
    selection: { command: "sh solve.sh", outputPath: "reconstruction.txt" },
    execution: {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      outputExceeded: false,
    },
    outputPath: "/tmp/palimpsest/evaluation/workspace/reconstruction.txt",
    score: { matchedWords: 8, totalWords: 10, coverage: 0.8, accuracy: 0.8 },
  };
}

describe("stored artifact decoders", () => {
  it("accepts complete current-version records", () => {
    expect(
      decodeBuildResult({
        buildId: `build-${digest}`,
        buildPath: "/tmp/palimpsest/build",
        agentIds: ["agent-1", "agent-2", "agent-3"],
        stageCount: 6,
      }),
    ).toMatchObject({ agentIds: ["agent-1", "agent-2", "agent-3"], stageCount: 6 });
    expect(decodeBuildManifest(buildManifest()).stages).toHaveLength(18);
    expect(decodeAttemptSummary(attemptSummary()).sessions).toHaveLength(3);
    expect(decodeExperimentSummary(testExperimentSummary()).attempts).toHaveLength(1);
    expect(decodeOverlapResult(overlapResult()).findings).toHaveLength(1);
    expect(decodeEvaluationRecord(evaluationRecord()).status).toBe("scored");
  });

  it("accepts dynamic build and attempt geometry", () => {
    expect(
      decodeBuildManifest(buildManifest({ agentCount: 2, stageCount: 3, rekeyStages: [] })),
    ).toMatchObject({
      agentIds: ["agent-1", "agent-2"],
      stageCount: 3,
      rekeys: [],
    });
    expect(
      decodeBuildManifest(buildManifest({ agentCount: 5, stageCount: 7, rekeyStages: [3, 6] })),
    ).toMatchObject({
      agentIds: ["agent-1", "agent-2", "agent-3", "agent-4", "agent-5"],
      stageCount: 7,
      rekeys: [
        { atStage: 3, keyVersion: 1 },
        { atStage: 6, keyVersion: 2 },
      ],
    });
    expect(
      decodeAttemptSummary(
        attemptSummary({
          agentIds: ["agent-1", "agent-2", "agent-3", "agent-4", "agent-5"],
        }),
      ).agentIds,
    ).toEqual(["agent-1", "agent-2", "agent-3", "agent-4", "agent-5"]);
  });

  it.each([
    ["non-object root", () => decodeBuildManifest([])],
    [
      "unsupported build version",
      () => decodeBuildManifest({ ...buildManifest(), schemaVersion: 1 }),
    ],
    [
      "target duplicated as reference",
      () => {
        const value = buildManifest();
        const references = [...(value.references as Record<string, unknown>[])];
        references[0] = { ...references[0], sourceId: "middlemarch" };
        return decodeBuildManifest({ ...value, references });
      },
    ],
    [
      "unordered rekeys",
      () => {
        const value = buildManifest({ stageCount: 6, rekeyStages: [3, 5] });
        const rekeys = [...(value.rekeys as Record<string, unknown>[])].reverse();
        return decodeBuildManifest({ ...value, rekeys });
      },
    ],
    [
      "wrong build field type",
      () => decodeBuildManifest({ ...buildManifest(), stageIntervalMs: "20" }),
    ],
    [
      "unsafe build path",
      () => decodeBuildManifest({ ...buildManifest(), publicCiphertextPath: "../oracle.txt" }),
    ],
    [
      "impossible stage ordinal",
      () => {
        const value = buildManifest();
        const stages = [...(value.stages as Record<string, unknown>[])];
        stages[1] = { ...stages[1], ordinal: 3 };
        return decodeBuildManifest({ ...value, stages });
      },
    ],
    [
      "impossible stage offset",
      () => {
        const value = buildManifest();
        const stages = [...(value.stages as Record<string, unknown>[])];
        stages[1] = { ...stages[1], releaseOffsetMs: 999 };
        return decodeBuildManifest({ ...value, stages });
      },
    ],
    [
      "invalid stage key version",
      () => {
        const value = buildManifest();
        const stages = [...(value.stages as Record<string, unknown>[])];
        stages[0] = { ...stages[0], keyVersion: 1 };
        return decodeBuildManifest({ ...value, stages });
      },
    ],
    [
      "malformed stage digest",
      () => {
        const value = buildManifest();
        const stages = [...(value.stages as Record<string, unknown>[])];
        stages[0] = { ...stages[0], sha256: "ABC" };
        return decodeBuildManifest({ ...value, stages });
      },
    ],
  ])("rejects a malformed build: %s", (_name, decode) => {
    expect(decode).toThrow();
  });

  it.each([
    [
      "unsupported attempt version",
      () => decodeAttemptSummary({ ...attemptSummary(), schemaVersion: 1 }),
    ],
    [
      "relative build root",
      () => decodeAttemptSummary({ ...attemptSummary(), buildRoot: "build" }),
    ],
    [
      "noncanonical dynamic agent IDs",
      () =>
        decodeAttemptSummary({
          ...attemptSummary(),
          agentIds: ["agent-1", "agent-3", "agent-2"],
        }),
    ],
    [
      "missing model binding",
      () => {
        const value = attemptSummary();
        const sessions = [...(value.sessions as Record<string, unknown>[])];
        const { model: _model, ...withoutModel } = sessions[0]!;
        sessions[0] = withoutModel;
        return decodeAttemptSummary({ ...value, sessions });
      },
    ],
    [
      "unsupported model driver",
      () => {
        const value = attemptSummary();
        const sessions = [...(value.sessions as Record<string, unknown>[])];
        sessions[0] = {
          ...sessions[0],
          model: {
            ...(sessions[0]!.model as Record<string, unknown>),
            driver: "gateway",
          },
        };
        return decodeAttemptSummary({ ...value, sessions });
      },
    ],
    [
      "unsupported session enum",
      () => {
        const value = attemptSummary();
        const sessions = [...(value.sessions as Record<string, unknown>[])];
        sessions[0] = { ...sessions[0], state: "cancelled" };
        return decodeAttemptSummary({ ...value, sessions });
      },
    ],
    [
      "duplicate session agent",
      () => {
        const value = attemptSummary();
        const sessions = [...(value.sessions as Record<string, unknown>[])];
        sessions[2] = { ...sessions[2], agentId: "agent-2" };
        return decodeAttemptSummary({ ...value, sessions });
      },
    ],
    [
      "negative token counter",
      () => {
        const value = attemptSummary();
        const sessions = [...(value.sessions as Record<string, unknown>[])];
        sessions[0] = { ...sessions[0], inputTokens: -1 };
        return decodeAttemptSummary({ ...value, sessions });
      },
    ],
    [
      "mutable-looking image identity",
      () => {
        const value = attemptSummary();
        return decodeAttemptSummary({
          ...value,
          sandbox: { ...(value.sandbox as object), imageId: "latest" },
        });
      },
    ],
    [
      "unsupported sandbox version",
      () => {
        const value = attemptSummary();
        return decodeAttemptSummary({
          ...value,
          sandbox: { ...(value.sandbox as object), profileVersion: 2 },
        });
      },
    ],
    [
      "sandbox policy drift",
      () => {
        const value = attemptSummary();
        return decodeAttemptSummary({
          ...value,
          sandbox: { ...(value.sandbox as object), network: "bridge" },
        });
      },
    ],
  ])("rejects a malformed attempt: %s", (_name, decode) => {
    expect(decode).toThrow();
  });

  it.each([
    [
      "unsupported summary version",
      () => decodeExperimentSummary({ ...testExperimentSummary(), schemaVersion: 2 }),
    ],
    [
      "relative build root",
      () => decodeExperimentSummary({ ...testExperimentSummary(), buildRoot: "build" }),
    ],
    [
      "non-object resolved config",
      () => decodeExperimentSummary({ ...testExperimentSummary(), resolvedConfig: [] }),
    ],
    [
      "zero repetition",
      () => {
        const value = testExperimentSummary();
        const attempts = [...(value.attempts as Record<string, unknown>[])];
        attempts[0] = { ...attempts[0], repetition: 0 };
        return decodeExperimentSummary({ ...value, attempts });
      },
    ],
    [
      "duplicate completed attempt",
      () => {
        const value = testExperimentSummary();
        const attempt = (value.attempts as Record<string, unknown>[])[0]!;
        return decodeExperimentSummary({ ...value, attempts: [attempt, attempt] });
      },
    ],
  ])("rejects a malformed experiment summary: %s", (_name, decode) => {
    expect(decode).toThrow();
  });

  it("atomically replaces the complete experiment summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-experiment-summary-"));
    const initial = testExperimentSummary();
    await publishExperimentSummary(root, initial);
    const next = {
      ...initial,
      attempts: [
        ...(initial.attempts as Record<string, unknown>[]),
        {
          runName: "mixed",
          repetition: 1,
          attemptId: "attempt-mixed-1",
          attemptRoot: "/tmp/palimpsest/attempts/mixed/001",
        },
      ],
    };

    await publishExperimentSummary(root, next);

    expect(JSON.parse(await readFile(join(root, "experiment.json"), "utf8"))).toEqual(
      decodeExperimentSummary(next),
    );
  });

  it.each([
    [
      "unsafe committed path",
      () => {
        const value = overlapResult();
        const findings = [...(value.findings as Record<string, unknown>[])];
        findings[0] = { ...findings[0], committedPath: "../secret.txt" };
        return decodeOverlapResult({ ...value, findings });
      },
    ],
    [
      "invalid committed blob id",
      () => {
        const value = overlapResult();
        const findings = [...(value.findings as Record<string, unknown>[])];
        findings[0] = { ...findings[0], committedBlobId: "not-an-object-id" };
        return decodeOverlapResult({ ...value, findings });
      },
    ],
    [
      "invalid finding enum",
      () => {
        const value = overlapResult();
        const findings = [...(value.findings as Record<string, unknown>[])];
        findings[0] = { ...findings[0], matchKind: "fuzzy" };
        return decodeOverlapResult({ ...value, findings });
      },
    ],
    [
      "negative scan counter",
      () => {
        const value = overlapResult();
        return decodeOverlapResult({
          ...value,
          scan: { ...(value.scan as object), skippedNonTextBlobCount: -1 },
        });
      },
    ],
    [
      "missing scan counter",
      () => {
        const value = overlapResult();
        const scan = { ...(value.scan as Record<string, unknown>) };
        delete scan.uniqueTextBlobCount;
        return decodeOverlapResult({ ...value, scan });
      },
    ],
  ])("rejects malformed overlap data: %s", (_name, decode) => {
    expect(decode).toThrow();
  });

  it.each([
    ["invalid status enum", () => decodeEvaluationRecord({ status: "complete" })],
    [
      "unsafe selection output path",
      () => {
        const value = evaluationRecord();
        return decodeEvaluationRecord({
          ...value,
          selection: { ...(value.selection as object), outputPath: "../../answer.txt" },
        });
      },
    ],
    [
      "wrong execution flag type",
      () => {
        const value = evaluationRecord();
        return decodeEvaluationRecord({
          ...value,
          execution: { ...(value.execution as object), timedOut: 0 },
        });
      },
    ],
    [
      "impossible score counters",
      () => {
        const value = evaluationRecord();
        return decodeEvaluationRecord({
          ...value,
          score: { ...(value.score as object), matchedWords: 11 },
        });
      },
    ],
    [
      "non-finite score",
      () => {
        const value = evaluationRecord();
        return decodeEvaluationRecord({
          ...value,
          score: { ...(value.score as object), accuracy: Number.NaN },
        });
      },
    ],
    [
      "status-field mismatch",
      () => decodeEvaluationRecord({ ...evaluationRecord(), status: "not-runnable" }),
    ],
    [
      "scored execution exited nonzero",
      () => {
        const value = evaluationRecord();
        return decodeEvaluationRecord({
          ...value,
          execution: { ...(value.execution as object), exitCode: 1 },
        });
      },
    ],
    [
      "scored execution timed out",
      () => {
        const value = evaluationRecord();
        return decodeEvaluationRecord({
          ...value,
          execution: { ...(value.execution as object), timedOut: true },
        });
      },
    ],
    [
      "no-output execution exceeded output",
      () => {
        const value = evaluationRecord();
        return decodeEvaluationRecord({
          ...value,
          status: "no-output",
          score: undefined,
          execution: { ...(value.execution as object), outputExceeded: true },
        });
      },
    ],
    [
      "not-runnable contains selection",
      () =>
        decodeEvaluationRecord({
          status: "not-runnable",
          selection: { command: "true", outputPath: "answer.txt" },
        }),
    ],
    [
      "execution-error contains score",
      () =>
        decodeEvaluationRecord({
          ...evaluationRecord(),
          status: "execution-error",
          error: "scoring failed",
        }),
    ],
  ])("rejects malformed evaluation data: %s", (_name, decode) => {
    expect(decode).toThrow();
  });

  it.each([
    ["not-runnable", { status: "not-runnable" }],
    [
      "no-output",
      {
        ...evaluationRecord(),
        status: "no-output",
        score: undefined,
      },
    ],
    [
      "execution-error after successful execution",
      {
        ...evaluationRecord(),
        status: "execution-error",
        score: undefined,
        error: "output could not be scored",
      },
    ],
  ])("accepts the valid %s field combination", (_name, value) => {
    expect(decodeEvaluationRecord(value).status).toBe(value.status);
  });

  it.each(["puzzle-build.json", "attempt.json", "experiment.json", "overlap.json", "result.json"])(
    "rejects invalid JSON in %s before any decoder can return a partial object",
    async (name) => {
      const root = await mkdtemp(join(tmpdir(), "palimpsest-artifact-json-"));
      const path = join(root, name);
      await writeFile(path, '{"attemptId":', "utf8");

      await expect(readJsonObject(path)).rejects.toThrow(/not valid JSON/i);
    },
  );
});
