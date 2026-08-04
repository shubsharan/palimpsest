import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { calibrateReviews } from "./calibrate.js";

const DIGEST = "a".repeat(64);
const reference = { source: "trace", traceSequence: 1, excerptDigest: DIGEST, role: "support" };

describe("automated structural calibration", () => {
  it("publishes provider-free integrity and stability metrics without a construct-validity claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-calibrate-"));
    const reviewRoot = join(root, "run", "grading", "process-review-1");
    await mkdir(reviewRoot, { recursive: true });
    const dimensions = [
      {
        dimensionId: "epistemic.testing",
        ledger: "epistemic",
        state: "rated",
        rating: 3,
        rationale: "Structured claim summary.",
        evidence: [reference],
        counterevidence: [],
        confidence: "medium",
      },
    ];
    const dossier = {
      evaluationUnit: { kind: "shared-team", actorIds: ["actor-1", "actor-2"] },
      opportunities: [
        {
          opportunityId: "epistemic-opp-0001",
          kind: "actor-action",
          atMs: 1,
          actorIds: ["actor-1"],
          evidence: [reference],
        },
      ],
      claims: [
        {
          claimId: "epistemic-claim-001",
          opportunityId: "epistemic-opp-0001",
          ledger: "epistemic",
          subjectScope: "evaluation-unit",
          actorIds: ["actor-1", "actor-2"],
          predicate: "test",
          state: "observed",
          qualification: "direct",
          evidence: [reference],
          counterevidence: [],
          confidence: "medium",
          missingReason: "",
        },
      ],
      epistemicEpisodes: [],
      influenceChains: [],
      executionChains: [],
    };
    const scorecard = {
      schemaVersion: 2,
      runId: "run-1",
      canonicalOrigins: [{ originId: "shared", status: "eligible" }],
      outcome: { measures: [] },
      epistemic: {
        measures: [],
        reviewers: [
          { judge: 1, dimensions },
          { judge: 2, dimensions },
        ],
      },
      social: {
        measures: [],
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
      dossier: {
        reviewers: [
          { judge: 1, evidence: dossier },
          { judge: 2, evidence: dossier },
        ],
      },
      failureAccount: { causalAttribution: "prohibited", layers: [] },
      provenance: {
        fixture: {},
        treatments: {},
        experimentalUnit: "team",
        models: [],
        runRecordDigest: DIGEST,
        performanceAnalysisId: "performance-1",
        reviewProtocol: "ledger-packets-v6",
        bundleDigest: DIGEST,
        checkerEnabled: false,
        omissionCount: 0,
        truncationCount: 0,
        confounds: [],
      },
      disagreements: [],
      eligibility: { status: "completed" },
      limitations: [],
    };
    await writeFile(join(reviewRoot, "scorecard.json"), `${JSON.stringify([scorecard])}\n`);
    const output = join(root, "calibration");
    const result = await calibrateReviews({
      artifactsRoot: root,
      output,
      now: () => new Date("2026-08-03T00:00:00.000Z"),
    });
    const published = JSON.parse(await readFile(result.path, "utf8")) as Record<string, unknown>;
    expect(result.scorecardCount).toBe(1);
    expect(JSON.stringify(published)).toContain("does not establish construct validity");
    expect(published).toMatchObject({
      metrics: { exactRatingAgreementRate: 1, citationDigestValidityRate: 1 },
    });
  });
});
