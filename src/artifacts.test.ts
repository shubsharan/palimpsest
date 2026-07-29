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
import { testAttemptSummary, testExperimentSummary } from "./test-helpers.js";

const digest = "a".repeat(64);

const attemptSummary = testAttemptSummary;

function buildStages(variantId: "stationary" | "rekey"): Record<string, unknown>[] {
  return ["agent-1", "agent-2", "agent-3"].flatMap((agentId, agentIndex) =>
    Array.from({ length: 6 }, (_, stageIndex) => {
      const ordinal = stageIndex + 1;
      const digestValue =
        ordinal < 4
          ? agentIndex * 6 + ordinal
          : 100 + (variantId === "stationary" ? 0 : 18) + agentIndex * 6 + ordinal;
      return {
        agentId,
        ordinal,
        keyVersion: variantId === "rekey" && ordinal >= 4 ? 1 : 0,
        sourcePath: `variants/${variantId}/private/${agentId}/stages/stage-${String(ordinal).padStart(2, "0")}.txt`,
        tokenCount: 200,
        sha256: digestValue.toString(16).padStart(64, "0"),
      };
    }),
  );
}

function buildVariant(variantId: "stationary" | "rekey"): Record<string, unknown> {
  return {
    variantId,
    buildId: `build-${variantId === "stationary" ? "c".repeat(64) : "d".repeat(64)}`,
    publicCiphertextPath: `variants/${variantId}/complete/ciphertext.txt`,
    referenceCorpusPath: `variants/${variantId}/references`,
    privateStageRoots: Object.fromEntries(
      ["agent-1", "agent-2", "agent-3"].map((agentId) => [
        agentId,
        `variants/${variantId}/private/${agentId}/stages`,
      ]),
    ),
    stages: buildStages(variantId),
    keyTransitions:
      variantId === "stationary"
        ? []
        : [
            {
              atStage: 4,
              keyVersion: 1,
              keyPath: "oracle/keys/rekey-stage-04.json",
              changedSymbolsSha256: "b".repeat(64),
            },
          ],
  };
}

function buildManifest(): Record<string, unknown> {
  return {
    schemaVersion: 3,
    pairedBuildId: `paired-${"e".repeat(64)}`,
    blockId: "calibration-theron-ware",
    source: { sourceId: "theron-ware", sha256: "f".repeat(64) },
    references: [
      { sourceId: "middlemarch", sha256: "1".repeat(64) },
      { sourceId: "moby-dick", sha256: "2".repeat(64) },
      { sourceId: "jane-eyre", sha256: "3".repeat(64) },
    ],
    seed: 130013,
    window: {
      paragraphStart: 10,
      paragraphEnd: 80,
      wordCount: 18_000,
      sha256: "4".repeat(64),
    },
    agentIds: ["agent-1", "agent-2", "agent-3"],
    stageCount: 6,
    boundaryStage: 4,
    allocation: {
      allocationId: `allocation-${"5".repeat(64)}`,
      tier: "balanced",
      metrics: {
        regionDeviation: 0.05,
        stageDeviation: 0.15,
        soloChangedSetCoverage: 0.6,
        minOwnerShare: 0.61,
        anchorCount: 12,
        sentinelCount: 6,
        specialistCounts: { "agent-1": 3, "agent-2": 3, "agent-3": 3 },
        minOwnerOccurrencesPerRegion: 2,
        minSentinelOccurrencesPerAgentRegion: 2,
        unmatchedControlCount: 0,
        maxControlDistance: 0.2,
      },
      rejectedTiers: [{ tier: "strict", reasons: ["region-deviation", "stage-deviation"] }],
      path: "oracle/allocation.json",
      sha256: "6".repeat(64),
    },
    oracleDesign: {
      path: "oracle/design.json",
      sha256: "7".repeat(64),
      anchorsSha256: "8".repeat(64),
      sentinelsSha256: "9".repeat(64),
      specialistsSha256: digest,
      controlsSha256: "b".repeat(64),
    },
    baseKeyPath: "oracle/keys/base.json",
    manipulationCheck: {
      path: "oracle/manipulation-check.json",
      sha256: "c".repeat(64),
      preBoundaryIdentical: true,
      stationaryOldKeyLoss: 0,
      rekeyOldKeyLoss: 0.2,
      changedTokenMassByAgent: { "agent-1": 0.2, "agent-2": 0.2, "agent-3": 0.2 },
    },
    variants: {
      stationary: buildVariant("stationary"),
      rekey: buildVariant("rekey"),
    },
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
        pairedBuildId: `paired-${digest}`,
        blockId: "calibration-theron-ware",
        buildPath: "/tmp/palimpsest/build",
        agentIds: ["agent-1", "agent-2", "agent-3"],
        stageCount: 6,
        variants: { stationary: `build-${digest}`, rekey: `build-${"b".repeat(64)}` },
      }),
    ).toMatchObject({ agentIds: ["agent-1", "agent-2", "agent-3"], stageCount: 6 });
    expect(decodeBuildManifest(buildManifest()).variants.stationary.stages).toHaveLength(18);
    expect(decodeBuildManifest(buildManifest()).variants.rekey.stages).toHaveLength(18);
    expect(decodeAttemptSummary(attemptSummary()).sessions).toHaveLength(3);
    expect(decodeExperimentSummary(testExperimentSummary()).attempts).toHaveLength(1);
    expect(decodeOverlapResult(overlapResult()).findings).toHaveLength(1);
    expect(decodeEvaluationRecord(evaluationRecord()).status).toBe("scored");
  });

  it("round-trips the complete strict condition-attempt record", () => {
    const encoded = JSON.parse(JSON.stringify(attemptSummary())) as unknown;
    const decoded = decodeAttemptSummary(encoded);

    expect(decoded).toEqual(encoded);
    expect(decoded).toMatchObject({
      schemaVersion: 3,
      blockId: "calibration-theron-ware",
      condition: "CR",
      communicationMode: "shared",
      keyRegime: "rekey",
      variantId: "rekey",
      releaseOffsetsMs: [0, 300_000, 600_000, 1_200_000, 1_800_000, 2_400_000],
      cutoffMs: 3_600_000,
      frozen: {
        communicationMode: "shared",
        repositories: [{ repositoryId: "shared" }],
      },
    });
  });

  it.each([
    ["CS", "shared", "stationary", 1],
    ["CR", "shared", "rekey", 1],
    ["IS", "isolated", "stationary", 3],
    ["IR", "isolated", "rekey", 3],
  ] as const)(
    "accepts the native frozen topology for %s",
    (condition, communicationMode, variantId, repositoryCount) => {
      const attempt = decodeAttemptSummary(attemptSummary({ condition }));

      expect(attempt).toMatchObject({ condition, communicationMode, variantId });
      expect(attempt.frozen.repositories).toHaveLength(repositoryCount);
    },
  );

  it.each([
    ["non-object root", () => decodeBuildManifest([])],
    [
      "unsupported build version",
      () => decodeBuildManifest({ ...buildManifest(), schemaVersion: 2 }),
    ],
    [
      "target duplicated as reference",
      () => {
        const value = buildManifest();
        const references = [...(value.references as Record<string, unknown>[])];
        references[0] = { ...references[0], sourceId: "theron-ware" };
        return decodeBuildManifest({ ...value, references });
      },
    ],
    [
      "release timing field",
      () => decodeBuildManifest({ ...buildManifest(), stageIntervalMs: 20 }),
    ],
    [
      "unsafe oracle path",
      () => decodeBuildManifest({ ...buildManifest(), baseKeyPath: "../base.json" }),
    ],
    [
      "impossible stage ordinal",
      () => {
        const value = buildManifest();
        const variants = value.variants as Record<string, Record<string, unknown>>;
        const rekey = variants.rekey!;
        const stages = [...(rekey.stages as Record<string, unknown>[])];
        stages[1] = { ...stages[1], ordinal: 3 };
        return decodeBuildManifest({
          ...value,
          variants: { ...variants, rekey: { ...rekey, stages } },
        });
      },
    ],
    [
      "invalid stage key version",
      () => {
        const value = buildManifest();
        const variants = value.variants as Record<string, Record<string, unknown>>;
        const stationary = variants.stationary!;
        const stages = [...(stationary.stages as Record<string, unknown>[])];
        stages[9] = { ...stages[9], keyVersion: 1 };
        return decodeBuildManifest({
          ...value,
          variants: { ...variants, stationary: { ...stationary, stages } },
        });
      },
    ],
    [
      "malformed stage digest",
      () => {
        const value = buildManifest();
        const variants = value.variants as Record<string, Record<string, unknown>>;
        const stationary = variants.stationary!;
        const stages = [...(stationary.stages as Record<string, unknown>[])];
        stages[0] = { ...stages[0], sha256: "ABC" };
        return decodeBuildManifest({
          ...value,
          variants: { ...variants, stationary: { ...stationary, stages } },
        });
      },
    ],
    [
      "pre-boundary divergence",
      () => {
        const value = buildManifest();
        const variants = value.variants as Record<string, Record<string, unknown>>;
        const rekey = variants.rekey!;
        const stages = [...(rekey.stages as Record<string, unknown>[])];
        stages[1] = { ...stages[1], sha256: "f".repeat(64) };
        return decodeBuildManifest({
          ...value,
          variants: { ...variants, rekey: { ...rekey, stages } },
        });
      },
    ],
    [
      "insufficient changed mass",
      () => {
        const value = buildManifest();
        const manipulation = value.manipulationCheck as Record<string, unknown>;
        return decodeBuildManifest({
          ...value,
          manipulationCheck: {
            ...manipulation,
            changedTokenMassByAgent: { "agent-1": 0.14, "agent-2": 0.2, "agent-3": 0.2 },
          },
        });
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
      "unsupported attempt field",
      () => decodeAttemptSummary({ ...attemptSummary(), communicationAvailable: true }),
    ],
    [
      "relative build root",
      () => decodeAttemptSummary({ ...attemptSummary(), buildRoot: "build" }),
    ],
    [
      "noncanonical agent IDs",
      () =>
        decodeAttemptSummary({
          ...attemptSummary(),
          agentIds: ["agent-1", "agent-3", "agent-2"],
        }),
    ],
    [
      "non-fixed agent geometry",
      () =>
        decodeAttemptSummary(
          attemptSummary({
            agentIds: ["agent-1", "agent-2", "agent-3", "agent-4", "agent-5"],
          }),
        ),
    ],
    [
      "condition and communication mismatch",
      () => decodeAttemptSummary({ ...attemptSummary(), communicationMode: "isolated" }),
    ],
    [
      "condition and variant mismatch",
      () => decodeAttemptSummary({ ...attemptSummary(), variantId: "stationary" }),
    ],
    [
      "release schedule drift",
      () =>
        decodeAttemptSummary({
          ...attemptSummary(),
          releaseOffsetsMs: [0, 300_000, 600_001, 1_200_000, 1_800_000, 2_400_000],
        }),
    ],
    ["cutoff drift", () => decodeAttemptSummary({ ...attemptSummary(), cutoffMs: 3_600_001 })],
    [
      "shared topology drift",
      () => {
        const value = attemptSummary();
        const frozen = value.frozen as Record<string, unknown>;
        const repositories = [...(frozen.repositories as Record<string, unknown>[])];
        repositories[0] = { ...repositories[0], agentIds: ["agent-1", "agent-2"] };
        return decodeAttemptSummary({
          ...value,
          frozen: { ...frozen, repositories },
        });
      },
    ],
    [
      "isolated topology drift",
      () => {
        const value = attemptSummary({ condition: "IR" });
        const frozen = value.frozen as Record<string, unknown>;
        const workspaces = [...(frozen.workspaces as Record<string, unknown>[])];
        workspaces[1] = { ...workspaces[1], repositoryId: "agent-1" };
        return decodeAttemptSummary({
          ...value,
          frozen: { ...frozen, workspaces },
        });
      },
    ],
    [
      "protocol digest mismatch",
      () => {
        const value = attemptSummary();
        const protocol = value.protocol as Record<string, unknown>;
        const prompts = [...(protocol.prompts as Record<string, unknown>[])];
        prompts[0] = { ...prompts[0], prompt: "changed after declaration" };
        return decodeAttemptSummary({
          ...value,
          protocol: { ...protocol, prompts },
        });
      },
    ],
    [
      "protocol treatment mismatch",
      () => {
        const value = attemptSummary();
        const protocol = value.protocol as Record<string, unknown>;
        return decodeAttemptSummary({
          ...value,
          protocol: { ...protocol, communicationMode: "isolated" },
        });
      },
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
