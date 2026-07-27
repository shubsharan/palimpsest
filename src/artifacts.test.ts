import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decodeAttemptSummary,
  decodeBuildManifest,
  decodeBuildResult,
  decodeEvaluationRecord,
  decodeOverlapResult,
} from "./artifacts.js";
import { readJsonObject } from "./python.js";

const digest = "a".repeat(64);
const imageId = `sha256:${"b".repeat(64)}`;

function buildManifest(): Record<string, unknown> {
  const transitionStage = 4;
  const stageIntervalMs = 20;
  return {
    schemaVersion: 1,
    buildId: `build-${digest}`,
    agentCount: 3,
    stageCount: 6,
    transitionStage,
    stageIntervalMs,
    changedSymbols: ["A", "B"],
    publicCiphertextPath: "evaluation/ciphertext.txt",
    referenceCorpusPath: "public/reference.txt",
    privateStageRoots: {
      "agent-1": "private/agent-1/stages",
      "agent-2": "private/agent-2/stages",
      "agent-3": "private/agent-3/stages",
    },
    oracleRoot: "oracle",
    stages: ["agent-1", "agent-2", "agent-3"].flatMap((agentId) =>
      Array.from({ length: 6 }, (_, index) => {
        const ordinal = index + 1;
        return {
          agentId,
          ordinal,
          releaseOffsetMs: index * stageIntervalMs,
          sourcePath: `private/${agentId}/stages/stage-${String(ordinal).padStart(2, "0")}.txt`,
          tokenCount: 10,
          sha256: digest,
          regime: ordinal < transitionStage ? "base" : "revised",
        };
      }),
    ),
  };
}

function attemptSummary(): Record<string, unknown> {
  return {
    attemptId: "attempt-fixture",
    buildRoot: "/tmp/palimpsest/build",
    tracePath: "/tmp/palimpsest/attempt/trace.jsonl",
    traceMetadataPath: "/tmp/palimpsest/attempt/trace.meta.json",
    frozenRoot: "/tmp/palimpsest/attempt/frozen",
    sandbox: {
      imageTag: "palimpsest-puzzle-sandbox:0.1.0",
      imageId,
      sourceDigest: digest,
      profileVersion: 1,
      network: "none",
      cpus: 2,
      memoryBytes: 2_147_483_648,
      pids: 256,
      tmpfsBytes: 268_435_456,
      maxOutputBytes: 4_194_304,
    },
    sessions: ["agent-1", "agent-2", "agent-3"].map((agentId) => ({
      agentId,
      state: "finished",
      inputTokens: 1,
      outputTokens: 1,
      activityCursor: 0,
      terminationReason: "finished",
      finalResponse: "done",
    })),
  };
}

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
        agentCount: 3,
        stageCount: 6,
        transitionStage: 4,
      }),
    ).toMatchObject({ agentCount: 3, stageCount: 6 });
    expect(decodeBuildManifest(buildManifest()).stages).toHaveLength(18);
    expect(decodeAttemptSummary(attemptSummary()).sessions).toHaveLength(3);
    expect(decodeOverlapResult(overlapResult()).findings).toHaveLength(1);
    expect(decodeEvaluationRecord(evaluationRecord()).status).toBe("scored");
  });

  it.each([
    ["non-object root", () => decodeBuildManifest([])],
    [
      "unsupported build version",
      () => decodeBuildManifest({ ...buildManifest(), schemaVersion: 2 }),
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
      "invalid stage regime",
      () => {
        const value = buildManifest();
        const stages = [...(value.stages as Record<string, unknown>[])];
        stages[0] = { ...stages[0], regime: "revised" };
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
      "relative build root",
      () => decodeAttemptSummary({ ...attemptSummary(), buildRoot: "build" }),
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

  it.each(["puzzle-build.json", "attempt.json", "overlap.json", "result.json"])(
    "rejects invalid JSON in %s before any decoder can return a partial object",
    async (name) => {
      const root = await mkdtemp(join(tmpdir(), "palimpsest-artifact-json-"));
      const path = join(root, name);
      await writeFile(path, '{"attemptId":', "utf8");

      await expect(readJsonObject(path)).rejects.toThrow(/not valid JSON/i);
    },
  );
});
