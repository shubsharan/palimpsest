import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contentDigest } from "../canonical.js";
import type {
  ModelAdapter,
  ModelRequest,
  ModelSessionContext,
  ModelTurn,
  TokenUsage,
} from "../model/contracts.js";
import { appendRunAnalysis, loadRunRecord, type PerformanceRunAnalysis } from "../run/record.js";
import {
  createIsolatedRunFixture,
  createSharedRunFixture,
} from "../../tests/support/grading-fixture.js";
import {
  decodeJudgeReview,
  type EvidenceBundle,
  type EvidenceReference,
  type ReviewerOutput,
} from "./contracts.js";
import { compileEvidence } from "./evidence.js";
import {
  decodeGradingConfiguration,
  gradingConfigurationDigest,
  PublishedIncompleteReviewError,
  reviewRun,
  type GradingConfiguration,
  type ReviewAdapterOptions,
  type ReviewDependencies,
} from "./review.js";
import { EPISTEMIC_PROCESS_RUBRIC } from "./rubric.js";

const CONFIG: GradingConfiguration = {
  schemaVersion: 1,
  rubric: "epistemic-process-v1",
  models: {
    "reviewer-openai": { provider: "openai", model: "review-model-a" },
    "reviewer-anthropic": { provider: "anthropic", model: "review-model-b" },
  },
  reviewers: [
    { profile: "reviewer-openai", tokenLimit: 500_000, maxOutputTokens: 8_000 },
    { profile: "reviewer-anthropic", tokenLimit: 500_000, maxOutputTokens: 8_000 },
  ],
};

function yamlConfig(config: GradingConfiguration = CONFIG): string {
  return [
    `schemaVersion: ${String(config.schemaVersion)}`,
    `rubric: ${config.rubric}`,
    "models:",
    ...Object.entries(config.models).flatMap(([id, profile]) => [
      `  ${id}:`,
      `    provider: ${profile.provider}`,
      `    model: ${profile.model}`,
    ]),
    "reviewers:",
    ...config.reviewers.flatMap((reviewer) => [
      `  - profile: ${reviewer.profile}`,
      `    tokenLimit: ${String(reviewer.tokenLimit)}`,
      `    maxOutputTokens: ${String(reviewer.maxOutputTokens)}`,
    ]),
    "",
  ].join("\n");
}

interface ProviderCandidateWindowOutput {
  readonly schemaVersion: 1;
  readonly windowId: string;
  readonly candidates: readonly {
    readonly summary: string;
    readonly evidenceIds: readonly string[];
  }[];
}

function candidate(windowId: string, evidenceIds: readonly string[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    windowId,
    candidates: [{ summary: "Observed a test of a competing mapping.", evidenceIds }],
  });
}

function reviewerOutput(
  bundle: EvidenceBundle,
  rating: 0 | 1 | 2 | 3 | 4,
  options: {
    reference?: EvidenceReference;
    hiddenClaim?: boolean;
    episode?: "uptake" | "asserted" | "none";
    episodeReferences?: {
      readonly transmission: EvidenceReference;
      readonly uptake: EvidenceReference;
      readonly integration: EvidenceReference;
    };
  } = {},
): ReviewerOutput {
  const reference = options.reference ?? bundle.items[0]!.reference;
  return {
    schemaVersion: 1,
    rubricVersion: "epistemic-process-v1",
    bundleDigest: bundle.contentDigest,
    dimensions: EPISTEMIC_PROCESS_RUBRIC.dimensions.map((dimension) =>
      bundle.communicationMode === "isolated" && dimension.ledger === "social"
        ? {
            dimensionId: dimension.dimensionId,
            ledger: dimension.ledger,
            state: "not-applicable" as const,
            rationale: "No peer channel was available in this condition.",
            evidence: [],
            counterevidence: [],
            confidence: "high" as const,
          }
        : {
            dimensionId: dimension.dimensionId,
            ledger: dimension.ledger,
            state: "rated" as const,
            rating,
            rationale: options.hiddenClaim
              ? "The actor believed the competing mapping was correct."
              : "The retained action supplies observable evidence for this rating.",
            evidence: [reference],
            counterevidence: [],
            confidence: "medium" as const,
          },
    ),
    episodes:
      options.episode === "none" || options.episode === undefined
        ? []
        : [
            {
              episodeId: options.episode === "uptake" ? "episode-uptake" : "episode-assertion",
              summary:
                options.episode === "uptake"
                  ? "One actor transmitted a contribution and another applied it to the artifact."
                  : "The actor stated a revision without later observable action.",
              status:
                options.episode === "uptake"
                  ? ("supported-revision" as const)
                  : ("asserted-only" as const),
              evidence: [reference],
              commitment: [reference],
              test: [],
              revision: [reference],
              transmission:
                options.episode === "uptake"
                  ? [options.episodeReferences?.transmission ?? reference]
                  : [],
              uptake:
                options.episode === "uptake"
                  ? [options.episodeReferences?.uptake ?? reference]
                  : [],
              integration:
                options.episode === "uptake"
                  ? [options.episodeReferences?.integration ?? reference]
                  : [],
              counterevidence: [],
              confidence: "medium" as const,
            },
          ],
    overallCautions: [],
  };
}

function providerReviewerOutput(bundle: EvidenceBundle, output: ReviewerOutput): unknown {
  const evidenceId = (reference: EvidenceReference): string =>
    bundle.items.find((item) => JSON.stringify(item.reference) === JSON.stringify(reference))
      ?.evidenceId ?? `e-${"9".repeat(24)}`;
  const evidenceIds = (references: readonly EvidenceReference[]) => references.map(evidenceId);
  return {
    schemaVersion: output.schemaVersion,
    rubricVersion: output.rubricVersion,
    bundleDigest: output.bundleDigest,
    dimensions: Object.fromEntries(
      output.dimensions.map(
        ({ dimensionId, ledger: _ledger, evidence, counterevidence, ...item }) => [
          dimensionId,
          {
            ...item,
            evidenceIds: evidenceIds(evidence),
            counterevidenceIds: evidenceIds(counterevidence),
          },
        ],
      ),
    ),
    episodes: output.episodes.map(
      ({
        evidence,
        commitment,
        test,
        revision,
        transmission,
        uptake,
        integration,
        counterevidence,
        ...episode
      }) => ({
        ...episode,
        evidenceIds: evidenceIds(evidence),
        commitmentIds: evidenceIds(commitment),
        testIds: evidenceIds(test),
        revisionIds: evidenceIds(revision),
        transmissionIds: evidenceIds(transmission),
        uptakeIds: evidenceIds(uptake),
        integrationIds: evidenceIds(integration),
        counterevidenceIds: evidenceIds(counterevidence),
      }),
    ),
    overallCautions: output.overallCautions,
  };
}

class FakeAdapter implements ModelAdapter {
  readonly prompts: string[] = [];
  readonly structuredOutputs: NonNullable<ModelRequest["structuredOutput"]>[] = [];
  readonly #bundle: EvidenceBundle;
  readonly #rating: 0 | 1 | 2 | 3 | 4;
  readonly #integration: (
    bundle: EvidenceBundle,
    rating: 0 | 1 | 2 | 3 | 4,
    prompt: string,
  ) => string;
  readonly #usage: TokenUsage;

  constructor(
    bundle: EvidenceBundle,
    rating: 0 | 1 | 2 | 3 | 4,
    integration = (value: EvidenceBundle, score: 0 | 1 | 2 | 3 | 4, prompt: string) => {
      const candidates = JSON.parse(
        prompt.split("Candidates: ")[1]!,
      ) as ProviderCandidateWindowOutput[];
      const evidenceId = candidates[0]!.candidates[0]!.evidenceIds[0]!;
      const reference = value.items.find((item) => item.evidenceId === evidenceId)!.reference;
      return JSON.stringify(
        providerReviewerOutput(value, reviewerOutput(value, score, { reference })),
      );
    },
    usage: TokenUsage = { inputTokens: 10, outputTokens: 10 },
  ) {
    this.#bundle = bundle;
    this.#rating = rating;
    this.#integration = integration;
    this.#usage = usage;
  }

  openSession(_context: ModelSessionContext) {
    return {
      respond: async (request: ModelRequest): Promise<ModelTurn> => {
        const prompt = request.prompt ?? "";
        this.prompts.push(prompt);
        if (request.structuredOutput === undefined) {
          throw new Error("Review requests require structured output.");
        }
        this.structuredOutputs.push(request.structuredOutput);
        return {
          toolCalls: [],
          finalResponse: prompt.includes("_WINDOW_V1")
            ? (() => {
                const windowId = /Window ID: ([^\n]+)/.exec(prompt)?.[1];
                const items = JSON.parse(prompt.split("Evidence: ")[1]!) as EvidenceBundle["items"];
                return candidate(
                  windowId!,
                  items.map(({ evidenceId }) => evidenceId),
                );
              })()
            : this.#integration(this.#bundle, this.#rating, prompt),
          usage: this.#usage,
          responseIdentity: { actualProvider: "fake", actualModel: "fake-reviewer" },
        };
      },
    };
  }
}

async function preparedRun(communicationMode: "shared" | "isolated" = "shared") {
  const fixture =
    communicationMode === "shared"
      ? await createSharedRunFixture({
          observations: [
            {
              kind: "stage.released",
              agentId: "agent-1",
              data: { ordinal: 1, activitySequence: 1 },
            },
            {
              kind: "team.message",
              data: {
                sequence: 1,
                author: "agent-1",
                message: "Try the competing mapping against the next repeated token.",
                occurredAtMs: 2,
              },
            },
            {
              kind: "model.response",
              agentId: "agent-2",
              data: { text: "Applied the shared mapping to the next repeated token." },
            },
          ],
        })
      : await createIsolatedRunFixture({
          observations: [
            {
              kind: "git.changed",
              data: {
                repositoryId: "agent-1",
                refs: ["refs/heads/private-one"],
                targets: [{ ref: "refs/heads/private-one", objectId: "1".repeat(40) }],
              },
            },
            {
              kind: "git.changed",
              data: {
                repositoryId: "agent-2",
                refs: ["refs/heads/private-two"],
                targets: [{ ref: "refs/heads/private-two", objectId: "2".repeat(40) }],
              },
            },
          ],
        });
  const configPath = join(fixture.root, "grading.yaml");
  const configurationSource = yamlConfig();
  await writeFile(configPath, configurationSource, "utf8");
  const { bundle } = await compileEvidence({ root: fixture.root, runRoot: fixture.runRoot });
  const detailDirectory = join(fixture.runRoot, "grading", "performance-one");
  await mkdir(detailDirectory, { recursive: true });
  await writeFile(join(detailDirectory, "evidence.json"), `${JSON.stringify(bundle)}\n`, "utf8");
  const metrics = {
    schemaVersion: 1,
    kind: "measure",
    measures: fixture.record.topology.origins.map(({ originId }) => ({
      originId,
      values: [
        {
          measureId: "outcome.runnable.v1",
          ledger: "outcome",
          basis: "mechanical",
          state: "observed",
          value: true,
          unit: "boolean",
          eligibility: {
            ruleId: "frozen-evaluation",
            explanation: "Uses the frozen automatic evaluation.",
          },
          evidence: [bundle.items[0]!.reference],
        },
      ],
    })),
  };
  await writeFile(join(detailDirectory, "metrics.json"), `${JSON.stringify(metrics)}\n`, "utf8");
  const manifest = {
    schemaVersion: 1,
    kind: "performance",
    analysisId: "performance-one",
    graderVersion: "epistemic-process-v1",
    configurationDigest: gradingConfigurationDigest(configurationSource),
    sourceDigest: bundle.sourceDigest,
    evidence: { path: "evidence.json", contentDigest: bundle.contentDigest },
    metrics: { path: "metrics.json", contentDigest: contentDigest(metrics) },
    origins: fixture.record.topology.origins.map(({ originId }) => ({
      originId,
      status: "eligible",
    })),
  };
  await writeFile(join(detailDirectory, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  const performance: PerformanceRunAnalysis = {
    analysisId: "performance-one",
    kind: "performance",
    analyzedAt: "2026-08-02T00:05:00.000Z",
    graderVersion: "epistemic-process-v1",
    configurationDigest: gradingConfigurationDigest(configurationSource),
    sourceDigest: bundle.sourceDigest,
    detailsPath: "grading/performance-one/manifest.json",
    detailsDigest: contentDigest(manifest),
    origins: fixture.record.topology.origins.map(({ originId }) => ({
      originId,
      status: "eligible",
    })),
  };
  await appendRunAnalysis(fixture.runRoot, fixture.record, performance);
  return { ...fixture, bundle, configPath, performance };
}

function dependencies(adapters: readonly FakeAdapter[], prefix = "fixed") {
  let index = 0;
  const created: ReviewAdapterOptions[] = [];
  return {
    created,
    value: {
      env: { OPENAI_API_KEY: "fake-openai", ANTHROPIC_API_KEY: "fake-anthropic" },
      createAdapter: (options: ReviewAdapterOptions) => {
        created.push(options);
        return adapters[index++]!;
      },
      now: () => new Date("2026-08-02T00:10:00.000Z"),
      randomUUID: (() => {
        let ordinal = 0;
        return () => `${prefix}-${String(++ordinal)}`;
      })(),
      invokePython: async (
        _projectRoot: string,
        _module: string,
        _args: readonly string[],
        _signal: AbortSignal | undefined,
        stdin: string | Buffer | undefined,
      ) => {
        const request = JSON.parse(String(stdin)) as {
          communicationMode: "shared" | "isolated";
          origins: readonly { originId: string }[];
          reviews: readonly {
            reviewerId: string;
            revisionOpportunities: readonly {
              status: string;
              evidence: readonly EvidenceReference[];
            }[];
            collaborationOpportunities: readonly {
              status: string;
              evidence: readonly EvidenceReference[];
            }[];
          }[];
        };
        const missing = (
          measureId: string,
          ledger: "epistemic" | "social",
          state: "unavailable" | "not-applicable",
        ) => ({
          measureId,
          ledger,
          basis: "review-coded",
          state,
          eligibility: {
            ruleId: "frozen-review-opportunities",
            explanation: "Uses only the frozen reviewer coding.",
          },
          evidence: [],
        });
        const observed = (
          measureId: string,
          ledger: "epistemic" | "social",
          numerator: number,
          denominator: number,
          evidence: readonly EvidenceReference[],
        ) => ({
          measureId,
          ledger,
          basis: "review-coded",
          state: "observed",
          value: numerator / denominator,
          unit: "ratio",
          numerator,
          denominator,
          eligibility: {
            ruleId: "frozen-review-opportunities",
            explanation: "Uses only the frozen reviewer coding.",
          },
          evidence,
        });
        const values = request.reviews.flatMap((review) => {
          const revisions = review.revisionOpportunities;
          const collaborations = review.collaborationOpportunities;
          return [
            revisions.length === 0
              ? missing(
                  `epistemic.supported-revision-rate.${review.reviewerId}.v1`,
                  "epistemic",
                  "unavailable",
                )
              : observed(
                  `epistemic.supported-revision-rate.${review.reviewerId}.v1`,
                  "epistemic",
                  revisions.filter(({ status }) => status === "supported-revision").length,
                  revisions.length,
                  revisions.flatMap(({ evidence }) => evidence),
                ),
            request.communicationMode === "isolated"
              ? missing(
                  `social.contribution-uptake-rate.${review.reviewerId}.v1`,
                  "social",
                  "not-applicable",
                )
              : collaborations.length === 0
                ? missing(
                    `social.contribution-uptake-rate.${review.reviewerId}.v1`,
                    "social",
                    "unavailable",
                  )
                : observed(
                    `social.contribution-uptake-rate.${review.reviewerId}.v1`,
                    "social",
                    collaborations.filter(
                      ({ status }) => status === "uptaken" || status === "integrated",
                    ).length,
                    collaborations.length,
                    collaborations.flatMap(({ evidence }) => evidence),
                  ),
          ];
        });
        return {
          schemaVersion: 1,
          kind: "measure",
          measures: request.origins.map(({ originId }) => ({ originId, values })),
        };
      },
    },
  };
}

describe("grading review configuration", () => {
  it("strictly decodes one minimal catalog and two distinct official provider reviewers", () => {
    expect(decodeGradingConfiguration(CONFIG)).toEqual(CONFIG);
    expect(() => decodeGradingConfiguration({ ...CONFIG, extra: true })).toThrow(/unknown/i);
    expect(() =>
      decodeGradingConfiguration({
        ...CONFIG,
        models: {
          ...CONFIG.models,
          "reviewer-anthropic": { provider: "openai", model: "second" },
        },
      }),
    ).toThrow(/distinct provider families/i);
    expect(() =>
      decodeGradingConfiguration({ ...CONFIG, reviewers: [{ ...CONFIG.reviewers[0] }] }),
    ).toThrow(/exactly two/i);
    expect(() =>
      decodeGradingConfiguration({
        ...CONFIG,
        reviewers: CONFIG.reviewers.map(({ profile }) => ({
          profile,
          spendCeilingCents: 300,
        })),
      }),
    ).toThrow(/unknown or missing fields/i);
    expect(() =>
      decodeGradingConfiguration({
        ...CONFIG,
        reviewers: [{ ...CONFIG.reviewers[0], tokenLimit: 0 }, { ...CONFIG.reviewers[1] }],
      }),
    ).toThrow(/tokenLimit.*positive safe integer/i);
    expect(() =>
      decodeGradingConfiguration({
        ...CONFIG,
        reviewers: [{ ...CONFIG.reviewers[0], maxOutputTokens: 0 }, { ...CONFIG.reviewers[1] }],
      }),
    ).toThrow(/maxOutputTokens.*positive safe integer/i);
  });

  it("rejects authorization, credentials, leakage, and exact-input drift before adapter construction", async () => {
    const fixture = await preparedRun();
    let constructions = 0;
    const base = {
      env: {},
      createAdapter: () => {
        constructions += 1;
        throw new Error("must not construct");
      },
    };
    await expect(
      reviewRun(
        {
          projectRoot: fixture.root,
          runRoot: fixture.runRoot,
          configPath: fixture.configPath,
          performanceAnalysisId: fixture.performance.analysisId,
          allowSpend: false,
        },
        base,
      ),
    ).rejects.toThrow(/literal --allow-spend true/i);
    await expect(
      reviewRun(
        {
          projectRoot: fixture.root,
          runRoot: fixture.runRoot,
          configPath: fixture.configPath,
          performanceAnalysisId: fixture.performance.analysisId,
          allowSpend: true,
        },
        base,
      ),
    ).rejects.toThrow(/OPENAI_API_KEY/i);
    expect(constructions).toBe(0);

    const evidencePath = join(
      fixture.runRoot,
      "grading",
      fixture.performance.analysisId,
      "evidence.json",
    );
    const tampered = JSON.parse(await readFile(evidencePath, "utf8")) as EvidenceBundle;
    await writeFile(
      evidencePath,
      `${JSON.stringify({
        ...tampered,
        items: [{ ...tampered.items[0]!, content: { tampered: true } }, ...tampered.items.slice(1)],
      })}\n`,
      "utf8",
    );
    await expect(
      reviewRun(
        {
          projectRoot: fixture.root,
          runRoot: fixture.runRoot,
          configPath: fixture.configPath,
          performanceAnalysisId: fixture.performance.analysisId,
          allowSpend: true,
        },
        {
          env: { OPENAI_API_KEY: "fake", ANTHROPIC_API_KEY: "fake" },
          createAdapter: () => {
            constructions += 1;
            throw new Error("must not construct");
          },
        },
      ),
    ).rejects.toThrow(/canonical decoded content/i);
    expect(constructions).toBe(0);
  });
});

describe("independent qualitative review", () => {
  it("runs window extraction then integration independently and publishes separate ratings", async () => {
    const fixture = await preparedRun();
    const first = new FakeAdapter(fixture.bundle, 2);
    const second = new FakeAdapter(fixture.bundle, 4);
    const deps = dependencies([first, second]);
    const result = await reviewRun(
      {
        projectRoot: fixture.root,
        runRoot: fixture.runRoot,
        configPath: fixture.configPath,
        performanceAnalysisId: fixture.performance.analysisId,
        allowSpend: "true",
      },
      deps.value,
    );

    expect(result.analysis.status).toBe("completed");
    expect(result.analysis.reviews.map(({ providerFamily }) => providerFamily)).toEqual([
      "openai",
      "anthropic",
    ]);
    expect(first.prompts).toHaveLength(2);
    expect(second.prompts).toHaveLength(2);
    expect(first.prompts[0]).toContain("PALIMPSEST_PROCESS_REVIEW_WINDOW_V1");
    expect(first.prompts[1]).toContain("PALIMPSEST_PROCESS_REVIEW_INTEGRATION_V1");
    expect(first.structuredOutputs.map(({ name }) => name)).toEqual([
      "palimpsest_process_window",
      "palimpsest_process_review",
    ]);
    const windowSchema = JSON.stringify(first.structuredOutputs[0]!.schema);
    const integrationSchema = JSON.stringify(first.structuredOutputs[1]!.schema);
    expect(windowSchema).toContain(fixture.bundle.items[0]!.evidenceId);
    expect(windowSchema).not.toContain(fixture.bundle.items[0]!.reference.excerptDigest);
    expect(windowSchema).toContain('"schemaVersion":{"type":"integer","const":1}');
    expect(windowSchema).toContain('"windowId":{"type":"string","const":"window-0001"}');
    expect(integrationSchema).toContain('"$ref":"#/$defs/evidenceId"');
    expect(integrationSchema).toContain('"anyOf"');
    expect(integrationSchema).not.toContain('"oneOf"');
    for (const { dimensionId } of EPISTEMIC_PROCESS_RUBRIC.dimensions) {
      expect(integrationSchema).toContain(`"${dimensionId}"`);
    }
    expect(first.prompts.join("\n")).not.toMatch(/synthetic-run|matchedWords|review-model-a/);
    expect(result.scorecards).toHaveLength(1);
    const scorecardText = JSON.stringify(result.scorecards);
    expect(scorecardText).toContain('"rating":2');
    expect(scorecardText).toContain('"rating":4');
    expect(scorecardText).toContain('"measureId":"outcome.runnable.v1"');
    expect(scorecardText).toContain("epistemic.supported-revision-rate.judge-1.v1");
    expect(scorecardText).not.toMatch(/"(?:average|composite|totalScore)"\s*:/i);
    await expect(readFile(join(result.path, "judge-1.raw.json"), "utf8")).resolves.toContain(
      "window-0001",
    );
    await expect(readFile(join(result.path, "judge-2.review.json"), "utf8")).resolves.toContain(
      "epistemic.framing",
    );
    const publishedJudge = JSON.parse(
      await readFile(join(result.path, "judge-1.review.json"), "utf8"),
    ) as unknown;
    expect(decodeJudgeReview(publishedJudge).status).toBe("completed");
    await expect(readFile(join(result.path, "scorecard.json"), "utf8")).resolves.toContain(
      fixture.record.runId,
    );
  });

  it("rejects a window candidate whose evidence ID is outside that exact window", async () => {
    const fixture = await preparedRun();
    const invalidWindow: ModelAdapter = {
      openSession: () => ({
        respond: (request): Promise<ModelTurn> =>
          Promise.resolve({
            toolCalls: [],
            finalResponse: candidate(
              /Window ID: ([^\n]+)/.exec(request.prompt ?? "")?.[1] ?? "window-0001",
              [`e-${"9".repeat(24)}`],
            ),
            usage: { inputTokens: 1, outputTokens: 1 },
            responseIdentity: { actualProvider: "fake", actualModel: "invalid-window" },
          }),
      }),
    };
    const deps = dependencies([invalidWindow as FakeAdapter, new FakeAdapter(fixture.bundle, 3)]);

    let incomplete: PublishedIncompleteReviewError | undefined;
    try {
      await reviewRun(
        {
          projectRoot: fixture.root,
          runRoot: fixture.runRoot,
          configPath: fixture.configPath,
          performanceAnalysisId: fixture.performance.analysisId,
          allowSpend: true,
        },
        deps.value,
      );
    } catch (error) {
      if (error instanceof PublishedIncompleteReviewError) incomplete = error;
      else throw error;
    }

    expect(incomplete!.result.analysis.reviews[0].status).toBe("invalid");
    await expect(
      readFile(join(incomplete!.result.path, "judge-1.raw.json"), "utf8"),
    ).resolves.toContain("outside the exact evidence window");
  });

  it("preserves invalid citations and malformed integration as published incomplete analyses", async () => {
    const fixture = await preparedRun();
    const invalidReference = {
      ...fixture.bundle.items[0]!.reference,
      excerptDigest: "9".repeat(64),
    };
    const invalid = new FakeAdapter(fixture.bundle, 2, (bundle) =>
      JSON.stringify(
        providerReviewerOutput(bundle, reviewerOutput(bundle, 2, { reference: invalidReference })),
      ),
    );
    const malformed = new FakeAdapter(fixture.bundle, 2, () => "not-json");
    const deps = dependencies([invalid, malformed]);

    let published: PublishedIncompleteReviewError | undefined;
    try {
      await reviewRun(
        {
          projectRoot: fixture.root,
          runRoot: fixture.runRoot,
          configPath: fixture.configPath,
          performanceAnalysisId: fixture.performance.analysisId,
          allowSpend: true,
        },
        deps.value,
      );
    } catch (error) {
      if (error instanceof PublishedIncompleteReviewError) published = error;
      else throw error;
    }
    expect(published).toBeDefined();
    expect(published!.result.analysis.status).toBe("incomplete");
    expect(published!.result.analysis.reviews.map(({ status }) => status)).toEqual([
      "invalid",
      "invalid",
    ]);
    const rawInvalid = await readFile(join(published!.result.path, "judge-1.raw.json"), "utf8");
    expect(rawInvalid).toContain("outside the candidates");
    const rawTranscript = JSON.parse(rawInvalid) as {
      origins: readonly { integration?: { response: string } }[];
    };
    expect(rawTranscript.origins[0]!.integration!.response).toContain(`e-${"9".repeat(24)}`);
    await expect(
      readFile(join(published!.result.path, "scorecard.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("retains provider failure without retry and permits one explicit manual retry", async () => {
    const fixture = await preparedRun();
    const failure: ModelAdapter = {
      openSession: () => ({
        respond: () => Promise.reject(new Error("synthetic provider outage")),
      }),
    };
    const firstDeps = dependencies([failure as FakeAdapter, new FakeAdapter(fixture.bundle, 3)]);
    let incomplete: PublishedIncompleteReviewError | undefined;
    try {
      await reviewRun(
        {
          projectRoot: fixture.root,
          runRoot: fixture.runRoot,
          configPath: fixture.configPath,
          performanceAnalysisId: fixture.performance.analysisId,
          allowSpend: true,
        },
        firstDeps.value,
      );
    } catch (error) {
      if (error instanceof PublishedIncompleteReviewError) incomplete = error;
      else throw error;
    }
    expect(incomplete!.result.analysis.reviews[0].status).toBe("provider-error");

    const retryDeps = dependencies(
      [new FakeAdapter(fixture.bundle, 3), new FakeAdapter(fixture.bundle, 3)],
      "retry",
    );
    const completed = await reviewRun(
      {
        projectRoot: fixture.root,
        runRoot: fixture.runRoot,
        configPath: fixture.configPath,
        performanceAnalysisId: fixture.performance.analysisId,
        allowSpend: true,
      },
      retryDeps.value,
    );
    expect(completed.analysis.status).toBe("completed");

    let duplicateConstructions = 0;
    await expect(
      reviewRun(
        {
          projectRoot: fixture.root,
          runRoot: fixture.runRoot,
          configPath: fixture.configPath,
          performanceAnalysisId: fixture.performance.analysisId,
          allowSpend: true,
        },
        {
          ...retryDeps.value,
          createAdapter: () => {
            duplicateConstructions += 1;
            return new FakeAdapter(fixture.bundle, 3);
          },
        },
      ),
    ).rejects.toThrow(/already exists/i);
    expect(duplicateConstructions).toBe(0);
  });

  it("retains budget-boundary responses and makes no further reviewer calls", async () => {
    const fixture = await preparedRun("isolated");
    const first = new FakeAdapter(fixture.bundle, 2, undefined, {
      inputTokens: 250_000,
      outputTokens: 50_001,
    });
    const second = new FakeAdapter(fixture.bundle, 3, undefined, {
      inputTokens: 450_000,
      outputTokens: 50_000,
    });
    const deps = dependencies([first, second]);

    let incomplete: PublishedIncompleteReviewError | undefined;
    try {
      await reviewRun(
        {
          projectRoot: fixture.root,
          runRoot: fixture.runRoot,
          configPath: fixture.configPath,
          performanceAnalysisId: fixture.performance.analysisId,
          allowSpend: true,
        },
        deps.value,
      );
    } catch (error) {
      if (error instanceof PublishedIncompleteReviewError) incomplete = error;
      else throw error;
    }

    expect(incomplete).toBeDefined();
    expect(incomplete!.result.analysis.reviews.map(({ status }) => status)).toEqual([
      "invalid",
      "invalid",
    ]);
    expect(first.prompts).toHaveLength(2);
    expect(second.prompts).toHaveLength(1);
    const firstRaw = await readFile(join(incomplete!.result.path, "judge-1.raw.json"), "utf8");
    expect(firstRaw).toContain('"inputTokens":250000');
    expect(firstRaw).toContain('"outputTokens":50001');
    expect(firstRaw).toMatch(/token limit 500000 was exceeded by the retained response/i);
    const secondRaw = await readFile(join(incomplete!.result.path, "judge-2.raw.json"), "utf8");
    expect(secondRaw).toContain('"inputTokens":450000');
    expect(secondRaw).toMatch(/token limit 500000 was reached; no further provider calls/i);
  });

  it("rejects hidden-state narration while retaining evidence-linked competing episode views", async () => {
    const fixture = await preparedRun();
    const hidden = new FakeAdapter(fixture.bundle, 2, (bundle) =>
      JSON.stringify(
        providerReviewerOutput(
          bundle,
          reviewerOutput(bundle, 2, { hiddenClaim: true, episode: "asserted" }),
        ),
      ),
    );
    const competing = new FakeAdapter(fixture.bundle, 3, (bundle) =>
      JSON.stringify(
        providerReviewerOutput(bundle, reviewerOutput(bundle, 3, { episode: "asserted" })),
      ),
    );
    const deps = dependencies([hidden, competing]);
    await expect(
      reviewRun(
        {
          projectRoot: fixture.root,
          runRoot: fixture.runRoot,
          configPath: fixture.configPath,
          performanceAnalysisId: fixture.performance.analysisId,
          allowSpend: true,
        },
        deps.value,
      ),
    ).rejects.toBeInstanceOf(PublishedIncompleteReviewError);
  });

  it("links cross-agent contribution, uptake, and canonical integration while preserving a competing interpretation", async () => {
    const fixture = await preparedRun();
    const transmission = fixture.bundle.items.find(
      (item) => item.actorId === "actor-1" && item.kind.startsWith("team."),
    )!.reference;
    const uptake = fixture.bundle.items.find(
      (item) => item.actorId === "actor-2" && item.kind === "model.response",
    )!.reference;
    const integration = fixture.bundle.items.find(
      (item) => item.kind === "git.canonical",
    )!.reference;
    const linked = new FakeAdapter(fixture.bundle, 3, (bundle) =>
      JSON.stringify(
        providerReviewerOutput(
          bundle,
          reviewerOutput(bundle, 3, {
            episode: "uptake",
            episodeReferences: { transmission, uptake, integration },
          }),
        ),
      ),
    );
    const assertedOnly = new FakeAdapter(fixture.bundle, 2, (bundle) =>
      JSON.stringify(
        providerReviewerOutput(bundle, reviewerOutput(bundle, 2, { episode: "asserted" })),
      ),
    );
    const deps = dependencies([linked, assertedOnly]);
    const result = await reviewRun(
      {
        projectRoot: fixture.root,
        runRoot: fixture.runRoot,
        configPath: fixture.configPath,
        performanceAnalysisId: fixture.performance.analysisId,
        allowSpend: true,
      },
      deps.value,
    );
    expect(result.analysis.status).toBe("completed");
    expect(JSON.stringify(result.scorecards)).toContain("episode-uptake");
    expect(JSON.stringify(result.scorecards)).toContain("episode-assertion");
  });

  it("publishes one ordered entry per isolated origin with social ratings not applicable", async () => {
    const fixture = await preparedRun("isolated");
    const first = new FakeAdapter(fixture.bundle, 2);
    const second = new FakeAdapter(fixture.bundle, 3);
    const deps = dependencies([first, second]);
    const result = await reviewRun(
      {
        projectRoot: fixture.root,
        runRoot: fixture.runRoot,
        configPath: fixture.configPath,
        performanceAnalysisId: fixture.performance.analysisId,
        allowSpend: true,
      },
      deps.value,
    );
    expect(result.scorecards!.map(({ canonicalOrigins }) => canonicalOrigins[0]!.originId)).toEqual(
      ["agent-1", "agent-2"],
    );
    expect(JSON.stringify(result.scorecards!.map(({ social }) => social))).toContain(
      "not-applicable",
    );
    expect(deps.created).toHaveLength(2);
    expect(deps.created.map(({ apiKeyEnv }) => apiKeyEnv)).toEqual([
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
    ]);
    expect(deps.created.map(({ tokenLimit }) => tokenLimit)).toEqual([500_000, 500_000]);
    expect(deps.created.map(({ maxOutputTokens }) => maxOutputTokens)).toEqual([8_000, 8_000]);
    const windowPrompts = first.prompts.filter((prompt) => prompt.includes("_WINDOW_V1"));
    expect(windowPrompts.every((prompt) => prompt.includes("never return reference objects"))).toBe(
      true,
    );
    const firstOriginPrompts = windowPrompts.filter((prompt) =>
      prompt.includes("Anonymous canonical origin ordinal: 1"),
    );
    const secondOriginPrompts = windowPrompts.filter((prompt) =>
      prompt.includes("Anonymous canonical origin ordinal: 2"),
    );
    expect(firstOriginPrompts.length).toBeGreaterThan(0);
    expect(secondOriginPrompts.length).toBeGreaterThan(0);
    const firstOriginSurface = firstOriginPrompts.join("\n");
    const secondOriginSurface = secondOriginPrompts.join("\n");
    expect(firstOriginSurface).not.toContain('"actorId":"actor-2"');
    expect(secondOriginSurface).not.toContain('"actorId":"actor-1"');
    expect(firstOriginSurface).toContain('"kind":"run.context"');
    expect(secondOriginSurface).toContain('"kind":"run.context"');
    expect(firstOriginSurface).toContain('"repositoryId":"origin-1"');
    expect(firstOriginSurface).toContain("refs/heads/private-one");
    expect(firstOriginSurface).toContain("1".repeat(40));
    expect(firstOriginSurface).not.toContain('"repositoryId":"origin-2"');
    expect(firstOriginSurface).not.toContain("refs/heads/private-two");
    expect(firstOriginSurface).not.toContain("2".repeat(40));
    expect(secondOriginSurface).toContain('"repositoryId":"origin-2"');
    expect(secondOriginSurface).toContain("refs/heads/private-two");
    expect(secondOriginSurface).toContain("2".repeat(40));
    expect(secondOriginSurface).not.toContain('"repositoryId":"origin-1"');
    expect(secondOriginSurface).not.toContain("refs/heads/private-one");
    expect(secondOriginSurface).not.toContain("1".repeat(40));
    const publishedReviews = JSON.parse(
      await readFile(join(result.path, "judge-1.review.json"), "utf8"),
    ) as unknown[];
    expect(publishedReviews.map((review) => decodeJudgeReview(review).status)).toEqual([
      "completed",
      "completed",
    ]);
  });

  it("preserves analyses appended during review instead of overwriting a stale RunRecord", async () => {
    const fixture = await preparedRun();
    const deps = dependencies([
      new FakeAdapter(fixture.bundle, 2),
      new FakeAdapter(fixture.bundle, 3),
    ]);
    const baseInvoke = deps.value.invokePython;
    let injected = false;
    const raced: ReviewDependencies = {
      ...deps.value,
      invokePython: async (...args) => {
        if (!injected) {
          injected = true;
          const latest = await loadRunRecord(fixture.root, fixture.runRoot);
          await appendRunAnalysis(fixture.runRoot, latest.record, {
            analysisId: "process-review-concurrent-incomplete",
            kind: "process-review",
            reviewedAt: "2026-08-02T00:09:00.000Z",
            status: "incomplete",
            performanceAnalysisId: fixture.performance.analysisId,
            rubricVersion: "epistemic-process-v1",
            configurationDigest: fixture.performance.configurationDigest,
            bundleDigest: fixture.bundle.contentDigest,
            detailsPath: "grading/process-review-concurrent-incomplete/manifest.json",
            detailsDigest: "7".repeat(64),
            reviews: [
              {
                reviewId: "review-concurrent-1",
                providerFamily: "openai",
                status: "invalid",
              },
              {
                reviewId: "review-concurrent-2",
                providerFamily: "anthropic",
                status: "invalid",
              },
            ],
          });
        }
        return baseInvoke(...args);
      },
    };
    const result = await reviewRun(
      {
        projectRoot: fixture.root,
        runRoot: fixture.runRoot,
        configPath: fixture.configPath,
        performanceAnalysisId: fixture.performance.analysisId,
        allowSpend: true,
      },
      raced,
    );
    expect(result.record.analyses.map(({ analysisId }) => analysisId)).toContain(
      "process-review-concurrent-incomplete",
    );
  });

  it("fails a final append CAS without discarding paid raw transcripts", async () => {
    const fixture = await preparedRun();
    const deps = dependencies([
      new FakeAdapter(fixture.bundle, 2),
      new FakeAdapter(fixture.bundle, 3),
    ]);
    let injected = false;
    await expect(
      reviewRun(
        {
          projectRoot: fixture.root,
          runRoot: fixture.runRoot,
          configPath: fixture.configPath,
          performanceAnalysisId: fixture.performance.analysisId,
          allowSpend: true,
        },
        {
          ...deps.value,
          appendAnalysis: async (runRoot, expected, analysis) => {
            if (!injected) {
              injected = true;
              const latest = await loadRunRecord(fixture.root, fixture.runRoot);
              await appendRunAnalysis(runRoot, latest.record, {
                analysisId: "process-review-cas-racer",
                kind: "process-review",
                reviewedAt: "2026-08-02T00:09:30.000Z",
                status: "incomplete",
                performanceAnalysisId: fixture.performance.analysisId,
                rubricVersion: "epistemic-process-v1",
                configurationDigest: fixture.performance.configurationDigest,
                bundleDigest: fixture.bundle.contentDigest,
                detailsPath: "grading/process-review-cas-racer/manifest.json",
                detailsDigest: "8".repeat(64),
                reviews: [
                  {
                    reviewId: "review-cas-racer-1",
                    providerFamily: "openai",
                    status: "invalid",
                  },
                  {
                    reviewId: "review-cas-racer-2",
                    providerFamily: "anthropic",
                    status: "invalid",
                  },
                ],
              });
            }
            return appendRunAnalysis(runRoot, expected, analysis);
          },
        },
      ),
    ).rejects.toThrow(/changed before the append/i);
    const latest = await loadRunRecord(fixture.root, fixture.runRoot);
    expect(latest.record.analyses.map(({ analysisId }) => analysisId)).toContain(
      "process-review-cas-racer",
    );
    await expect(
      readFile(
        join(fixture.runRoot, "grading", "process-review-fixed-1", "judge-1.raw.json"),
        "utf8",
      ),
    ).resolves.toContain("fake-reviewer");
  });
});
