import { describe, expect, it } from "vitest";

import { contentDigest } from "../canonical.js";
import {
  decodeBehaviorReport,
  decodeDimensionReview,
  decodeEpistemicEpisode,
  decodeEvidenceBundle,
  decodeEvidenceItem,
  decodeEvidenceReference,
  decodeJudgeReview,
  decodeQuantitativeMeasure,
  decodeRunScorecard,
} from "./contracts.js";
import { EPISTEMIC_PROCESS_RUBRIC, rubricDimension } from "./rubric.js";

const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);

const traceReference = {
  source: "trace",
  traceSequence: 1,
  excerptDigest: DIGEST,
  role: "support",
} as const;

function ratedDimension() {
  return {
    dimensionId: "epistemic.testing",
    ledger: "epistemic",
    state: "rated",
    rating: 3,
    rationale: "The actor used a discriminating check before changing the solver.",
    evidence: [traceReference],
    counterevidence: [],
    confidence: "high",
  } as const;
}

describe("grading contracts", () => {
  it("strictly decodes each evidence-reference discriminator", () => {
    expect(decodeEvidenceReference(traceReference)).toEqual(traceReference);
    expect(
      decodeEvidenceReference({
        source: "run-record",
        recordPointer: "/topology/communicationMode",
        excerptDigest: DIGEST,
        role: "context",
      }),
    ).toMatchObject({ source: "run-record" });
    expect(
      decodeEvidenceReference({
        source: "git",
        originId: "shared",
        commit: "c".repeat(40),
        path: "solver.py",
        excerptDigest: DIGEST,
        role: "counterevidence",
      }),
    ).toMatchObject({ source: "git" });

    expect(() => decodeEvidenceReference({ ...traceReference, surprise: true })).toThrow(
      /unknown or missing/i,
    );
    expect(() => decodeEvidenceReference({ ...traceReference, traceSequence: 0 })).toThrow(
      /positive/i,
    );
    expect(() =>
      decodeEvidenceReference({
        source: "run-record",
        recordPointer: "topology/communicationMode",
        excerptDigest: DIGEST,
        role: "context",
      }),
    ).toThrow(/JSON Pointer/i);
  });

  it("enforces evidence availability and bundle coverage", () => {
    const item = decodeEvidenceItem({
      evidenceId: "evidence-1",
      atMs: 0,
      actorId: "actor-1",
      kind: "tool.result",
      content: { command: "status", exitCode: 0 },
      reference: traceReference,
      availability: "full",
    });
    expect(item.availability).toBe("full");
    expect(() => decodeEvidenceItem({ ...item, omissionReason: "none" })).toThrow(
      /omissionReason/i,
    );
    expect(() => decodeEvidenceItem({ ...item, availability: "excerpted" })).toThrow(
      /omissionReason/i,
    );

    const bundleBase = {
      schemaVersion: 1,
      runFingerprint: DIGEST,
      communicationMode: "isolated",
      actors: ["actor-1"],
      items: [item],
      windows: [
        {
          windowId: "window-1",
          evidenceIds: ["evidence-1"],
          byteCount: 128,
        },
      ],
      omissions: [],
      sourceDigest: DIGEST,
    } as const;
    const bundleId = `bundle-${contentDigest(bundleBase).slice(0, 24)}`;
    const bundle = {
      ...bundleBase,
      bundleId,
      contentDigest: contentDigest({ ...bundleBase, bundleId }),
    } as const;
    expect(decodeEvidenceBundle(bundle).windows[0]?.evidenceIds).toEqual(["evidence-1"]);
    expect(() =>
      decodeEvidenceBundle({
        ...bundle,
        items: [{ ...item, content: { command: "tampered", exitCode: 0 } }],
      }),
    ).toThrow(/canonical decoded content/i);
    expect(() =>
      decodeEvidenceBundle({
        ...bundle,
        windows: [{ windowId: "window-1", evidenceIds: [], byteCount: 0 }],
      }),
    ).toThrow(/exactly once/i);
  });

  it("keeps missing quantitative values distinct from observed zero", () => {
    const eligibility = { ruleId: "completed-run-v1", explanation: "Run completed." };
    expect(
      decodeQuantitativeMeasure({
        measureId: "instrumental.tool-count.v1",
        ledger: "instrumental",
        basis: "mechanical",
        state: "observed",
        value: 0,
        unit: "count",
        eligibility,
        evidence: [traceReference],
      }),
    ).toMatchObject({ state: "observed", value: 0 });
    expect(
      decodeQuantitativeMeasure({
        measureId: "social.uptake-rate.v1",
        ledger: "social",
        basis: "review-coded",
        state: "not-applicable",
        eligibility: {
          ruleId: "shared-only-v1",
          explanation: "Peer communication was unavailable.",
        },
        evidence: [],
      }),
    ).toMatchObject({ state: "not-applicable" });
    expect(() =>
      decodeQuantitativeMeasure({
        measureId: "instrumental.invalid-rate.v1",
        ledger: "instrumental",
        basis: "mechanical",
        state: "observed",
        value: 0.5,
        unit: "ratio",
        denominator: 0,
        eligibility,
        evidence: [traceReference],
      }),
    ).toThrow(/denominator/i);
  });

  it("decodes observable episodes and dimension states without encoding missingness as zero", () => {
    expect(
      decodeEpistemicEpisode({
        episodeId: "episode-1",
        summary: "The actor stated a mapping, tested it, and changed later behavior.",
        status: "supported-revision",
        evidence: [traceReference],
        commitment: [traceReference],
        test: [traceReference],
        revision: [traceReference],
        transmission: [],
        uptake: [],
        integration: [],
        counterevidence: [],
        confidence: "medium",
      }).status,
    ).toBe("supported-revision");
    expect(decodeDimensionReview(ratedDimension())).toMatchObject({ state: "rated", rating: 3 });
    const { rating: _rating, ...unrated } = ratedDimension();
    expect(
      decodeDimensionReview({
        ...unrated,
        state: "unobservable",
        rationale: "The retained record does not expose this behavior.",
        evidence: [],
      }),
    ).not.toHaveProperty("rating");
    expect(() => decodeDimensionReview({ ...ratedDimension(), state: "unobservable" })).toThrow(
      /unknown or missing/i,
    );
    expect(() => decodeDimensionReview({ ...ratedDimension(), evidence: [] })).toThrow(
      /supporting evidence/i,
    );
  });

  it("strictly decodes completed and failed judge reviews", () => {
    const completed = {
      reviewId: "review-1",
      status: "completed",
      rubricVersion: "epistemic-process-v1",
      bundleDigest: DIGEST,
      judge: {
        providerFamily: "provider-a",
        requestedModel: "judge-a",
        actualProvider: "provider-a",
        actualModel: "judge-a-2026",
      },
      dimensions: [ratedDimension()],
      episodes: [],
      overallCautions: [],
      rawResponsePath: "grading/process-review-1/judge-1.raw.json",
      rawResponseDigest: OTHER_DIGEST,
    } as const;
    expect(decodeJudgeReview(completed).status).toBe("completed");
    expect(() => decodeJudgeReview({ ...completed, totalScore: 3 })).toThrow(/unknown or missing/i);
    expect(
      decodeJudgeReview({
        ...completed,
        status: "provider-error",
        dimensions: [],
        episodes: [],
        overallCautions: ["Provider request failed."],
      }).status,
    ).toBe("provider-error");
  });

  it("publishes ordered, dimension-specific 0-4 anchors for all process ledgers", () => {
    expect(EPISTEMIC_PROCESS_RUBRIC.rubricVersion).toBe("epistemic-process-v1");
    expect(EPISTEMIC_PROCESS_RUBRIC.dimensions).toHaveLength(18);
    expect(
      new Set(EPISTEMIC_PROCESS_RUBRIC.dimensions.map(({ dimensionId }) => dimensionId)).size,
    ).toBe(18);
    expect(
      new Set(EPISTEMIC_PROCESS_RUBRIC.dimensions.map(({ anchors }) => anchors.join("\0"))).size,
    ).toBe(18);
    expect(rubricDimension("social.uptake")).toMatchObject({ ledger: "social" });
    expect(() => rubricDimension("outcome.accuracy")).toThrow(/unknown rubric dimension/i);
  });

  it("decodes non-composite scorecards and behavior reports", () => {
    const scorecard = {
      schemaVersion: 1,
      runId: "run-1",
      canonicalOrigins: [{ originId: "agent-1", status: "eligible" }],
      outcome: { measures: [] },
      epistemic: { measures: [], reviews: [] },
      social: { measures: [], reviews: [] },
      instrumental: { measures: [], reviews: [] },
      disagreements: [],
      eligibility: { status: "completed" },
      limitations: [],
    } as const;
    expect(decodeRunScorecard(scorecard).canonicalOrigins).toHaveLength(1);
    expect(() => decodeRunScorecard({ ...scorecard, composite: 3 })).toThrow(/unknown or missing/i);
    const scorecardV2 = {
      ...scorecard,
      schemaVersion: 2,
      dossier: {
        reviewers: [1, 2].map((judge) => ({
          judge,
          evidence: {
            evaluationUnit: { kind: "shared-team", actorIds: ["actor-1"] },
            opportunities: [],
            claims: [],
            epistemicEpisodes: [],
            influenceChains: [],
            executionChains: [],
          },
        })),
      },
      failureAccount: { causalAttribution: "prohibited", layers: [] },
      provenance: {
        fixture: {},
        treatments: {},
        experimentalUnit: "team",
        models: [],
        runRecordDigest: DIGEST,
        performanceAnalysisId: "performance-1",
        reviewProtocol: "ledger-packets-v5",
        bundleDigest: DIGEST,
        checkerEnabled: false,
        omissionCount: 0,
        truncationCount: 0,
        confounds: [],
      },
    } as const;
    expect(decodeRunScorecard(scorecardV2).schemaVersion).toBe(2);

    const report = {
      schemaVersion: 1,
      reportId: "behavior-report-1",
      createdAt: "2026-08-02T00:00:00.000Z",
      claimType: "descriptive",
      experimentalUnit: { unit: "origin", clusterByRun: true },
      matchingFields: [],
      included: [],
      excluded: [],
      dimensions: [],
      reviewerAgreement: [],
      outcomeLinks: [],
      limitations: [],
    } as const;
    expect(decodeBehaviorReport(report).claimType).toBe("descriptive");
    expect(() => decodeBehaviorReport({ ...report, totalScore: 1 })).toThrow(/unknown or missing/i);
  });
});
