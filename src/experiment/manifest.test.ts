import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadExperimentManifest,
  loadResolvedExperiment,
  parseDuration,
  parseExperimentYaml,
  resolveExperiment,
  validateExperimentManifest,
  validateProviderOptions,
  validateRunAgainstFixture,
} from "./manifest.js";
import type { ExperimentManifest } from "./contracts.js";
import { derivedFixtureDefinition } from "../fixture/build.js";

const fixture = (name: string): string => resolve("tests", "fixtures", "config", name);

async function validManifest(): Promise<ExperimentManifest> {
  return loadExperimentManifest(fixture("valid.yaml"));
}

describe("experiment manifest", () => {
  it("parses YAML while rejecting duplicate keys and aliases", () => {
    expect(() => parseExperimentYaml("schemaVersion: 2\nschemaVersion: 2\n")).toThrow(
      /map keys must be unique/i,
    );
    expect(() =>
      parseExperimentYaml("schemaVersion: 2\nvalue: &shared { nested: true }\ncopy: *shared\n"),
    ).toThrow(/alias/i);
  });

  it("resolves named runs and derives every non-scientific field", async () => {
    const experiment = resolveExperiment(await validManifest(), resolve("."));
    expect(experiment.runs.map(({ id }) => id)).toEqual(["shared", "isolated-rekey"]);
    expect(experiment.runs[0]).toMatchObject({
      assignment: { "agent-1": "gpt", "agent-2": "gpt", "agent-3": "gpt" },
      capabilities: { git: "shared", teamRoom: "enabled", checker: true },
      schedule: {
        releaseOffsetsMs: [0, 300_000, 600_000, 1_200_000, 1_800_000, 2_400_000],
        cutoffMs: 3_600_000,
      },
      limits: { tokenLimitPerAgent: null, spendCeilingCents: 10_000 },
      fixture: {
        source: "fixtures/corpus/fortunes-fool.txt",
        variant: "stationary",
        rekeyAtStage: null,
      },
    });
    expect(experiment.runs[1]!.fixture.variant).toBe("rekey-stage-4");
    expect(experiment.providers).toEqual({
      openai: { driver: "openai", apiKeyEnv: "OPENAI_API_KEY" },
    });
    expect(experiment.models.gpt).toEqual({
      provider: "openai",
      model: "gpt-research",
      settings: {},
      providerOptions: { openai: { reasoningEffort: "medium" } },
    });
    expect(experiment.totalSpendCeilingCents).toBe(20_000);
    expect(experiment.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(experiment.runs[0]!.labels)).toBe(true);
  });

  it("accepts different run geometry and strict duration units", async () => {
    const run = (await loadResolvedExperiment(fixture("varied.yaml"), resolve("."))).runs[0]!;
    expect(run.assignment).toEqual({ "agent-1": "local", "agent-2": "local" });
    expect(run.schedule).toEqual({ releaseOffsetsMs: [0, 500, 1_500], cutoffMs: 2_500 });
    expect(run.capabilities).toEqual({ git: "isolated", teamRoom: "disabled", checker: false });
    expect(parseDuration("1h", "duration")).toBe(3_600_000);
    expect(() => parseDuration("1.5h", "duration")).toThrow(/integer duration/i);
  });

  it("shares construction identity across stationary and re-keyed realizations", async () => {
    const [stationary, rekey] = resolveExperiment(await validManifest(), resolve(".")).runs;
    expect(stationary!.fixture.constructionId).toBe(rekey!.fixture.constructionId);
    expect(stationary!.fixture.fixtureId).not.toBe(rekey!.fixture.fixtureId);
    expect(stationary!.fixture.packagePath).not.toBe(rekey!.fixture.packagePath);
    expect(derivedFixtureDefinition(stationary!).seed).toBe(derivedFixtureDefinition(rekey!).seed);
  });

  it("treats checker availability as a run input but not a fixture input", async () => {
    const manifest = await validManifest();
    const enabled = resolveExperiment(manifest, resolve("."));
    const disabled = resolveExperiment(
      {
        ...manifest,
        runs: {
          ...manifest.runs,
          shared: { ...manifest.runs.shared!, checker: false },
        },
      },
      resolve("."),
    );

    expect(enabled.runs[0]!.capabilities.checker).toBe(true);
    expect(disabled.runs[0]!.capabilities.checker).toBe(false);
    expect(disabled.runs[0]!.fixture).toEqual(enabled.runs[0]!.fixture);
    expect(disabled.manifestDigest).not.toBe(enabled.manifestDigest);
  });

  it("derives stable package identities from source bytes and geometry", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "palimpsest-manifest-"));
    try {
      const manifest = await validManifest();
      const withSource = (
        agents = 3,
        releases = manifest.runs.shared!.releases,
      ): ExperimentManifest => ({
        ...manifest,
        runs: {
          shared: { ...manifest.runs.shared!, source: "fixtures/source.txt", agents, releases },
        },
      });
      await mkdir(resolve(root, "fixtures"));
      await writeFile(resolve(root, "fixtures/source.txt"), "first source\n", "utf8");
      const first = resolveExperiment(withSource(), root).runs[0]!.fixture;
      expect(resolveExperiment(withSource(), root).runs[0]!.fixture.constructionId).toBe(
        first.constructionId,
      );
      await writeFile(resolve(root, "fixtures/source.txt"), "changed source\n", "utf8");
      expect(resolveExperiment(withSource(), root).runs[0]!.fixture.constructionId).not.toBe(
        first.constructionId,
      );
      await writeFile(resolve(root, "fixtures/source.txt"), "first source\n", "utf8");
      expect(resolveExperiment(withSource(4), root).runs[0]!.fixture.constructionId).not.toBe(
        first.constructionId,
      );
      expect(
        resolveExperiment(withSource(3, manifest.runs.shared!.releases.slice(0, -1)), root).runs[0]!
          .fixture.constructionId,
      ).not.toBe(first.constructionId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads the checked-in minimal preset", async () => {
    const experiment = await loadResolvedExperiment(resolve("experiments/config.yaml"));
    expect(experiment.name).toBe("theron-ware-unlimited-1h");
    expect(experiment.runs.map(({ id }) => id)).toEqual(["shared"]);
    expect(experiment.runs[0]!.assignment).toHaveProperty("agent-3", "sol");
  });

  it("validates resolved runs against realized fixture metadata", async () => {
    const run = resolveExperiment(await validManifest()).runs[0]!;
    const metadata = {
      agentIds: ["agent-1", "agent-2", "agent-3"] as const,
      stageCount: 6,
      variants: { stationary: {} },
    };
    expect(() => validateRunAgainstFixture(run, metadata)).not.toThrow();
    expect(() =>
      validateRunAgainstFixture(
        { ...run, assignment: { "agent-1": "gpt", "agent-2": "gpt" } },
        metadata,
      ),
    ).toThrow(/exactly the fixture agents/i);
    expect(() =>
      validateRunAgainstFixture(
        { ...run, schedule: { releaseOffsetsMs: [0, 1], cutoffMs: 2 } },
        metadata,
      ),
    ).toThrow(/exactly 6 stage offsets/i);
  });

  it.each([
    ["schedule-drift.yaml", /strictly increasing/i],
    ["duplicate-run-id.yaml", /map keys must be unique/i],
    ["secret-bearing.yaml", /apiKey|additional properties|invalid/i],
    ["secret-label.yaml", /labels|additional properties|invalid/i],
    ["ceiling-overflow.yaml", /sum of run spend ceilings.*safe integer/i],
  ])("rejects the %s fixture", async (name, error) => {
    await expect(
      loadExperimentManifest(fixture(name)).then((manifest) => resolveExperiment(manifest)),
    ).rejects.toThrow(error);
  });

  it("rejects legacy and unknown authored fields", async () => {
    const manifest = await validManifest();
    expect(() => validateExperimentManifest({ ...manifest, schemaVersion: 1 })).toThrow(
      /schemaVersion/i,
    );
    expect(() => validateExperimentManifest({ ...manifest, fixtures: [] })).toThrow(/fixtures/i);
    expect(() => validateExperimentManifest({ ...manifest, runs: [] })).toThrow(/runs/i);
    expect(() =>
      validateExperimentManifest({
        ...manifest,
        runs: { ...manifest.runs, shared: { ...manifest.runs.shared!, checker: "disabled" } },
      }),
    ).toThrow(/checker/i);
    expect(() =>
      validateExperimentManifest({
        ...manifest,
        runs: { ...manifest.runs, extra: { ...manifest.runs.shared, wordCount: 18_000 } },
      }),
    ).toThrow(/wordCount/i);
  });

  it("rejects unknown models, unsafe paths, re-key overflow, and spend overflow", async () => {
    const manifest = await validManifest();
    expect(() =>
      resolveExperiment({
        ...manifest,
        runs: { ...manifest.runs, shared: { ...manifest.runs.shared!, model: "missing" } },
      }),
    ).toThrow(/unknown model/i);
    expect(() =>
      validateExperimentManifest({
        ...manifest,
        runs: { ...manifest.runs, shared: { ...manifest.runs.shared!, source: "../outside.txt" } },
      }),
    ).toThrow(/source/i);
    expect(() =>
      resolveExperiment({
        ...manifest,
        runs: { ...manifest.runs, shared: { ...manifest.runs.shared!, rekeyAtStage: 7 } },
      }),
    ).toThrow(/rekeyAtStage exceeds/i);
  });

  it("defensively rejects secret-bearing provider options", () => {
    expect(() => validateProviderOptions({ nested: { clientSecret: "literal" } })).toThrow(
      /secret-bearing/i,
    );
  });
});
