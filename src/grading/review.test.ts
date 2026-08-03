import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contentDigest } from "../canonical.js";
import type {
  JsonObject,
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
import type { ReviewPacket } from "./packets.js";

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

function providerPacketOutput(
  packet: ReviewPacket,
  bundle: EvidenceBundle,
  output: ReviewerOutput,
): unknown {
  const citationId = (reference: EvidenceReference): string => {
    const evidenceId = bundle.items.find(
      (item) => JSON.stringify(item.reference) === JSON.stringify(reference),
    )?.evidenceId;
    return (
      packet.citations.find((citation) => citation.evidenceId === evidenceId)?.citationId ?? "c9999"
    );
  };
  const citationIds = (references: readonly EvidenceReference[]) => references.map(citationId);
  const dimensions = output.dimensions.filter(({ ledger }) => ledger === packet.ledger);
  return {
    schemaVersion: 1,
    rubricVersion: output.rubricVersion,
    bundleDigest: output.bundleDigest,
    packetId: packet.packetId,
    packetDigest: packet.contentDigest,
    ledger: packet.ledger,
    dimensions: Object.fromEntries(
      dimensions.map(({ dimensionId, ledger: _ledger, evidence, counterevidence, ...item }) => [
        dimensionId,
        {
          ...item,
          evidenceIds: citationIds(evidence),
          counterevidenceIds: citationIds(counterevidence),
        },
      ]),
    ),
    ...(packet.ledger === "epistemic"
      ? {
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
              evidenceIds: citationIds(evidence),
              commitmentIds: citationIds(commitment),
              testIds: citationIds(test),
              revisionIds: citationIds(revision),
              transmissionIds: citationIds(transmission),
              uptakeIds: citationIds(uptake),
              integrationIds: citationIds(integration),
              counterevidenceIds: citationIds(counterevidence),
            }),
          ),
        }
      : {}),
    cautions: output.overallCautions,
  };
}

function expectPortableStructuredOutputSchema(schema: JsonObject): void {
  const unsupported = new Set([
    "allOf",
    "oneOf",
    "not",
    "dependentRequired",
    "dependentSchemas",
    "if",
    "then",
    "else",
  ]);
  let propertyCount = 0;
  let enumCount = 0;
  let stringBudget = 0;

  const visit = (value: unknown, path: string, depth: number): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${String(index)}]`, depth));
      return;
    }
    if (value === null || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    for (const keyword of unsupported) expect(item).not.toHaveProperty(keyword);
    if (Object.hasOwn(item, "const")) expect(item, path).toHaveProperty("type");

    if (item.type === "object") {
      expect(item.additionalProperties, path).toBe(false);
      expect(item.properties, path).toBeTypeOf("object");
      const properties = item.properties as Record<string, unknown>;
      const names = Object.keys(properties);
      expect(item.required, path).toEqual(names);
      propertyCount += names.length;
      stringBudget += names.reduce((total, name) => total + name.length, 0);
      for (const [name, property] of Object.entries(properties)) {
        visit(property, `${path}.properties.${name}`, depth + 1);
      }
    }
    if (item.type === "array") visit(item.items, `${path}.items`, depth);
    if (Array.isArray(item.anyOf)) {
      item.anyOf.forEach((branch, index) =>
        visit(branch, `${path}.anyOf[${String(index)}]`, depth),
      );
    }
    if (item.$defs !== undefined) {
      const definitions = item.$defs as Record<string, unknown>;
      stringBudget += Object.keys(definitions).reduce((total, name) => total + name.length, 0);
      for (const [name, definition] of Object.entries(definitions)) {
        visit(definition, `${path}.$defs.${name}`, depth);
      }
    }
    if (Array.isArray(item.enum)) {
      enumCount += item.enum.length;
      const enumStringSize = item.enum.reduce(
        (total: number, entry: unknown) => total + (typeof entry === "string" ? entry.length : 0),
        0,
      );
      if (item.enum.length > 250) expect(enumStringSize, path).toBeLessThanOrEqual(15_000);
      stringBudget += enumStringSize;
    }
    if (typeof item.const === "string") stringBudget += item.const.length;
    expect(depth, path).toBeLessThanOrEqual(10);
  };

  expect(schema.type).toBe("object");
  expect(schema).not.toHaveProperty("anyOf");
  visit(schema, "$", 1);
  expect(propertyCount).toBeLessThanOrEqual(5_000);
  expect(enumCount).toBeLessThanOrEqual(1_000);
  expect(stringBudget).toBeLessThanOrEqual(120_000);
}

class FakeAdapter implements ModelAdapter {
  readonly prompts: string[] = [];
  readonly structuredOutputs: NonNullable<ModelRequest["structuredOutput"]>[] = [];
  readonly #bundle: EvidenceBundle;
  readonly #rating: 0 | 1 | 2 | 3 | 4;
  readonly #packet: (bundle: EvidenceBundle, rating: 0 | 1 | 2 | 3 | 4, prompt: string) => string;
  readonly #usage: TokenUsage;
  readonly #identity: (call: number) => NonNullable<ModelTurn["responseIdentity"]>;
  readonly #failureAtCall: number | undefined;

  constructor(
    bundle: EvidenceBundle,
    rating: 0 | 1 | 2 | 3 | 4,
    packet = (value: EvidenceBundle, score: 0 | 1 | 2 | 3 | 4, prompt: string) => {
      const reviewPacket = JSON.parse(prompt.split("Packet: ")[1]!) as ReviewPacket;
      const evidenceId = reviewPacket.citations[0]!.evidenceId;
      const reference = value.items.find((item) => item.evidenceId === evidenceId)!.reference;
      return JSON.stringify(
        providerPacketOutput(reviewPacket, value, reviewerOutput(value, score, { reference })),
      );
    },
    usage: TokenUsage = { inputTokens: 10, outputTokens: 10 },
    identity: (call: number) => NonNullable<ModelTurn["responseIdentity"]> = () => ({
      actualProvider: "fake",
      actualModel: "fake-reviewer",
    }),
    failureAtCall?: number,
  ) {
    this.#bundle = bundle;
    this.#rating = rating;
    this.#packet = packet;
    this.#usage = usage;
    this.#identity = identity;
    this.#failureAtCall = failureAtCall;
  }

  openSession(_context: ModelSessionContext) {
    return {
      respond: async (request: ModelRequest): Promise<ModelTurn> => {
        const prompt = request.prompt ?? "";
        this.prompts.push(prompt);
        if (this.prompts.length === this.#failureAtCall) {
          throw new Error(`synthetic provider outage at call ${String(this.prompts.length)}`);
        }
        if (request.structuredOutput === undefined) {
          throw new Error("Review requests require structured output.");
        }
        this.structuredOutputs.push(request.structuredOutput);
        return {
          toolCalls: [],
          finalResponse: this.#packet(this.#bundle, this.#rating, prompt),
          usage: this.#usage,
          responseIdentity: this.#identity(this.prompts.length),
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
  it("runs three ledger packets independently and publishes separate ratings", async () => {
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
    expect(first.prompts).toHaveLength(3);
    expect(second.prompts).toHaveLength(3);
    expect(first.prompts.every((prompt) => prompt.includes("LEDGER_PACKET_V1"))).toBe(true);
    expect(first.prompts.join("\n")).not.toContain("INTEGRATION_V1");
    expect(first.structuredOutputs.map(({ name }) => name)).toEqual([
      "palimpsest_epistemic_packet",
      "palimpsest_social_packet",
      "palimpsest_instrumental_packet",
    ]);
    first.structuredOutputs.forEach(({ schema }) => expectPortableStructuredOutputSchema(schema));
    const schemas = first.structuredOutputs.map(({ schema }) => JSON.stringify(schema));
    expect(schemas[0]).toContain('"$ref":"#/$defs/citationId"');
    expect(schemas[0]).toContain('"c001"');
    expect(schemas[0]).not.toContain(fixture.bundle.items[0]!.evidenceId);
    expect(schemas.join("\n")).toContain('"anyOf"');
    expect(schemas.join("\n")).not.toContain('"oneOf"');
    for (const { dimensionId } of EPISTEMIC_PROCESS_RUBRIC.dimensions) {
      expect(schemas.join("\n")).toContain(`"${dimensionId}"`);
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
      "packet-epistemic",
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

  it("rejects a citation ID outside the exact ledger packet", async () => {
    const fixture = await preparedRun();
    const invalid = new FakeAdapter(fixture.bundle, 2, (bundle, rating, prompt) => {
      const packet = JSON.parse(prompt.split("Packet: ")[1]!) as ReviewPacket;
      const output = providerPacketOutput(packet, bundle, reviewerOutput(bundle, rating));
      const dimensions = (output as { dimensions: Record<string, { evidenceIds: string[] }> })
        .dimensions;
      dimensions[Object.keys(dimensions)[0]!]!.evidenceIds = ["c9999"];
      return JSON.stringify(output);
    });
    const deps = dependencies([invalid, new FakeAdapter(fixture.bundle, 3)]);

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
    ).resolves.toContain("outside the exact packet");
  });

  it("preserves invalid citations and malformed packet output as incomplete analyses", async () => {
    const fixture = await preparedRun();
    const invalid = new FakeAdapter(fixture.bundle, 2, (bundle, rating, prompt) => {
      const packet = JSON.parse(prompt.split("Packet: ")[1]!) as ReviewPacket;
      const output = providerPacketOutput(packet, bundle, reviewerOutput(bundle, rating));
      const dimensions = (output as { dimensions: Record<string, { evidenceIds: string[] }> })
        .dimensions;
      dimensions[Object.keys(dimensions)[0]!]!.evidenceIds = ["c9999"];
      return JSON.stringify(output);
    });
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
    expect(rawInvalid).toContain("outside the exact packet");
    expect(rawInvalid).toContain("c9999");
    await expect(
      readFile(join(published!.result.path, "scorecard.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("retains provider failure and resumes only missing packets from an immutable predecessor", async () => {
    const fixture = await preparedRun();
    const failedMiddle = new FakeAdapter(fixture.bundle, 2, undefined, undefined, undefined, 2);
    const firstDeps = dependencies([failedMiddle, new FakeAdapter(fixture.bundle, 3)]);
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
    expect(failedMiddle.prompts).toHaveLength(3);
    const predecessorManifest = await readFile(
      join(incomplete!.result.path, "manifest.json"),
      "utf8",
    );

    const resumedFirst = new FakeAdapter(fixture.bundle, 3);
    const resumedSecond = new FakeAdapter(fixture.bundle, 3);
    const retryDeps = dependencies([resumedFirst, resumedSecond], "retry");
    const completed = await reviewRun(
      {
        projectRoot: fixture.root,
        runRoot: fixture.runRoot,
        configPath: fixture.configPath,
        performanceAnalysisId: fixture.performance.analysisId,
        allowSpend: true,
        resumeAnalysisId: incomplete!.result.analysis.analysisId,
      },
      retryDeps.value,
    );
    expect(completed.analysis.status).toBe("completed");
    expect(completed.analysis.resumedFromAnalysisId).toBe(incomplete!.result.analysis.analysisId);
    expect(resumedFirst.prompts).toHaveLength(1);
    expect(resumedSecond.prompts).toHaveLength(0);
    await expect(readFile(join(incomplete!.result.path, "manifest.json"), "utf8")).resolves.toBe(
      predecessorManifest,
    );
    await expect(readFile(join(completed.path, "judge-2.raw.json"), "utf8")).resolves.toContain(
      '"cumulativeTokens":60',
    );

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

  it("retains response diagnostics and stops a reviewer when usage is unavailable", async () => {
    const fixture = await preparedRun();
    let calls = 0;
    const missingUsage: ModelAdapter = {
      openSession: () => ({
        respond: async (request): Promise<ModelTurn> => {
          calls += 1;
          const prompt = request.prompt ?? "";
          const packet = JSON.parse(prompt.split("Packet: ")[1]!) as ReviewPacket;
          const responseText = JSON.stringify(
            providerPacketOutput(packet, fixture.bundle, reviewerOutput(fixture.bundle, 2)),
          );
          return {
            toolCalls: [],
            finalResponse: responseText,
            responseText,
            finishReason: "stop",
            rawFinishReason: "completed-without-usage",
            responseId: "response-without-usage",
            responseIdentity: { actualProvider: "fake", actualModel: "fake-reviewer" },
            usageUnavailable: true,
            structuredOutputValidation: { status: "validated" },
          };
        },
      }),
    };
    const deps = dependencies([missingUsage as FakeAdapter, new FakeAdapter(fixture.bundle, 3)]);

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

    expect(calls).toBe(1);
    expect(incomplete!.result.analysis.reviews[0].status).toBe("invalid");
    const transcript = await readFile(join(incomplete!.result.path, "judge-1.raw.json"), "utf8");
    expect(transcript).toContain('"classification":"usage-unavailable"');
    expect(transcript).toContain('"usage":{"status":"unavailable"}');
    expect(transcript).toContain('"responseId":"response-without-usage"');
    expect(transcript).toContain('"textReturned":true');
  });

  it("retains stable classifications for distinct provider and output failures", async () => {
    const fixture = await preparedRun();
    const response = (
      responseText: string,
      finishReason: NonNullable<ModelTurn["finishReason"]> = "stop",
      structuredOutputValidation: NonNullable<ModelTurn["structuredOutputValidation"]> = {
        status: "invalid",
        error: "synthetic structured output failure",
      },
    ): ModelTurn => ({
      toolCalls: [],
      finalResponse: responseText,
      responseText,
      finishReason,
      rawFinishReason: `raw-${finishReason}`,
      responseId: `response-${finishReason}`,
      responseIdentity: { actualProvider: "fake", actualModel: "fake-reviewer" },
      usage: { inputTokens: 1, outputTokens: 1 },
      structuredOutputValidation,
    });
    const scenarios: readonly [string, Error | ModelTurn][] = [
      ["overloaded", new Error("provider overloaded")],
      ["refusal", new Error("provider refused the request")],
      ["provider-error", new Error("socket closed")],
      ["empty-output", response("")],
      ["finish-length", response("partial", "length")],
      ["finish-content-filter", response("filtered", "content-filter")],
      ["malformed-json", response("not-json")],
      ["schema-invalid", response('{"unexpected":true}')],
    ];

    for (const [index, [classification, outcome]] of scenarios.entries()) {
      const adapter: ModelAdapter = {
        openSession: () => ({
          respond: () =>
            outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome),
        }),
      };
      const deps = dependencies(
        [adapter as FakeAdapter, new FakeAdapter(fixture.bundle, 3)],
        `failure-${String(index + 1)}`,
      );
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
      await expect(
        readFile(join(incomplete!.result.path, "judge-1.raw.json"), "utf8"),
      ).resolves.toContain(`"classification":"${classification}"`);
    }
  });

  it("leaves a reviewer incomplete when actual identity drifts across packets", async () => {
    const fixture = await preparedRun();
    const drifting = new FakeAdapter(
      fixture.bundle,
      2,
      undefined,
      { inputTokens: 10, outputTokens: 10 },
      (call) => ({ actualProvider: "fake", actualModel: call === 1 ? "served-a" : "served-b" }),
    );
    const deps = dependencies([drifting, new FakeAdapter(fixture.bundle, 3)]);

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

    expect(drifting.prompts).toHaveLength(3);
    expect(incomplete!.result.analysis.reviews[0].status).toBe("invalid");
    await expect(
      readFile(join(incomplete!.result.path, "judge-1.raw.json"), "utf8"),
    ).resolves.toContain("inconsistent actual provider or model identities");
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
    const hidden = new FakeAdapter(fixture.bundle, 2, (bundle, _rating, prompt) => {
      const packet = JSON.parse(prompt.split("Packet: ")[1]!) as ReviewPacket;
      return JSON.stringify(
        providerPacketOutput(
          packet,
          bundle,
          reviewerOutput(bundle, 2, { hiddenClaim: true, episode: "asserted" }),
        ),
      );
    });
    const competing = new FakeAdapter(fixture.bundle, 3, (bundle, _rating, prompt) => {
      const packet = JSON.parse(prompt.split("Packet: ")[1]!) as ReviewPacket;
      return JSON.stringify(
        providerPacketOutput(packet, bundle, reviewerOutput(bundle, 3, { episode: "asserted" })),
      );
    });
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
    const linked = new FakeAdapter(fixture.bundle, 3, (bundle, _rating, prompt) => {
      const packet = JSON.parse(prompt.split("Packet: ")[1]!) as ReviewPacket;
      return JSON.stringify(
        providerPacketOutput(
          packet,
          bundle,
          reviewerOutput(bundle, 3, {
            episode: "uptake",
            episodeReferences: { transmission, uptake, integration },
          }),
        ),
      );
    });
    const assertedOnly = new FakeAdapter(fixture.bundle, 2, (bundle, _rating, prompt) => {
      const packet = JSON.parse(prompt.split("Packet: ")[1]!) as ReviewPacket;
      return JSON.stringify(
        providerPacketOutput(packet, bundle, reviewerOutput(bundle, 2, { episode: "asserted" })),
      );
    });
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
    expect(first.prompts).toHaveLength(4);
    expect(first.prompts.every((prompt) => !prompt.includes("Ledger: social"))).toBe(true);
    const packetPrompts = first.prompts.filter((prompt) => prompt.includes("LEDGER_PACKET_V1"));
    expect(packetPrompts.every((prompt) => prompt.includes("Never return reference objects"))).toBe(
      true,
    );
    expect(packetPrompts.every((prompt) => prompt.includes("at most six"))).toBe(true);
    expect(first.prompts.at(-1)).toContain("reserve enough output budget to complete it");
    const firstOriginPrompts = packetPrompts.filter((prompt) =>
      prompt.includes("Anonymous canonical origin ordinal: 1"),
    );
    const secondOriginPrompts = packetPrompts.filter((prompt) =>
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
