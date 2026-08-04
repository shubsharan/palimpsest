import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { contentDigest } from "../canonical.js";
import type { JsonObject } from "../model/contracts.js";
import {
  decodeRunRecord,
  freezeRunConfiguration,
  type RunAnalysis,
  type RunRecord,
} from "../run/record.js";
import {
  createIsolatedRunFixture,
  createSharedRunFixture,
} from "../../tests/support/grading-fixture.js";
import { decodeReportConfiguration, reportRuns, type ReportConfiguration } from "./report.js";
import { compileEvidence } from "./evidence.js";

const DIGEST = "f".repeat(64);
function observed(measureId: string, value: number): JsonObject {
  return {
    measureId,
    ledger: measureId.startsWith("outcome.") ? "outcome" : "epistemic",
    basis: "mechanical",
    state: "observed",
    value,
    unit: "ratio",
    numerator: value,
    denominator: 1,
    eligibility: { ruleId: "synthetic-report", explanation: "Synthetic report fixture." },
    evidence: [
      {
        source: "run-record",
        recordPointer: "/runId",
        excerptDigest: DIGEST,
        role: "context",
      },
    ],
  };
}

function reviewCoded(
  measureId: string,
  ledger: "epistemic" | "social" | "instrumental",
  value: number,
): JsonObject {
  return {
    ...observed(measureId, value),
    ledger,
    basis: "review-coded",
  };
}

function rated(dimensionId: string, rating: number): JsonObject {
  return { dimensionId, state: "rated", rating };
}

function scorecard(
  runId: string,
  originId: string,
  mechanicalMeasures: readonly JsonObject[],
  codedMeasureValue: number,
): JsonObject {
  return {
    schemaVersion: 1,
    runId,
    canonicalOrigins: [{ originId, status: "eligible" }],
    outcome: { evaluations: [] },
    epistemic: {
      measures: mechanicalMeasures,
      reviewers: [
        { judge: 1, dimensions: [rated("epistemic.revision", 2)] },
        { judge: 2, dimensions: [rated("epistemic.revision", 3)] },
      ],
    },
    social: {
      measures: [reviewCoded("social.uptake-rate.judge-a.v1", "social", codedMeasureValue)],
      reviewers: [
        { judge: 1, dimensions: [] },
        { judge: 2, dimensions: [] },
      ],
    },
    instrumental: {
      measures: [],
      reviewers: [
        { judge: 1, dimensions: [] },
        { judge: 2, dimensions: [] },
      ],
    },
    disagreements: [],
    eligibility: { status: "completed" },
    limitations: [],
  };
}

async function publishAnalyses(options: {
  root?: string;
  runRoot: string;
  record: RunRecord;
  completed?: boolean;
  graderVersion?: string;
  rubricVersion?: string;
  codedMeasureValue?: number;
  scorecardVersion?: 1 | 2;
  scorecardProcessMeasures?: (
    measures: readonly JsonObject[],
    originIndex: number,
  ) => readonly JsonObject[];
}): Promise<void> {
  const performanceId = `performance-${options.record.runId}`;
  const reviewId = `process-review-${options.record.runId}`;
  const originIds = options.record.topology.origins.map(({ originId }) => originId);
  await writeFile(
    join(options.runRoot, "run.json"),
    `${JSON.stringify(options.record, null, 2)}\n`,
  );
  const metrics = {
    schemaVersion: 1,
    kind: "measure",
    measures: originIds.map((originId, index) => ({
      originId,
      values: [
        observed("outcome.accuracy.v1", 0.5 + index / 10),
        observed("epistemic.supported-revision-rate.judge-a.v1", 0.5),
      ],
    })),
  };
  const { bundle } = await compileEvidence({
    root: options.root ?? resolve(options.runRoot, "../.."),
    runRoot: options.runRoot,
  });
  const performanceManifest = {
    schemaVersion: 1,
    kind: "performance",
    analysisId: performanceId,
    graderVersion: options.graderVersion ?? "epistemic-process-v1",
    configurationDigest: options.record.configuration.digest,
    sourceDigest: bundle.sourceDigest,
    evidence: { path: "evidence.json", contentDigest: bundle.contentDigest },
    metrics: { path: "metrics.json", contentDigest: contentDigest(metrics) },
    origins: originIds.map((originId) => ({ originId, status: "eligible" })),
  };
  const performance: RunAnalysis = {
    analysisId: performanceId,
    kind: "performance",
    analyzedAt: "2026-08-02T00:00:00.000Z",
    graderVersion: options.graderVersion ?? "epistemic-process-v1",
    configurationDigest: options.record.configuration.digest,
    sourceDigest: bundle.sourceDigest,
    detailsPath: `grading/${performanceId}/manifest.json`,
    detailsDigest: contentDigest(performanceManifest),
    origins: originIds.map((originId) => ({ originId, status: "eligible" })),
  };
  const completed = options.completed ?? true;
  const scorecards = originIds.map((originId, index) => {
    const base = scorecard(
      options.record.runId,
      originId,
      options.scorecardProcessMeasures?.(
        metrics.measures[index]!.values.filter(({ ledger }) => ledger !== "outcome"),
        index,
      ) ?? metrics.measures[index]!.values.filter(({ ledger }) => ledger !== "outcome"),
      options.codedMeasureValue ?? 0.25 + index / 10,
    );
    if (options.scorecardVersion !== 2) return base;
    const evidence = {
      evaluationUnit: { kind: "shared-team", actorIds: ["actor-1"] },
      opportunities: [
        {
          opportunityId: "opp-0001",
          kind: "revision-opportunity",
          atMs: 1,
          actorIds: ["actor-1"],
          evidence: [],
        },
      ],
      claims: [
        {
          claimId: "claim-001",
          opportunityId: "opp-0001",
          ledger: "epistemic",
          subjectScope: "evaluation-unit",
          actorIds: ["actor-1"],
          predicate: "revision",
          state: "observed",
          qualification: "direct",
          evidence: [],
          counterevidence: [],
          confidence: "high",
          missingReason: "",
        },
      ],
      epistemicEpisodes: [],
      influenceChains: [],
      executionChains: [],
    } as const;
    return {
      ...base,
      schemaVersion: 2,
      dossier: {
        reviewers: [
          { judge: 1, evidence },
          { judge: 2, evidence },
        ],
      },
      failureAccount: { causalAttribution: "prohibited", layers: [] },
      provenance: {
        fixture: {},
        treatments: {},
        experimentalUnit: "team",
        models: [],
        runRecordDigest: contentDigest(options.record),
        performanceAnalysisId: performanceId,
        reviewProtocol: "ledger-packets-v6",
        bundleDigest: DIGEST,
        checkerEnabled: true,
        omissionCount: 0,
        truncationCount: 0,
        confounds: [],
      },
    } as const;
  });
  const scorecardBytes = `${JSON.stringify(scorecards, null, 2)}\n`;
  const processManifest = {
    schemaVersion: 1,
    files: [
      {
        path: "scorecard.json",
        contentDigest: contentDigest(scorecards),
        byteCount: Buffer.byteLength(scorecardBytes),
        role: "run-scorecard",
      },
    ],
  };
  const review: RunAnalysis = {
    analysisId: reviewId,
    kind: "process-review",
    reviewedAt: "2026-08-02T00:10:00.000Z",
    status: completed ? "completed" : "incomplete",
    performanceAnalysisId: performanceId,
    rubricVersion: options.rubricVersion ?? "epistemic-process-v1",
    configurationDigest: DIGEST,
    bundleDigest: DIGEST,
    detailsPath: `grading/${reviewId}/manifest.json`,
    detailsDigest: completed ? contentDigest(processManifest) : DIGEST,
    reviews: [
      {
        reviewId: "judge-a",
        providerFamily: "provider-a",
        status: completed ? "completed" : "provider-error",
      },
      { reviewId: "judge-b", providerFamily: "provider-b", status: "completed" },
    ],
  };
  const updated = decodeRunRecord({ ...options.record, analyses: [performance, review] });
  await writeFile(join(options.runRoot, "run.json"), `${JSON.stringify(updated, null, 2)}\n`);
  const performanceRoot = join(options.runRoot, "grading", performanceId);
  await mkdir(performanceRoot, { recursive: true });
  await Promise.all([
    writeFile(join(performanceRoot, "manifest.json"), `${JSON.stringify(performanceManifest)}\n`),
    writeFile(join(performanceRoot, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`),
  ]);
  if (completed) {
    const detailRoot = join(options.runRoot, "grading", reviewId);
    await mkdir(detailRoot, { recursive: true });
    await Promise.all([
      writeFile(join(detailRoot, "manifest.json"), `${JSON.stringify(processManifest)}\n`),
      writeFile(join(detailRoot, "scorecard.json"), scorecardBytes),
    ]);
  }
}

function withRunInput(
  record: RunRecord,
  mutate: (run: RunRecord["configuration"]["run"]) => RunRecord["configuration"]["run"],
): RunRecord {
  const { digest: _digest, ...configuration } = record.configuration;
  return decodeRunRecord({
    ...record,
    configuration: freezeRunConfiguration({ ...configuration, run: mutate(configuration.run) }),
  });
}

async function writeConfig(root: string, config: ReportConfiguration): Promise<string> {
  const path = join(root, "report.yaml");
  const lines = [
    "schemaVersion: 1",
    `claimType: ${config.claimType}`,
    "include:",
    `  runIds: [${config.include.runIds.join(", ")}]`,
    "  labels: {}",
    "versions:",
    `  grader: ${config.versions.grader}`,
    `  rubric: ${config.versions.rubric}`,
    ...(config.matchingFields.length === 0
      ? []
      : ["matchingFields:", ...config.matchingFields.map((field) => `  - ${field}`)]),
    ...(config.treatmentField === undefined ? [] : [`treatmentField: ${config.treatmentField}`]),
    `experimentalUnit: ${config.experimentalUnit}`,
    "clusterBy: run",
    "",
  ];
  await writeFile(path, lines.join("\n"));
  return path;
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-report-"));
  await symlink(join(process.cwd(), "python"), join(root, "python"), "dir");
  return root;
}

function hasCompositeField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCompositeField);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, item]) => key.toLowerCase().includes("composite") || hasCompositeField(item),
  );
}

describe("report configuration", () => {
  it("strictly decodes descriptive and matched declarations", () => {
    expect(
      decodeReportConfiguration({
        schemaVersion: 1,
        claimType: "descriptive",
        include: { runIds: [], labels: {} },
        versions: {
          grader: "epistemic-process-v1",
          rubric: "epistemic-process-v1",
          reviewProtocol: "ledger-packets-v6",
        },
        experimentalUnit: "team",
        clusterBy: "run",
      }),
    ).toMatchObject({
      matchingFields: [],
      versions: { reviewProtocol: "ledger-packets-v6" },
    });
    expect(() =>
      decodeReportConfiguration({
        schemaVersion: 1,
        claimType: "matched-contrast",
        include: { runIds: [], labels: {} },
        versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
        experimentalUnit: "team",
        clusterBy: "run",
      }),
    ).toThrow(/matchingFields.*treatmentField/i);
    expect(() =>
      decodeReportConfiguration({
        schemaVersion: 1,
        claimType: "descriptive",
        include: { runIds: [], labels: {} },
        versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
        experimentalUnit: "team",
        clusterBy: "run",
        composite: true,
      }),
    ).toThrow(/unknown|fields/i);
    expect(() =>
      decodeReportConfiguration({
        schemaVersion: 1,
        claimType: "matched-contrast",
        include: { runIds: [], labels: {} },
        versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
        matchingFields: ["/configuration/run/fixture/constructionId"],
        treatmentField: "/runId",
        experimentalUnit: "team",
        clusterBy: "run",
      }),
    ).toThrow(/genuine material run input/i);
  });
});

describe("reportRuns", () => {
  it("aggregates v2 dossier mechanisms in descriptive reports without a treatment field", async () => {
    const collection = await tempRoot();
    const fixture = await createSharedRunFixture({ root: collection, runId: "run-v2" });
    await publishAnalyses({ ...fixture, scorecardVersion: 2 });
    const configPath = await writeConfig(collection, {
      schemaVersion: 1,
      claimType: "descriptive",
      include: { runIds: [], labels: {} },
      versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
      matchingFields: [],
      experimentalUnit: "team",
      clusterBy: "run",
    });

    const result = await reportRuns({
      root: collection,
      artifactsRoot: collection,
      configPath,
      output: join(collection, "report-output"),
    });
    expect(result.report.schemaVersion).toBe(2);
    if (result.report.schemaVersion !== 2) throw new Error("Expected behavior report v2.");

    expect(result.report.mechanisms).toEqual([
      expect.objectContaining({
        judge: 1,
        predicate: "revision",
        opportunityKind: "revision-opportunity",
        observedCount: 1,
        claimCount: 1,
        opportunityCount: 1,
        opportunityConditionedRate: 1,
      }),
      expect.objectContaining({
        judge: 2,
        predicate: "revision",
        opportunityKind: "revision-opportunity",
        observedCount: 1,
        claimCount: 1,
        opportunityCount: 1,
        opportunityConditionedRate: 1,
      }),
    ]);
    expect(result.report.mechanisms.every((mechanism) => !("treatment" in mechanism))).toBe(true);
  });

  it("discovers contained runs, excludes incomplete reviews, aggregates, and leaves sources byte-stable", async () => {
    const collection = await tempRoot();
    const first = await createSharedRunFixture({ root: collection, runId: "run-a" });
    const secondFixture = await createSharedRunFixture({
      root: collection,
      runId: "run-b",
    });
    const second = {
      ...secondFixture,
      record: withRunInput(secondFixture.record, (run) => ({
        ...run,
        capabilities: { ...run.capabilities, checker: false },
      })),
    };
    const incomplete = await createSharedRunFixture({
      root: collection,
      runId: "run-c",
    });
    await Promise.all([
      publishAnalyses(first),
      publishAnalyses(second),
      publishAnalyses({ ...incomplete, completed: false }),
    ]);
    const outside = await tempRoot();
    const escaped = await createSharedRunFixture({ root: outside, runId: "escaped" });
    await publishAnalyses(escaped);
    await symlink(outside, join(collection, "outside-link"));
    const configPath = await writeConfig(collection, {
      schemaVersion: 1,
      claimType: "descriptive",
      include: { runIds: [], labels: {} },
      versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
      matchingFields: [],
      experimentalUnit: "team",
      clusterBy: "run",
    });
    const output = join(collection, "report-output");
    const sourcePaths = [
      join(first.runRoot, "run.json"),
      join(first.runRoot, "grading", "process-review-run-a", "scorecard.json"),
    ];
    const before = await Promise.all(sourcePaths.map((path) => readFile(path)));
    const result = await reportRuns({
      root: collection,
      artifactsRoot: collection,
      configPath,
      output,
      now: () => new Date("2026-08-03T00:00:00.000Z"),
    });
    const after = await Promise.all(sourcePaths.map((path) => readFile(path)));
    expect(after).toEqual(before);
    expect(result.includedRunCount).toBe(2);
    expect(result.excludedRunCount).toBe(1);
    expect(result.report.excluded).toEqual([
      expect.objectContaining({ runId: "run-c", reasonCode: "incomplete-process-review" }),
    ]);
    expect(result.report.dimensions).toEqual([
      expect.objectContaining({ dimensionId: "epistemic.revision", ratingCount: 4 }),
    ]);
    expect(result.report.outcomeLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ processMeasureId: "social.uptake-rate.judge-a.v1" }),
      ]),
    );
    expect(hasCompositeField(result.report)).toBe(false);
    expect(JSON.parse(await readFile(join(output, "report.json"), "utf8"))).toEqual(result.report);
    await expect(stat(join(output, "report.json"))).resolves.toMatchObject({
      isFile: expect.any(Function),
    });
    await expect(
      reportRuns({ root: collection, artifactsRoot: collection, configPath, output }),
    ).rejects.toThrow(/already exists/i);
  }, 15_000);

  it("publishes a declared matched contrast only when matching fields and treatment isolate", async () => {
    const collection = await tempRoot();
    const first = await createSharedRunFixture({
      root: collection,
      runId: "run-a",
    });
    const secondFixture = await createSharedRunFixture({
      root: collection,
      runId: "run-b",
    });
    const second = {
      ...secondFixture,
      record: withRunInput(secondFixture.record, (run) => ({
        ...run,
        capabilities: { ...run.capabilities, checker: false },
      })),
    };
    await Promise.all([publishAnalyses(first), publishAnalyses(second)]);
    const configPath = await writeConfig(collection, {
      schemaVersion: 1,
      claimType: "matched-contrast",
      include: { runIds: [], labels: {} },
      versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
      matchingFields: ["/configuration/run/fixture/constructionId"],
      treatmentField: "/configuration/run/capabilities/checker",
      experimentalUnit: "team",
      clusterBy: "run",
    });
    const result = await reportRuns({
      root: collection,
      artifactsRoot: collection,
      configPath,
      output: join(collection, "report-output"),
    });
    expect(result.claimType).toBe("matched-contrast");
    expect(result.report.included).toEqual([
      expect.objectContaining({ runId: "run-a", treatment: true }),
      expect.objectContaining({ runId: "run-b", treatment: false }),
    ]);
    expect(result.report.dimensions).toEqual([
      expect.objectContaining({
        dimensionId: "epistemic.revision",
        treatmentGroups: [
          expect.objectContaining({ treatment: false, ratingCount: 2 }),
          expect.objectContaining({ treatment: true, ratingCount: 2 }),
        ],
        treatmentContrasts: [expect.objectContaining({ state: "observed", meanDifference: 0 })],
      }),
    ]);
    expect(result.report.dimensions[0]).not.toHaveProperty("distribution");
  });

  it("rejects unmatched contrasts without publishing a descriptive fallback", async () => {
    const collection = await tempRoot();
    const first = await createSharedRunFixture({ root: collection, runId: "run-a" });
    const secondFixture = await createSharedRunFixture({
      root: collection,
      runId: "run-b",
    });
    const second = {
      ...secondFixture,
      record: withRunInput(secondFixture.record, (run) => ({
        ...run,
        capabilities: { ...run.capabilities, checker: false },
        limits: {
          ...run.limits,
          tokenLimitPerAgent: (run.limits.tokenLimitPerAgent ?? 0) + 1,
        },
      })),
    };
    await Promise.all([publishAnalyses(first), publishAnalyses(second)]);
    const configPath = await writeConfig(collection, {
      schemaVersion: 1,
      claimType: "matched-contrast",
      include: { runIds: [], labels: {} },
      versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
      matchingFields: ["/configuration/run/fixture/constructionId"],
      treatmentField: "/configuration/run/capabilities/checker",
      experimentalUnit: "team",
      clusterBy: "run",
    });
    const output = join(collection, "report-output");
    await expect(
      reportRuns({ root: collection, artifactsRoot: collection, configPath, output }),
    ).rejects.toThrow(/material run inputs differ/i);
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clusters every isolated canonical origin under its run", async () => {
    const collection = await tempRoot();
    const fixture = await createIsolatedRunFixture({
      root: collection,
      runId: "run-i",
    });
    await publishAnalyses(fixture);
    const configPath = await writeConfig(collection, {
      schemaVersion: 1,
      claimType: "descriptive",
      include: { runIds: [], labels: {} },
      versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
      matchingFields: [],
      experimentalUnit: "origin",
      clusterBy: "run",
    });
    const result = await reportRuns({
      root: collection,
      artifactsRoot: collection,
      configPath,
      output: join(collection, "report-output"),
    });
    expect(result.report.included).toEqual([
      expect.objectContaining({ runId: "run-i", originIds: ["agent-1", "agent-2"] }),
    ]);
    expect(result.report.dimensions).toEqual([
      expect.objectContaining({ uncertainty: expect.objectContaining({ clusterCount: 1 }) }),
    ]);
  });

  it("clusters separate executions independently when their run IDs match", async () => {
    const collection = await tempRoot();
    const first = await createSharedRunFixture({
      root: join(collection, "first"),
      configurationRoot: collection,
      runId: "reused-run",
    });
    const secondFixture = await createSharedRunFixture({
      root: join(collection, "second"),
      configurationRoot: collection,
      runId: "reused-run",
    });
    const second = {
      ...secondFixture,
      record: withRunInput(secondFixture.record, (run) => ({
        ...run,
        capabilities: { ...run.capabilities, checker: false },
      })),
    };
    await Promise.all([
      publishAnalyses({ ...first, root: collection, codedMeasureValue: 0.25 }),
      publishAnalyses({ ...second, root: collection, codedMeasureValue: 0.75 }),
    ]);
    const configPath = await writeConfig(collection, {
      schemaVersion: 1,
      claimType: "descriptive",
      include: { runIds: ["reused-run"], labels: {} },
      versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
      matchingFields: [],
      experimentalUnit: "team",
      clusterBy: "run",
    });
    const result = await reportRuns({
      root: collection,
      artifactsRoot: collection,
      configPath,
      output: join(collection, "report-output"),
    });
    expect(result.includedRunCount).toBe(2);
    expect(result.report.dimensions).toEqual([
      expect.objectContaining({ uncertainty: expect.objectContaining({ clusterCount: 2 }) }),
    ]);
    expect(result.report.outcomeLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          processMeasureId: "social.uptake-rate.judge-a.v1",
          clusterCount: 2,
        }),
      ]),
    );
  });

  it("rejects scorecard process measures that diverge from performance metrics", async () => {
    const collection = await tempRoot();
    const fixture = await createSharedRunFixture({ root: collection, runId: "run-a" });
    await publishAnalyses({
      ...fixture,
      scorecardProcessMeasures: (measures) => [
        ...measures,
        observed("epistemic.extra-mechanical.v1", 0.5),
      ],
    });
    const configPath = await writeConfig(collection, {
      schemaVersion: 1,
      claimType: "descriptive",
      include: { runIds: [], labels: {} },
      versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
      matchingFields: [],
      experimentalUnit: "team",
      clusterBy: "run",
    });
    await expect(
      reportRuns({
        root: collection,
        artifactsRoot: collection,
        configPath,
        output: join(collection, "report-output"),
      }),
    ).rejects.toThrow(/mechanical process measures differ/i);
  });

  it("rejects duplicate process measure IDs in a scorecard", async () => {
    const collection = await tempRoot();
    const fixture = await createSharedRunFixture({ root: collection, runId: "run-a" });
    await publishAnalyses({
      ...fixture,
      scorecardProcessMeasures: (measures) => [measures[0]!, measures[0]!],
    });
    const configPath = await writeConfig(collection, {
      schemaVersion: 1,
      claimType: "descriptive",
      include: { runIds: [], labels: {} },
      versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
      matchingFields: [],
      experimentalUnit: "team",
      clusterBy: "run",
    });
    await expect(
      reportRuns({
        root: collection,
        artifactsRoot: collection,
        configPath,
        output: join(collection, "report-output"),
      }),
    ).rejects.toThrow(/repeats measure IDs/i);
  });

  it("records incompatible analysis versions as explicit descriptive exclusions", async () => {
    const collection = await tempRoot();
    const compatible = await createSharedRunFixture({
      root: collection,
      runId: "run-a",
    });
    const future = await createSharedRunFixture({
      root: collection,
      runId: "run-future",
    });
    await Promise.all([
      publishAnalyses(compatible),
      publishAnalyses({ ...future, graderVersion: "epistemic-process-v2" }),
    ]);
    const configPath = await writeConfig(collection, {
      schemaVersion: 1,
      claimType: "descriptive",
      include: { runIds: [], labels: {} },
      versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
      matchingFields: [],
      experimentalUnit: "team",
      clusterBy: "run",
    });
    const result = await reportRuns({
      root: collection,
      artifactsRoot: collection,
      configPath,
      output: join(collection, "report-output"),
    });
    expect(result.report.excluded).toEqual([
      expect.objectContaining({
        runId: "run-future",
        reasonCode: "incompatible-grader-version",
      }),
    ]);
  });

  it("revalidates trace, frozen tree, and fixture sources before report eligibility", async () => {
    const collection = await tempRoot();
    const valid = await createSharedRunFixture({
      root: join(collection, "valid"),
      configurationRoot: collection,
      runId: "run-valid",
    });
    const traceTamper = await createSharedRunFixture({
      root: join(collection, "trace-tamper"),
      configurationRoot: collection,
      runId: "run-trace-tamper",
    });
    const treeTamper = await createSharedRunFixture({
      root: join(collection, "tree-tamper"),
      configurationRoot: collection,
      runId: "run-tree-tamper",
    });
    const fixtureTamper = await createSharedRunFixture({
      root: join(collection, "fixture-tamper"),
      configurationRoot: collection,
      runId: "run-fixture-tamper",
    });
    await Promise.all(
      [valid, traceTamper, treeTamper, fixtureTamper].map((fixture) =>
        publishAnalyses({ ...fixture, root: collection }),
      ),
    );
    await chmod(join(treeTamper.runRoot, treeTamper.record.topology.root), 0o700);
    await Promise.all([
      writeFile(
        traceTamper.tracePath,
        `${await readFile(traceTamper.tracePath, "utf8")}{}\n`,
        "utf8",
      ),
      writeFile(join(treeTamper.runRoot, treeTamper.record.topology.root, "tampered"), "x", "utf8"),
      writeFile(
        join(fixtureTamper.fixtureRoot, "complete", "ciphertext.txt"),
        "tampered\n",
        "utf8",
      ),
    ]);
    const configPath = await writeConfig(collection, {
      schemaVersion: 1,
      claimType: "descriptive",
      include: { runIds: [], labels: {} },
      versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
      matchingFields: [],
      experimentalUnit: "team",
      clusterBy: "run",
    });

    const result = await reportRuns({
      root: collection,
      artifactsRoot: collection,
      configPath,
      output: join(collection, "report-output"),
    });

    expect(result.includedRunCount).toBe(1);
    expect(result.report.excluded).toHaveLength(3);
    expect(result.report.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "run-trace-tamper",
          reasonCode: "source-integrity-failure",
        }),
        expect.objectContaining({
          runId: "run-tree-tamper",
          reasonCode: "source-integrity-failure",
        }),
        expect.objectContaining({
          runId: "run-fixture-tamper",
          reasonCode: "source-integrity-failure",
        }),
      ]),
    );
  });

  it("rejects report output that overlaps a discovered frozen run root", async () => {
    const collection = await tempRoot();
    const fixture = await createSharedRunFixture({ root: collection, runId: "run-a" });
    await publishAnalyses(fixture);
    const configPath = await writeConfig(collection, {
      schemaVersion: 1,
      claimType: "descriptive",
      include: { runIds: [], labels: {} },
      versions: { grader: "epistemic-process-v1", rubric: "epistemic-process-v1" },
      matchingFields: [],
      experimentalUnit: "team",
      clusterBy: "run",
    });

    await expect(
      reportRuns({
        root: collection,
        artifactsRoot: collection,
        configPath,
        output: join(fixture.runRoot, "report-output"),
      }),
    ).rejects.toThrow(/must not overlap.*frozen run root/i);
  });
});
