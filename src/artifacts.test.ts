import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decodeAttemptSummary,
  decodeBuildManifest,
  decodeBuildResult,
  decodeDesignReceipt,
  decodeEvaluationRecord,
  decodeLaunchReservation,
  decodeOverlapResult,
  decodePhaseSummary,
  publishAttemptSummary,
  publishDesignReceipt,
  publishPhaseSummary,
  readDesignReceipt,
  readPhaseSummary,
} from "./artifacts.js";
import { readJsonObject } from "./python.js";
import { testAttemptSummary } from "./test-helpers.js";

const digest = "a".repeat(64);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function treeSeal(digest = "a".repeat(64)): Record<string, unknown> {
  return { schemaVersion: 1, digest, fileCount: 1, byteCount: 1 };
}

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
    schemaVersion: 4,
    pairedBuildId: `paired-${"e".repeat(64)}`,
    blockId: "calibration-odd-women",
    source: { sourceId: "odd-women", sha256: "f".repeat(64) },
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
      evidenceTier: "balanced",
      controlTier: "balanced",
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

const blockIds = [
  "calibration-odd-women",
  "validation-pointed-firs",
  "validation-custom-country",
  "validation-woodlanders",
  "validation-silas-lapham",
] as const;

const calibrationOrder = ["CS", "CR", "IR", "IS"] as const;
const validationOrders = [
  ["CS", "CR", "IR", "IS"],
  ["CR", "IS", "CS", "IR"],
  ["IS", "IR", "CR", "CS"],
  ["IR", "CS", "IS", "CR"],
] as const;

function receiptBuild(blockId: string, index: number): Record<string, unknown> {
  const manifest = structuredClone(buildManifest());
  const variants = manifest.variants as Record<string, Record<string, unknown>>;
  manifest.blockId = blockId;
  manifest.pairedBuildId = `paired-${String(index + 1).repeat(64)}`;
  variants.stationary!.buildId = `build-${String(index + 1).repeat(64)}`;
  variants.rekey!.buildId = `build-${(index + 6).toString(16).repeat(64)}`;
  return {
    blockId,
    buildRoot: `/tmp/palimpsest/study/builds/${blockId}`,
    buildManifestDigest: (index + 10).toString(16).repeat(64),
    treeSeal: treeSeal((index + 1).toString(16).repeat(64)),
    manifest,
  };
}

function designReceipt(): Record<string, unknown> {
  const conditions = ["CS", "CR", "IS", "IR"] as const;
  const agentIds = ["agent-1", "agent-2", "agent-3"] as const;
  const templates = agentIds.flatMap((agentId) => [
    {
      agentId,
      communicationMode: "shared",
      template: `Shared ${agentId} {TOKEN_BUDGET}`,
    },
    {
      agentId,
      communicationMode: "isolated",
      template: `Isolated ${agentId} {TOKEN_BUDGET}`,
    },
  ]);
  const baselinePrompts = conditions.flatMap((condition) =>
    agentIds.map((agentId) => {
      const prompt = `${condition} fixture prompt for ${agentId}`;
      return { condition, agentId, prompt, sha256: sha256(prompt) };
    }),
  );
  return {
    schemaVersion: 3,
    createdAt: "2026-07-28T12:00:00.000Z",
    sourceRevision: "1".repeat(40),
    sandbox: attemptSummary().sandbox,
    manifestDigest: "2".repeat(64),
    immutableManifestDigest: "3".repeat(64),
    designDigest: "4".repeat(64),
    immutableManifest: {
      schemaVersion: 5,
      studyId: "frozen-five-block",
      providers: { openai: { apiKeyEnv: "OPENAI_API_KEY" } },
    },
    builds: blockIds.map(receiptBuild),
    assignment: ["gpt", "claude", "gemini"].map((modelProfileId, index) => ({
      agentId: `agent-${String(index + 1)}`,
      modelProfileId,
    })),
    orders: {
      calibration: calibrationOrder,
      validation: validationOrders,
    },
    rubric: {
      id: "behavior-review-v1",
      path: "experiments/behavior-rubric.md",
      sha256: "5".repeat(64),
    },
    checking: { feedbackId: "published-runnability-coverage-v1" },
    scoring: {
      primaryMetricId: "normalized-positional-word-v1",
      diagnosticMetricId: "palimpsest-diagnostics-v1",
      evaluationPolicyId: "all-canonical-main-snapshots-v1",
    },
    promptTemplates: templates.map((template) => ({
      ...template,
      sha256: sha256(template.template),
    })),
    baselinePrompts,
    failurePolicy: {
      stopOn: "session-infrastructure-error",
      automaticRetry: false,
      replacement: "explicit-appended",
    },
    baselineBudgets: {
      tokenBudgetPerAgent: 200_000,
      perAttemptMonetaryCeilingCents: 5_000,
    },
    totalCeilings: {
      tokens: 12_000_000,
      monetaryAuthorizationCents: 100_000,
    },
  };
}

function plannedCells(phase: "calibration" | "validation"): Record<string, unknown>[] {
  const phaseBlocks = phase === "calibration" ? blockIds.slice(0, 1) : blockIds.slice(1);
  const orders = phase === "calibration" ? [calibrationOrder] : validationOrders;
  return phaseBlocks.flatMap((blockId, blockIndex) =>
    orders[blockIndex]!.map((condition, conditionIndex) => {
      const phasePosition = blockIndex * 4 + conditionIndex + 1;
      const buildIndex = blockIds.indexOf(blockId);
      return {
        cellId: `${phase}-${String(phasePosition).padStart(3, "0")}-${blockId}-${condition}`,
        phase,
        blockId,
        condition,
        conditionOrderPosition: conditionIndex + 1,
        phasePosition,
        buildRoot: `/tmp/palimpsest/study/builds/${blockId}`,
        pairedBuildId: `paired-${String(buildIndex + 1).repeat(64)}`,
        buildId: `build-${String(buildIndex + 1).repeat(64)}`,
      };
    }),
  );
}

function phaseSummary(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    phase: "calibration",
    state: "ready",
    manifestDigest: "2".repeat(64),
    immutableManifestDigest: "3".repeat(64),
    designDigest: "4".repeat(64),
    plannedCells: plannedCells("calibration"),
    adjustments: [],
    reservations: [],
    attempts: [],
    cumulativeAuthorizedTokens: 0,
    cumulativeAuthorizedMonetaryCents: 0,
    cumulativeActualTokens: 0,
    ...overrides,
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
    selection: {
      workspace: "agent-1",
      repositoryId: "shared",
      ref: "refs/heads/main",
      commit: "a".repeat(40),
      command: "sh solve.sh",
      outputPath: "reconstruction.txt",
    },
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
        blockId: "calibration-odd-women",
        buildPath: "/tmp/palimpsest/build",
        agentIds: ["agent-1", "agent-2", "agent-3"],
        stageCount: 6,
        variants: { stationary: `build-${digest}`, rekey: `build-${"b".repeat(64)}` },
      }),
    ).toMatchObject({ agentIds: ["agent-1", "agent-2", "agent-3"], stageCount: 6 });
    expect(decodeBuildManifest(buildManifest()).variants.stationary.stages).toHaveLength(18);
    expect(decodeBuildManifest(buildManifest()).variants.rekey.stages).toHaveLength(18);
    expect(decodeAttemptSummary(attemptSummary()).sessions).toHaveLength(3);
    expect(decodeDesignReceipt(designReceipt()).builds).toHaveLength(5);
    expect(decodePhaseSummary(phaseSummary()).plannedCells).toHaveLength(4);
    expect(decodeOverlapResult(overlapResult()).findings).toHaveLength(1);
    expect(decodeEvaluationRecord(evaluationRecord()).status).toBe("scored");
  });

  it("round-trips the complete strict condition-attempt record", () => {
    const encoded = JSON.parse(JSON.stringify(attemptSummary())) as unknown;
    const decoded = decodeAttemptSummary(encoded);

    expect(decoded).toEqual(encoded);
    expect(decoded).toMatchObject({
      schemaVersion: 5,
      studyPhase: "standalone",
      blockId: "calibration-odd-women",
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

  it("round-trips alternate run controls including disabled token termination", () => {
    const encoded = JSON.parse(
      JSON.stringify(
        testAttemptSummary({
          releaseOffsetsMs: [0, 1_000, 2_500, 4_000, 7_500, 9_000],
          cutoffMs: 12_000,
          tokenBudgetPerAgent: null,
        }),
      ),
    ) as unknown;

    const decoded = decodeAttemptSummary(encoded);

    expect(decoded.releaseOffsetsMs).toEqual([0, 1_000, 2_500, 4_000, 7_500, 9_000]);
    expect(decoded.cutoffMs).toBe(12_000);
    expect(decoded.tokenBudgetPerAgent).toBeNull();
    expect(decoded.protocol).toMatchObject({
      releaseOffsetsMs: [0, 1_000, 2_500, 4_000, 7_500, 9_000],
      cutoffMs: 12_000,
      tokenBudgetPerAgent: null,
    });
  });

  it("accepts strict study provenance and replacement lineage", () => {
    const decoded = decodeAttemptSummary({
      ...attemptSummary(),
      attemptId: "attempt-validation-replacement",
      studyPhase: "validation",
      studyRootId: "study-frozen-five-block",
      conditionOrderPosition: 2,
      designDigest: "4".repeat(64),
      monetaryAuthorizationCeilingCents: 5_000,
      replacementOfAttemptId: "attempt-validation-primary",
    });

    expect(decoded).toMatchObject({
      studyPhase: "validation",
      studyRootId: "study-frozen-five-block",
      conditionOrderPosition: 2,
      monetaryAuthorizationCeilingCents: 5_000,
      replacementOfAttemptId: "attempt-validation-primary",
    });
    expect(decoded).not.toHaveProperty("runName");
    expect(decoded).not.toHaveProperty("repetition");
  });

  it("requires study provenance only for phase attempts", () => {
    expect(() =>
      decodeAttemptSummary({
        ...attemptSummary(),
        studyRootId: "study-frozen-five-block",
      }),
    ).toThrow(/standalone/i);
    expect(() =>
      decodeAttemptSummary({
        ...attemptSummary(),
        studyPhase: "calibration",
      }),
    ).toThrow(/studyRootId/i);
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
        references[0] = { ...references[0], sourceId: "odd-women" };
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
      "unsupported protocol version",
      () => {
        const value = attemptSummary();
        const protocol = value.protocol as Record<string, unknown>;
        return decodeAttemptSummary({
          ...value,
          protocol: { ...protocol, schemaVersion: 1 },
        });
      },
    ],
    [
      "missing protocol team-channel mode",
      () => {
        const value = attemptSummary();
        const protocol = value.protocol as Record<string, unknown>;
        const { teamChannel: _teamChannel, ...withoutTeamChannel } = protocol;
        return decodeAttemptSummary({ ...value, protocol: withoutTeamChannel });
      },
    ],
    [
      "invalid protocol team-channel mode",
      () => {
        const value = attemptSummary();
        const protocol = value.protocol as Record<string, unknown>;
        return decodeAttemptSummary({
          ...value,
          protocol: { ...protocol, teamChannel: "sometimes" },
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
      "infrastructure classification without a matching session",
      () =>
        decodeAttemptSummary({
          ...attemptSummary(),
          infrastructureClassification: "session-infrastructure-error",
        }),
    ],
    [
      "infrastructure session without a matching classification",
      () => {
        const value = attemptSummary();
        const sessions = [...(value.sessions as Record<string, unknown>[])];
        sessions[0] = { ...sessions[0], state: "infrastructure-error" };
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

  it("round-trips the immutable five-build design receipt", () => {
    const encoded = JSON.parse(JSON.stringify(designReceipt())) as unknown;
    expect(decodeDesignReceipt(encoded)).toEqual(encoded);
  });

  it.each([
    [
      "unsupported receipt version",
      () => decodeDesignReceipt({ ...designReceipt(), schemaVersion: 1 }),
    ],
    [
      "unsupported receipt field",
      () => decodeDesignReceipt({ ...designReceipt(), credential: "secret" }),
    ],
    [
      "secret-bearing immutable manifest",
      () => {
        const value = designReceipt();
        return decodeDesignReceipt({
          ...value,
          immutableManifest: {
            ...(value.immutableManifest as object),
            providers: { openai: { apiKey: "sk-secret" } },
          },
        });
      },
    ],
    [
      "reordered build",
      () => {
        const value = designReceipt();
        const builds = [...(value.builds as Record<string, unknown>[])];
        [builds[0], builds[1]] = [builds[1]!, builds[0]!];
        return decodeDesignReceipt({ ...value, builds });
      },
    ],
    [
      "prompt-template digest drift",
      () => {
        const value = designReceipt();
        const templates = [...(value.promptTemplates as Record<string, unknown>[])];
        templates[0] = { ...templates[0], template: "changed" };
        return decodeDesignReceipt({ ...value, promptTemplates: templates });
      },
    ],
    [
      "missing baseline condition-agent pair",
      () => {
        const value = designReceipt();
        const prompts = [...(value.baselinePrompts as Record<string, unknown>[])];
        prompts[1] = prompts[0]!;
        return decodeDesignReceipt({ ...value, baselinePrompts: prompts });
      },
    ],
  ])("rejects a malformed design receipt: %s", (_name, decode) => {
    expect(decode).toThrow();
  });

  it("publishes the design receipt exclusively and never overwrites it", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-design-receipt-"));
    const receipt = designReceipt();
    await publishDesignReceipt(root, receipt);

    await expect(
      publishDesignReceipt(root, { ...receipt, createdAt: "2026-07-29T12:00:00.000Z" }),
    ).rejects.toThrow();
    expect(await readDesignReceipt(root)).toEqual(decodeDesignReceipt(receipt));
  });

  it("publishes an attempt summary once without an overwrite path", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-attempt-summary-"));
    const attempt = decodeAttemptSummary(attemptSummary());
    await publishAttemptSummary(root, attempt);

    await expect(publishAttemptSummary(root, attempt)).rejects.toThrow();
  });

  it("strictly decodes primary and replacement launch reservations", () => {
    const primary = {
      reservationId: "reservation-calibration-001",
      cellId: "calibration-001-calibration-odd-women-CS",
      reservedAt: "2026-07-28T12:01:00.000Z",
      kind: "primary",
      authorizedTokens: 600_000,
      monetaryAuthorizationCeilingCents: 5_000,
      state: "reserved",
    };
    expect(decodeLaunchReservation(primary)).toEqual(primary);
    expect(
      decodeLaunchReservation({
        ...primary,
        reservationId: "reservation-calibration-001-replacement",
        kind: "replacement",
        replacementOfAttemptId: "attempt-calibration-001",
        state: "resolved",
        attemptId: "attempt-calibration-001-replacement",
      }),
    ).toMatchObject({ kind: "replacement", state: "resolved" });
    expect(() => decodeLaunchReservation({ ...primary, kind: "replacement" })).toThrow(/lineage/i);
    expect(() => decodeLaunchReservation({ ...primary, state: "resolved" })).toThrow(/attemptId/i);
  });

  it("round-trips ready and reserved phase summaries with exact accounting", () => {
    expect(decodePhaseSummary(phaseSummary())).toEqual(phaseSummary());
    const reservation = {
      reservationId: "reservation-calibration-001",
      cellId: plannedCells("calibration")[0]!.cellId as string,
      reservedAt: "2026-07-28T12:01:00.000Z",
      kind: "primary",
      authorizedTokens: 600_000,
      monetaryAuthorizationCeilingCents: 5_000,
      state: "reserved",
    };
    const running = phaseSummary({
      state: "running",
      reservations: [reservation],
      cumulativeAuthorizedTokens: 600_000,
      cumulativeAuthorizedMonetaryCents: 5_000,
    });

    expect(decodePhaseSummary(running)).toEqual(running);
  });

  it("accepts only the two validation adjustment records", () => {
    const currentManifestDigest = "6".repeat(64);
    const validation = phaseSummary({
      phase: "validation",
      manifestDigest: currentManifestDigest,
      plannedCells: plannedCells("validation"),
      adjustments: [
        {
          fieldPath: "budgets.tokenBudgetPerAgent",
          priorValue: 200_000,
          resolvedValue: 150_000,
          priorManifestDigest: "2".repeat(64),
          currentManifestDigest,
        },
        {
          fieldPath: "budgets.perAttemptMonetaryCeilingCents",
          priorValue: 5_000,
          resolvedValue: 4_000,
          priorManifestDigest: "2".repeat(64),
          currentManifestDigest,
        },
      ],
    });

    expect(decodePhaseSummary(validation).plannedCells).toHaveLength(16);
  });

  it("round-trips a blocked frozen session-infrastructure attempt", () => {
    const cellId = plannedCells("calibration")[0]!.cellId as string;
    const blocked = phaseSummary({
      state: "blocked",
      reservations: [
        {
          reservationId: "reservation-source",
          cellId,
          reservedAt: "2026-07-28T12:01:00.000Z",
          kind: "primary",
          authorizedTokens: 600_000,
          monetaryAuthorizationCeilingCents: 5_000,
          state: "resolved",
          attemptId: "attempt-source",
        },
      ],
      attempts: [
        {
          attemptId: "attempt-source",
          attemptRoot: "/tmp/palimpsest/study/calibration/attempts/source",
          cellId,
          reservationId: "reservation-source",
          infrastructureClassification: "session-infrastructure-error",
          actualTokenUsage: 12,
        },
      ],
      cumulativeAuthorizedTokens: 600_000,
      cumulativeAuthorizedMonetaryCents: 5_000,
      cumulativeActualTokens: 12,
      failure: {
        kind: "session-infrastructure-error",
        reservationId: "reservation-source",
        attemptId: "attempt-source",
        detail: "provider session failed",
      },
    });

    expect(decodePhaseSummary(blocked).failure).toMatchObject({
      kind: "session-infrastructure-error",
      attemptId: "attempt-source",
    });
  });

  it("accepts one eligible failure followed by one inherited replacement", () => {
    const cellId = plannedCells("calibration")[0]!.cellId as string;
    const sourceReservation = {
      reservationId: "reservation-source",
      cellId,
      reservedAt: "2026-07-28T12:01:00.000Z",
      kind: "primary",
      authorizedTokens: 600_000,
      monetaryAuthorizationCeilingCents: 5_000,
      state: "resolved",
      attemptId: "attempt-source",
    };
    const replacementReservation = {
      reservationId: "reservation-replacement",
      cellId,
      reservedAt: "2026-07-28T13:01:00.000Z",
      kind: "replacement",
      replacementOfAttemptId: "attempt-source",
      authorizedTokens: 600_000,
      monetaryAuthorizationCeilingCents: 5_000,
      state: "resolved",
      attemptId: "attempt-replacement",
    };
    const source = {
      attemptId: "attempt-source",
      attemptRoot: "/tmp/palimpsest/study/calibration/attempts/source",
      cellId,
      reservationId: "reservation-source",
      infrastructureClassification: "session-infrastructure-error",
      actualTokenUsage: 12,
    };
    const replacement = {
      attemptId: "attempt-replacement",
      attemptRoot: "/tmp/palimpsest/study/calibration/attempts/replacement",
      cellId,
      reservationId: "reservation-replacement",
      infrastructureClassification: "none",
      actualTokenUsage: 18,
      replacementOfAttemptId: "attempt-source",
    };
    const decoded = decodePhaseSummary(
      phaseSummary({
        state: "running",
        reservations: [sourceReservation, replacementReservation],
        attempts: [source, replacement],
        cumulativeAuthorizedTokens: 1_200_000,
        cumulativeAuthorizedMonetaryCents: 10_000,
        cumulativeActualTokens: 30,
      }),
    );

    expect(decoded.attempts[1]).toMatchObject({
      attemptId: "attempt-replacement",
      replacementOfAttemptId: "attempt-source",
    });
  });

  it.each([
    ["unknown phase field", () => decodePhaseSummary({ ...phaseSummary(), currentCell: 1 })],
    [
      "duplicate primary reservation",
      () => {
        const cellId = plannedCells("calibration")[0]!.cellId as string;
        const reservation = {
          reservationId: "reservation-one",
          cellId,
          reservedAt: "2026-07-28T12:01:00.000Z",
          kind: "primary",
          authorizedTokens: 600_000,
          monetaryAuthorizationCeilingCents: 5_000,
          state: "reserved",
        };
        return decodePhaseSummary(
          phaseSummary({
            state: "running",
            reservations: [
              { ...reservation, state: "resolved", attemptId: "attempt-one" },
              { ...reservation, reservationId: "reservation-two" },
            ],
            attempts: [
              {
                attemptId: "attempt-one",
                attemptRoot: "/tmp/palimpsest/attempt-one",
                cellId,
                reservationId: "reservation-one",
                infrastructureClassification: "none",
                actualTokenUsage: 1,
              },
            ],
            cumulativeAuthorizedTokens: 1_200_000,
            cumulativeAuthorizedMonetaryCents: 10_000,
            cumulativeActualTokens: 1,
          }),
        );
      },
    ],
    [
      "accounting drift",
      () => decodePhaseSummary(phaseSummary({ cumulativeAuthorizedMonetaryCents: 1 })),
    ],
    [
      "replacement of a model outcome",
      () => {
        const cellId = plannedCells("calibration")[0]!.cellId as string;
        return decodePhaseSummary(
          phaseSummary({
            state: "running",
            reservations: [
              {
                reservationId: "reservation-source",
                cellId,
                reservedAt: "2026-07-28T12:01:00.000Z",
                kind: "primary",
                authorizedTokens: 1,
                monetaryAuthorizationCeilingCents: 0,
                state: "resolved",
                attemptId: "attempt-source",
              },
              {
                reservationId: "reservation-replacement",
                cellId,
                reservedAt: "2026-07-28T12:02:00.000Z",
                kind: "replacement",
                replacementOfAttemptId: "attempt-source",
                authorizedTokens: 1,
                monetaryAuthorizationCeilingCents: 0,
                state: "resolved",
                attemptId: "attempt-replacement",
              },
            ],
            attempts: [
              {
                attemptId: "attempt-source",
                attemptRoot: "/tmp/palimpsest/source",
                cellId,
                reservationId: "reservation-source",
                infrastructureClassification: "none",
                actualTokenUsage: 0,
              },
              {
                attemptId: "attempt-replacement",
                attemptRoot: "/tmp/palimpsest/replacement",
                cellId,
                reservationId: "reservation-replacement",
                infrastructureClassification: "none",
                actualTokenUsage: 0,
                replacementOfAttemptId: "attempt-source",
              },
            ],
            cumulativeAuthorizedTokens: 2,
          }),
        );
      },
    ],
    [
      "reserved replacement with an absent source",
      () => {
        const cellId = plannedCells("calibration")[0]!.cellId as string;
        return decodePhaseSummary(
          phaseSummary({
            state: "running",
            reservations: [
              {
                reservationId: "reservation-replacement",
                cellId,
                reservedAt: "2026-07-28T12:02:00.000Z",
                kind: "replacement",
                replacementOfAttemptId: "attempt-absent",
                authorizedTokens: 1,
                monetaryAuthorizationCeilingCents: 0,
                state: "reserved",
              },
            ],
            cumulativeAuthorizedTokens: 1,
          }),
        );
      },
    ],
  ])("rejects malformed phase lineage or state: %s", (_name, decode) => {
    expect(decode).toThrow();
  });

  it("atomically replaces the complete phase summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-phase-summary-"));
    const initial = phaseSummary();
    await publishPhaseSummary(root, initial);
    const next = phaseSummary({
      state: "running",
      reservations: [
        {
          reservationId: "reservation-calibration-001",
          cellId: plannedCells("calibration")[0]!.cellId,
          reservedAt: "2026-07-28T12:01:00.000Z",
          kind: "primary",
          authorizedTokens: 600_000,
          monetaryAuthorizationCeilingCents: 5_000,
          state: "reserved",
        },
      ],
      cumulativeAuthorizedTokens: 600_000,
      cumulativeAuthorizedMonetaryCents: 5_000,
    });
    await publishPhaseSummary(root, next);

    expect(await readPhaseSummary(root, "calibration")).toEqual(decodePhaseSummary(next));
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

  it.each([
    "puzzle-build.json",
    "attempt.json",
    "design.json",
    "phase.json",
    "overlap.json",
    "result.json",
  ])("rejects invalid JSON in %s before any decoder can return a partial object", async (name) => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-artifact-json-"));
    const path = join(root, name);
    await writeFile(path, '{"attemptId":', "utf8");

    await expect(readJsonObject(path)).rejects.toThrow(/not valid JSON/i);
  });
});
