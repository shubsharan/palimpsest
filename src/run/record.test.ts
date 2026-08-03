import { mkdir, mkdtemp, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendRunAnalysis,
  decodeRunRecord,
  freezeRunConfiguration,
  loadRunRecord,
  publishRunRecord,
  type OverlapRunAnalysis,
  type PerformanceRunAnalysis,
  type ProcessReviewRunAnalysis,
  type RunAnalysis,
  type RunRecord,
} from "./record.js";
import { JsonlObservationLog } from "../trace.js";

const AT = "2026-07-31T12:00:00.000Z";
const LATER = "2026-07-31T12:01:00.000Z";

function binding() {
  return {
    profile: "fixture",
    provider: "fixture",
    driver: "openai-compatible" as const,
    requestedModel: "fixture",
    settings: {},
    providerOptions: {},
  };
}

function record(): RunRecord {
  const configuration = freezeRunConfiguration({
    manifestPath: "experiments/config.yaml",
    manifestDigest: "a".repeat(64),
    run: {
      id: "run-1",
      fixture: {
        id: "fixture",
        constructionId: `construction-${"c".repeat(64)}`,
        buildId: `build-${"d".repeat(64)}`,
        packagePath: "fixture",
        digest: "b".repeat(64),
        variant: "stationary",
      },
      assignment: { "agent-1": "fixture" },
      capabilities: { git: "isolated", teamRoom: "disabled", checker: true },
      schedule: { releaseOffsetsMs: [0], cutoffMs: 1000 },
      limits: { tokenLimitPerAgent: null, spendCeilingCents: 0 },
      labels: {},
    },
    models: [{ agentId: "agent-1", binding: binding() }],
    validation: {
      manifestPath: "experiments/config.yaml",
      manifestDigest: "a".repeat(64),
      fixture: {
        packagePath: "fixture",
        fixtureId: "fixture",
        contentDigest: "b".repeat(64),
      },
      sandbox: {
        imageTag: "sandbox",
        imageId: `sha256:${"c".repeat(64)}`,
        sourceDigest: "d".repeat(64),
        profileVersion: 1,
      },
      smoke: {
        sourceRunId: "run-1",
        runId: "run-1-validation",
        fixtureId: "fixture",
        variantId: "stationary",
        fixtureDigest: "b".repeat(64),
        agentIds: ["agent-1"],
        stageCount: 1,
      },
      validatedAt: AT,
      spendAuthorized: true,
    },
  });
  return {
    schemaVersion: 1,
    manifestDigest: "a".repeat(64),
    runId: "run-1",
    status: "completed",
    startedAt: AT,
    frozenAt: AT,
    publishedAt: LATER,
    configuration,
    trace: { path: "trace.jsonl", metadataPath: "trace.meta.json" },
    releases: [
      {
        agentId: "agent-1",
        ordinal: 1,
        variantId: "stationary",
        releasedAt: AT,
        visiblePath: "evidence/agent-1/stage-01.txt",
        sha256: "e".repeat(64),
      },
    ],
    sessions: [
      {
        agentId: "agent-1",
        model: binding(),
        state: "finished",
        inputTokens: 0,
        outputTokens: 0,
        activityCursor: 0,
        terminationReason: "final-response",
      },
    ],
    topology: {
      root: "frozen",
      communicationMode: "isolated",
      origins: [
        {
          originId: "agent-1",
          path: "frozen/agent-1.git",
          agentIds: ["agent-1"],
          mainCommit: null,
        },
      ],
      workspaces: [
        {
          agentId: "agent-1",
          path: "frozen/workspaces/agent-1",
          originId: "agent-1",
        },
      ],
      treeSeal: {
        schemaVersion: 1,
        digest: "f".repeat(64),
        fileCount: 0,
        byteCount: 0,
      },
    },
    evaluations: [
      {
        evaluationId: "automatic-1",
        kind: "automatic",
        evaluatedAt: AT,
        results: [
          {
            originId: "agent-1",
            agentIds: ["agent-1"],
            status: "not-runnable",
            error: "main was not published",
          },
        ],
      },
    ],
    analyses: [],
    sessionInfrastructureFailures: [],
  };
}

async function runRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-record-"));
  await JsonlObservationLog.create(join(root, "trace.jsonl"));
  return root;
}

function analysis(): OverlapRunAnalysis {
  return {
    analysisId: "overlap-1",
    kind: "overlap",
    analyzedAt: LATER,
    minimumWords: 32,
    origins: [
      {
        originId: "agent-1",
        scan: {
          reachableObjectCount: 0,
          reachableBlobReferenceCount: 0,
          uniqueReachableBlobCount: 0,
          uniqueTextBlobCount: 0,
          repeatedTreeReferenceCount: 0,
          skippedNonTextBlobCount: 0,
        },
        findings: [],
      },
    ],
  };
}

function performanceAnalysis(): PerformanceRunAnalysis {
  return {
    analysisId: "performance-1",
    kind: "performance",
    analyzedAt: LATER,
    graderVersion: "epistemic-process-v1",
    configurationDigest: "1".repeat(64),
    sourceDigest: "2".repeat(64),
    detailsPath: "grading/performance-1/manifest.json",
    detailsDigest: "3".repeat(64),
    origins: [{ originId: "agent-1", status: "eligible" }],
  };
}

function processReviewAnalysis(
  status: "completed" | "incomplete" = "completed",
): ProcessReviewRunAnalysis {
  return {
    analysisId: `process-review-${status}`,
    kind: "process-review",
    reviewedAt: LATER,
    status,
    performanceAnalysisId: "performance-1",
    rubricVersion: "epistemic-process-v1",
    configurationDigest: "4".repeat(64),
    bundleDigest: "5".repeat(64),
    detailsPath: `grading/process-review-${status}/manifest.json`,
    detailsDigest: "6".repeat(64),
    reviews: [
      { reviewId: "review-1", providerFamily: "provider-a", status: "completed" },
      {
        reviewId: "review-2",
        providerFamily: "provider-b",
        status: status === "completed" ? "completed" : "provider-error",
      },
    ],
  };
}

describe("run records", () => {
  it("freezes checker state while preserving legacy enabled records", () => {
    const enabled = record();
    const { digest: _digest, ...configuration } = enabled.configuration;
    const disabledConfiguration = freezeRunConfiguration({
      ...configuration,
      run: {
        ...configuration.run,
        capabilities: { ...configuration.run.capabilities, checker: false },
      },
    });
    const { checker: _checker, ...legacyCapabilities } = configuration.run.capabilities;
    const legacyConfiguration = freezeRunConfiguration({
      ...configuration,
      run: { ...configuration.run, capabilities: legacyCapabilities },
    });

    expect(disabledConfiguration.digest).not.toBe(enabled.configuration.digest);
    expect(
      decodeRunRecord({ ...enabled, configuration: disabledConfiguration }).configuration.run
        .capabilities.checker,
    ).toBe(false);
    const legacy = decodeRunRecord({ ...enabled, configuration: legacyConfiguration });
    expect(legacy.configuration.run.capabilities.checker).toBeUndefined();
    expect(legacy.configuration.run.capabilities.checker ?? true).toBe(true);
  });

  it("publishes one strict final record and never replaces it", async () => {
    const root = await runRoot();
    const path = await publishRunRecord(root, record());
    expect(decodeRunRecord(JSON.parse(await readFile(path, "utf8")))).toMatchObject({
      schemaVersion: 1,
      runId: "run-1",
      configuration: {
        run: {
          fixture: {
            constructionId: `construction-${"c".repeat(64)}`,
            buildId: `build-${"d".repeat(64)}`,
          },
        },
      },
    });
    await expect(publishRunRecord(root, record())).rejects.toMatchObject({ code: "EEXIST" });
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("validates trace evidence without rewriting the human-readable trace", async () => {
    const root = await runRoot();
    const textPath = join(root, "trace.log");
    const sentinel = "operator-owned trace rendering\n";
    await writeFile(textPath, sentinel, "utf8");

    await publishRunRecord(root, record());

    expect(await readFile(textPath, "utf8")).toBe(sentinel);
  });

  it.each([
    ["missing constructionId", "constructionId", undefined],
    ["malformed constructionId", "constructionId", "construction-invalid"],
    ["missing buildId", "buildId", undefined],
    ["malformed buildId", "buildId", "build-invalid"],
  ] as const)("rejects %s", (_name, field, replacement) => {
    const value = JSON.parse(JSON.stringify(record())) as Record<string, unknown>;
    const configuration = value.configuration as RunRecord["configuration"];
    const fixture = configuration.run.fixture as unknown as Record<string, unknown>;
    if (replacement === undefined) delete fixture[field];
    else fixture[field] = replacement;
    expect(() => decodeRunRecord(value)).toThrow(new RegExp(field, "i"));
  });

  it.each([
    ["root unknown field", (value: Record<string, unknown>) => ({ ...value, surprise: true })],
    [
      "nested unknown field",
      (value: Record<string, unknown>) => ({
        ...value,
        configuration: { ...(value.configuration as object), surprise: true },
      }),
    ],
    [
      "unsafe fixture path",
      (value: Record<string, unknown>) => {
        const configuration = value.configuration as RunRecord["configuration"];
        return {
          ...value,
          configuration: {
            ...configuration,
            run: {
              ...configuration.run,
              fixture: { ...configuration.run.fixture, packagePath: "../fixture" },
            },
          },
        };
      },
    ],
    [
      "legacy smoke without sourceRunId",
      (value: Record<string, unknown>) => {
        const configuration = value.configuration as RunRecord["configuration"];
        const { sourceRunId: _sourceRunId, ...smoke } = configuration.validation.smoke;
        return {
          ...value,
          configuration: {
            ...configuration,
            validation: { ...configuration.validation, smoke },
          },
        };
      },
    ],
    [
      "smoke run ID unrelated to its source run",
      () => {
        const value = record();
        const { digest: _digest, ...configuration } = value.configuration;
        return {
          ...value,
          configuration: freezeRunConfiguration({
            ...configuration,
            validation: {
              ...configuration.validation,
              smoke: { ...configuration.validation.smoke, runId: "unrelated-validation" },
            },
          }),
        };
      },
    ],
    [
      "origin mismatch",
      (value: Record<string, unknown>) => {
        const topology = value.topology as RunRecord["topology"];
        return {
          ...value,
          topology: {
            ...topology,
            origins: [{ ...topology.origins[0], originId: "agent-2" }],
          },
        };
      },
    ],
  ])("rejects %s", (_name, corrupt) => {
    expect(() =>
      decodeRunRecord(corrupt(record() as unknown as Record<string, unknown>)),
    ).toThrow();
  });

  it.each([
    [
      "model profile that contradicts the assignment",
      () => {
        const value = record();
        const { digest: _digest, ...configuration } = value.configuration;
        return {
          ...value,
          configuration: freezeRunConfiguration({
            ...configuration,
            models: [
              {
                agentId: "agent-1" as const,
                binding: { ...binding(), profile: "different-profile" },
              },
            ],
          }),
        };
      },
    ],
    [
      "session request that contradicts the frozen model binding",
      () => {
        const value = record();
        return {
          ...value,
          sessions: [
            {
              ...value.sessions[0]!,
              model: { ...value.sessions[0]!.model, requestedModel: "different-model" },
            },
          ],
        };
      },
    ],
    [
      "smoke geometry that contradicts the release schedule",
      () => {
        const value = record();
        const { digest: _digest, ...configuration } = value.configuration;
        return {
          ...value,
          configuration: freezeRunConfiguration({
            ...configuration,
            validation: {
              ...configuration.validation,
              smoke: { ...configuration.validation.smoke, stageCount: 2 },
            },
          }),
        };
      },
    ],
    [
      "missing spend authorization",
      () => {
        const value = record();
        const { digest: _digest, ...configuration } = value.configuration;
        return {
          ...value,
          configuration: freezeRunConfiguration({
            ...configuration,
            validation: { ...configuration.validation, spendAuthorized: false },
          }),
        };
      },
    ],
    [
      "frozen main commit that contradicts automatic evaluation",
      () => {
        const value = record();
        return {
          ...value,
          topology: {
            ...value.topology,
            origins: [{ ...value.topology.origins[0]!, mainCommit: "1".repeat(40) }],
          },
        };
      },
    ],
  ])("rejects a %s", (_name, corrupt) => {
    expect(() => decodeRunRecord(corrupt())).toThrow();
  });

  it("accepts shared smoke evidence from another manifest run", () => {
    const value = record();
    const { digest: _digest, ...configuration } = value.configuration;
    expect(() =>
      decodeRunRecord({
        ...value,
        configuration: freezeRunConfiguration({
          ...configuration,
          validation: {
            ...configuration.validation,
            smoke: {
              sourceRunId: "run-0",
              runId: "run-0-validation",
              fixtureId: "other-fixture",
              variantId: "rekeyed",
              fixtureDigest: "9".repeat(64),
              agentIds: ["agent-1", "agent-2"],
              stageCount: 6,
            },
          },
        }),
      }),
    ).not.toThrow();
  });

  it("loads a complete record after the repository and run tree move", async () => {
    const outer = await mkdtemp(join(tmpdir(), "palimpsest-relocation-"));
    const original = join(outer, "original");
    const run = join(original, "artifacts", "run-1");
    await Promise.all([
      mkdir(join(original, "fixture"), { recursive: true }),
      mkdir(join(original, "experiments"), { recursive: true }),
      mkdir(join(run, "frozen", "agent-1.git"), { recursive: true }),
      mkdir(join(run, "frozen", "workspaces", "agent-1"), { recursive: true }),
    ]);
    await JsonlObservationLog.create(join(run, "trace.jsonl"));
    await publishRunRecord(run, record());
    const moved = join(outer, "moved");
    await rename(original, moved);

    const loaded = await loadRunRecord(moved, join(moved, "artifacts", "run-1"));
    expect(loaded.fixtureRoot).toBe(await realpath(join(moved, "fixture")));
    expect(loaded.topology.repositories[0]?.path).toBe(
      await realpath(join(moved, "artifacts", "run-1", "frozen", "agent-1.git")),
    );
  });

  it("atomically appends analysis without changing frozen evidence or trace", async () => {
    const root = await runRoot();
    await publishRunRecord(root, record());
    const traceBefore = await readFile(join(root, "trace.jsonl"), "utf8");
    const frozenBefore = record().configuration.digest;

    const updated = await appendRunAnalysis(root, record(), analysis());

    expect(updated.analyses.map(({ analysisId }) => analysisId)).toEqual(["overlap-1"]);
    expect(updated.configuration.digest).toBe(frozenBefore);
    expect(await readFile(join(root, "trace.jsonl"), "utf8")).toBe(traceBefore);
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("decodes legacy overlap, performance, and process-review analyses", () => {
    const legacy = decodeRunRecord({ ...record(), analyses: [analysis()] });
    expect(legacy.schemaVersion).toBe(1);
    expect(legacy.analyses.map(({ kind }) => kind)).toEqual(["overlap"]);

    const graded = decodeRunRecord({
      ...record(),
      analyses: [analysis(), performanceAnalysis(), processReviewAnalysis()],
    });
    expect(graded.analyses.map(({ kind }) => kind)).toEqual([
      "overlap",
      "performance",
      "process-review",
    ]);
  });

  it("atomically appends performance and review analyses", async () => {
    const root = await runRoot();
    const initial = record();
    await publishRunRecord(root, initial);
    const traceBefore = await readFile(join(root, "trace.jsonl"), "utf8");
    const runWithPerformance = await appendRunAnalysis(root, initial, performanceAnalysis());
    const runWithReview = await appendRunAnalysis(
      root,
      runWithPerformance,
      processReviewAnalysis(),
    );

    expect(runWithReview.analyses.map(({ kind }) => kind)).toEqual([
      "performance",
      "process-review",
    ]);
    expect(await readFile(join(root, "trace.jsonl"), "utf8")).toBe(traceBefore);
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("permits explicit incomplete review retries but only one completed review identity", () => {
    const incomplete = processReviewAnalysis("incomplete");
    const retry = {
      ...processReviewAnalysis("incomplete"),
      analysisId: "process-review-retry",
      detailsPath: "grading/process-review-retry/manifest.json",
    } as ProcessReviewRunAnalysis;
    expect(() =>
      decodeRunRecord({
        ...record(),
        analyses: [performanceAnalysis(), incomplete, retry, processReviewAnalysis()],
      }),
    ).not.toThrow();
    expect(() =>
      decodeRunRecord({
        ...record(),
        analyses: [
          performanceAnalysis(),
          processReviewAnalysis(),
          {
            ...processReviewAnalysis(),
            analysisId: "process-review-second-completed",
            detailsPath: "grading/process-review-second-completed/manifest.json",
          },
        ],
      }),
    ).toThrow(/completed process review/i);
  });

  it.each([
    [
      "unsafe detail path",
      { ...performanceAnalysis(), detailsPath: "../manifest.json" },
      /safe relative path/i,
    ],
    [
      "uncontained detail path",
      { ...performanceAnalysis(), detailsPath: "grading/other/manifest.json" },
      /detailsPath/i,
    ],
    ["broken detail digest", { ...performanceAnalysis(), detailsDigest: "invalid" }, /SHA-256/i],
    ["duplicate analysis identity", performanceAnalysis(), /analysisId/i],
  ])("rejects %s without changing the published record", async (_name, item, message) => {
    const root = await runRoot();
    const initial =
      _name === "duplicate analysis identity"
        ? { ...record(), analyses: [performanceAnalysis()] }
        : record();
    await publishRunRecord(root, initial);
    const before = await readFile(join(root, "run.json"), "utf8");

    await expect(appendRunAnalysis(root, initial, item as RunAnalysis)).rejects.toThrow(message);
    expect(await readFile(join(root, "run.json"), "utf8")).toBe(before);
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("leaves the published record unchanged when an append is invalid", async () => {
    const root = await runRoot();
    await publishRunRecord(root, record());
    const before = await readFile(join(root, "run.json"), "utf8");

    await expect(
      appendRunAnalysis(root, record(), { ...analysis(), minimumWords: 7 }),
    ).rejects.toThrow(/at least 8/i);

    expect(await readFile(join(root, "run.json"), "utf8")).toBe(before);
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects malformed trace evidence before publication", async () => {
    const root = await runRoot();
    await writeFile(join(root, "trace.jsonl"), "not-json\n");
    await expect(publishRunRecord(root, record())).rejects.toThrow();
  });
});
