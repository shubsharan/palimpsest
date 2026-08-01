import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadExperimentManifest,
  loadResolvedExperiment,
  parseExperimentYaml,
  resolveExperiment,
  validateExperimentManifest,
  validateProviderOptions,
  validateRunAgainstFixture,
} from "./manifest.js";
import type { ExperimentManifest } from "./contracts.js";

const fixture = (name: string): string => resolve("tests", "fixtures", "config", name);

async function validManifest(): Promise<ExperimentManifest> {
  return loadExperimentManifest(fixture("valid.yaml"));
}

describe("experiment manifest", () => {
  it("parses YAML while rejecting duplicate keys and aliases", () => {
    expect(() =>
      parseExperimentYaml(`
schemaVersion: 1
schemaVersion: 1
`),
    ).toThrow(/map keys must be unique/i);

    expect(() =>
      parseExperimentYaml(`
schemaVersion: 1
value: &shared { nested: true }
copy: *shared
`),
    ).toThrow(/alias/i);
  });

  it("resolves explicit ordered runs without reading credentials or fixture packages", async () => {
    const experiment = resolveExperiment(await validManifest(), resolve("."));

    expect(experiment.runs.map((run) => run.id)).toEqual(["shared-stationary", "isolated-rekey"]);
    expect(experiment.runs[0]).toMatchObject({
      fixture: {
        packagePath: "tests/fixtures/config/packages/three-agent.json",
        packageRoot: fixture("packages/three-agent.json"),
        variant: "stationary",
      },
      assignment: {
        "agent-1": "gpt",
        "agent-2": "claude",
        "agent-3": "gemini",
      },
      capabilities: { git: "shared", teamRoom: "enabled" },
      limits: { tokenLimitPerAgent: 200_000, spendCeilingCents: 10_000 },
      labels: { cohort: "baseline", replicate: 1 },
    });
    expect(experiment.models.gpt).toEqual({
      provider: "openai",
      model: "gpt-research",
      settings: { maxOutputTokens: 4096, temperature: 0.2, topP: 0.9, seed: 7 },
      providerOptions: {},
    });
    expect(experiment.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(experiment)).not.toContain("RESEARCH_OPENAI_KEY_VALUE");
    expect(Object.isFrozen(experiment)).toBe(true);
    expect(Object.isFrozen(experiment.runs)).toBe(true);
    expect(Object.isFrozen(experiment.runs[0]!.labels)).toBe(true);
  });

  it("accepts a materially different fixture geometry and resource policy", async () => {
    const experiment = await loadResolvedExperiment(fixture("varied.yaml"), resolve("."));
    const run = experiment.runs[0]!;

    expect(run.assignment).toEqual({ "agent-1": "local", "agent-2": "local" });
    expect(run.schedule).toEqual({ releaseOffsetsMs: [0, 500, 1_500], cutoffMs: 2_500 });
    expect(run.limits).toEqual({ tokenLimitPerAgent: null, spendCeilingCents: 0 });
    expect(run.capabilities).toEqual({ git: "isolated", teamRoom: "disabled" });
  });

  it("loads the checked-in explicit-run preset", async () => {
    const experiment = await loadResolvedExperiment(
      resolve("experiments", "config.yaml"),
      resolve("."),
    );

    expect(experiment.runs).toHaveLength(20);
    expect(new Set(experiment.runs.map((run) => run.fixture.packagePath))).toHaveProperty(
      "size",
      5,
    );
    expect(experiment.runs.every((run) => Object.keys(run.assignment).length === 3)).toBe(true);
  });

  it("validates each run against decoded fixture package metadata", async () => {
    const manifest = await validManifest();
    const run = manifest.runs[0]!;
    const metadata = {
      agentIds: ["agent-1", "agent-2", "agent-3"] as const,
      stageCount: 6,
      variants: { stationary: {}, rekey: {} },
    };

    expect(() => validateRunAgainstFixture(run, metadata)).not.toThrow();
    expect(() =>
      validateRunAgainstFixture(
        { ...run, assignment: { "agent-1": "gpt", "agent-2": "claude" } },
        metadata,
      ),
    ).toThrow(/exactly the fixture agents/i);
    expect(() =>
      validateRunAgainstFixture(
        { ...run, fixture: { ...run.fixture, variant: "missing" } },
        metadata,
      ),
    ).toThrow(/unknown fixture variant/i);
    expect(() =>
      validateRunAgainstFixture(
        { ...run, schedule: { releaseOffsetsMs: [0, 1], cutoffMs: 2 } },
        metadata,
      ),
    ).toThrow(/exactly 6 stage offsets/i);
  });

  it.each([
    ["schedule-drift.yaml", /releaseOffsetsMs.*strictly increasing/i],
    ["duplicate-run-id.yaml", /duplicates experiment run id/i],
    ["secret-bearing.yaml", /secret-bearing provider option/i],
    ["secret-label.yaml", /labels.*secret-bearing/i],
    ["ceiling-overflow.yaml", /totalSpendCeilingCents.*run authorization/i],
  ])("rejects the %s fixture", async (name, error) => {
    await expect(
      loadExperimentManifest(fixture(name)).then((manifest) => resolveExperiment(manifest)),
    ).rejects.toThrow(error);
  });

  it("rejects compatibility and unknown structural fields", async () => {
    const manifest = await validManifest();

    expect(() => validateExperimentManifest({ ...manifest, schemaVersion: 4 })).toThrow(
      /schemaVersion|invalid/i,
    );
    expect(() => validateExperimentManifest({ ...manifest, blocks: [] })).toThrow(
      /blocks|invalid/i,
    );
    expect(() => validateExperimentManifest({ ...manifest, runs: [] })).toThrow(/runs|invalid/i);
  });

  it.each([
    {
      name: "unknown model provider",
      change(manifest: ExperimentManifest) {
        manifest.models.gpt!.provider = "missing";
      },
      error: /models\.gpt\.provider.*missing/i,
    },
    {
      name: "unknown assigned model profile",
      change(manifest: ExperimentManifest) {
        manifest.runs[0]!.assignment["agent-2"] = "missing";
      },
      error: /runs\[0\].*agent-2.*missing/i,
    },
    {
      name: "credential-bearing provider URL",
      change(manifest: ExperimentManifest) {
        const provider = manifest.providers.local!;
        if (provider.driver === "openai-compatible") {
          provider.baseURL = "https://literal:secret@example.invalid/v1";
        }
      },
      error: /baseURL.*literal credentials/i,
    },
    {
      name: "fixture outside the repository",
      change(manifest: ExperimentManifest) {
        manifest.runs[0]!.fixture.packagePath = "../fixture.json";
      },
      error: /packagePath.*repository/i,
    },
    {
      name: "unsafe spend arithmetic",
      change(manifest: ExperimentManifest) {
        manifest.totalSpendCeilingCents = Number.MAX_SAFE_INTEGER;
        manifest.runs[0]!.limits.spendCeilingCents = Number.MAX_SAFE_INTEGER;
      },
      error: /sum of run spend ceilings.*safe integer/i,
    },
  ])("rejects $name", async ({ change, error }) => {
    const manifest = structuredClone(await validManifest());
    change(manifest);
    expect(() => resolveExperiment(manifest, resolve("."))).toThrow(error);
  });

  it.each([
    { authorization: "Bearer literal" },
    { nested: { maxRetries: 2 } },
    { anthropic: { fallbacks: [{ model: "other" }] } },
    { nested: { clientSecret: "literal" } },
  ])("rejects secret, call-control, and fallback provider options: %j", (options) => {
    expect(() => validateProviderOptions(options, "models.test.providerOptions")).toThrow(
      /models\.test\.providerOptions/,
    );
  });
});
