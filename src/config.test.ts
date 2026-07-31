import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  expandPhase,
  loadResolvedStudy,
  loadStudyManifest,
  parseStudyYaml,
  resolveStudy,
  validateProviderOptions,
  validateStudyManifest,
  type StudyManifest,
} from "./config.js";

const fixture = (name: string): string => resolve("tests", "fixtures", "config", name);

async function validManifest(): Promise<StudyManifest> {
  return loadStudyManifest(fixture("valid.yaml"));
}

describe("study manifest", () => {
  it("parses YAML while rejecting duplicate keys and aliases", () => {
    expect(() =>
      parseStudyYaml(`
schemaVersion: 5
schemaVersion: 5
`),
    ).toThrow(/map keys must be unique/i);

    expect(() =>
      parseStudyYaml(`
schemaVersion: 5
value: &shared { nested: true }
copy: *shared
`),
    ).toThrow(/alias/i);
  });

  it("resolves the exact five-block matrix without reading credentials", async () => {
    const study = await resolveStudy(await validManifest(), resolve("."));

    expect(study.assignment).toEqual([
      { agentId: "agent-1", modelProfileId: "gpt" },
      { agentId: "agent-2", modelProfileId: "claude" },
      { agentId: "agent-3", modelProfileId: "gemini" },
    ]);
    expect(study.communication).toEqual({ teamChannel: "disabled" });
    expect(
      expandPhase(study, "calibration").map(({ blockId, condition }) => [blockId, condition]),
    ).toEqual([
      ["calibration-odd-women", "CS"],
      ["calibration-odd-women", "CR"],
      ["calibration-odd-women", "IR"],
      ["calibration-odd-women", "IS"],
    ]);
    expect(
      expandPhase(study, "validation").map(({ blockId, condition }) => [blockId, condition]),
    ).toEqual([
      ["validation-pointed-firs", "CS"],
      ["validation-pointed-firs", "CR"],
      ["validation-pointed-firs", "IR"],
      ["validation-pointed-firs", "IS"],
      ["validation-custom-country", "CR"],
      ["validation-custom-country", "IS"],
      ["validation-custom-country", "CS"],
      ["validation-custom-country", "IR"],
      ["validation-woodlanders", "IS"],
      ["validation-woodlanders", "IR"],
      ["validation-woodlanders", "CR"],
      ["validation-woodlanders", "CS"],
      ["validation-silas-lapham", "IR"],
      ["validation-silas-lapham", "CS"],
      ["validation-silas-lapham", "IS"],
      ["validation-silas-lapham", "CR"],
    ]);
    expect(study.calibrationCells.map((cell) => cell.phasePosition)).toEqual([1, 2, 3, 4]);
    expect(study.validationCells.map((cell) => cell.phasePosition)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1),
    );
    expect(study.validationCells[4]).toMatchObject({
      cellId: "validation-5-validation-custom-country-CR",
      conditionOrderPosition: 1,
    });
    expect(study.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(study.immutableManifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(study.immutableManifest.budgets).toEqual({
      totalTokenCeiling: 15_000_000,
      totalMonetaryCeilingCents: 250_000,
    });
    expect(study.immutableManifest.communication).toEqual({ teamChannel: "disabled" });
    expect(study.rubricPath).toBe(fixture("behavior-rubric.md"));
    expect(study.providers.openai).toEqual({
      driver: "openai",
      apiKeyEnv: "RESEARCH_OPENAI_KEY",
    });
    expect(JSON.stringify(study)).not.toContain("secret");
    expect(Object.isFrozen(study)).toBe(true);
    expect(Object.isFrozen(study.validationCells)).toBe(true);
  });

  it("loads and verifies the checked-in manifest and rubric", async () => {
    const study = await loadResolvedStudy(resolve("experiments", "config.yaml"), resolve("."));

    expect(study.blocks).toHaveLength(5);
    expect(study.calibrationCells).toHaveLength(4);
    expect(study.validationCells).toHaveLength(16);
    expect(study.rubric.rubricId).toBe("palimpsest-behavior-review-v1");
  });

  it("changes only the complete manifest digest for either adjustable budget", async () => {
    const baseline = await validManifest();
    const tokenAdjustment = structuredClone(baseline);
    tokenAdjustment.budgets.tokenBudgetPerAgent = 210_000;
    const monetaryAdjustment = structuredClone(baseline);
    monetaryAdjustment.budgets.perAttemptMonetaryCeilingCents = 11_000;

    const [original, changedTokens, changedMoney] = await Promise.all([
      resolveStudy(baseline, resolve(".")),
      resolveStudy(tokenAdjustment, resolve(".")),
      resolveStudy(monetaryAdjustment, resolve(".")),
    ]);

    expect(changedTokens.manifestDigest).not.toBe(original.manifestDigest);
    expect(changedMoney.manifestDigest).not.toBe(original.manifestDigest);
    expect(changedTokens.immutableManifestDigest).toBe(original.immutableManifestDigest);
    expect(changedMoney.immutableManifestDigest).toBe(original.immutableManifestDigest);
  });

  it("accepts alternate valid clocks and freezes them into the resolved study", async () => {
    const manifest = structuredClone(await validManifest());
    manifest.schedule.releaseOffsetsMs = [0, 1_000, 2_500, 4_000, 7_500, 9_000];
    manifest.schedule.cutoffMs = 12_000;

    const study = await resolveStudy(manifest, resolve("."));

    expect(study.schedule).toEqual({
      releaseOffsetsMs: [0, 1_000, 2_500, 4_000, 7_500, 9_000],
      cutoffMs: 12_000,
    });
    expect(Object.isFrozen(study.schedule)).toBe(true);
    expect(Object.isFrozen(study.schedule.releaseOffsetsMs)).toBe(true);
  });

  it("accepts an explicitly disabled token policy while keeping monetary authorization", async () => {
    const manifest = structuredClone(await validManifest());
    manifest.budgets.tokenBudgetPerAgent = null;
    manifest.budgets.totalTokenCeiling = null;

    const study = await resolveStudy(manifest, resolve("."));

    expect(study.budgets).toMatchObject({
      tokenBudgetPerAgent: null,
      totalTokenCeiling: null,
      perAttemptMonetaryCeilingCents: 10_000,
      totalMonetaryCeilingCents: 250_000,
    });
  });

  it("rejects partially disabled token policies", async () => {
    const missingTotal = structuredClone(await validManifest());
    missingTotal.budgets.tokenBudgetPerAgent = null;
    expect(() => resolveStudy(missingTotal, resolve("."))).rejects.toThrow(
      /tokenBudgetPerAgent.*totalTokenCeiling|both be numeric or both be null/i,
    );

    const missingPerAgent = structuredClone(await validManifest());
    missingPerAgent.budgets.totalTokenCeiling = null;
    expect(() => resolveStudy(missingPerAgent, resolve("."))).rejects.toThrow(
      /tokenBudgetPerAgent.*totalTokenCeiling|both be numeric or both be null/i,
    );
  });

  it("changes the immutable digest when any scientific field changes", async () => {
    const baseline = await validManifest();
    const changed = structuredClone(baseline);
    changed.models.gpt!.model = "different-model";

    const [original, drifted] = await Promise.all([
      resolveStudy(baseline, resolve(".")),
      resolveStudy(changed, resolve(".")),
    ]);

    expect(drifted.manifestDigest).not.toBe(original.manifestDigest);
    expect(drifted.immutableManifestDigest).not.toBe(original.immutableManifestDigest);
  });

  it("requires and binds an explicit team-channel mode", async () => {
    const baseline = await validManifest();
    const enabled = structuredClone(baseline);
    enabled.communication.teamChannel = "enabled";
    const [disabledStudy, enabledStudy] = await Promise.all([
      resolveStudy(baseline, resolve(".")),
      resolveStudy(enabled, resolve(".")),
    ]);

    expect(enabledStudy.communication.teamChannel).toBe("enabled");
    expect(enabledStudy.manifestDigest).not.toBe(disabledStudy.manifestDigest);
    expect(enabledStudy.immutableManifestDigest).not.toBe(disabledStudy.immutableManifestDigest);

    const { communication: _, ...missing } = baseline;
    expect(() => validateStudyManifest(missing)).toThrow(/communication|invalid/i);
    expect(() =>
      validateStudyManifest({
        ...baseline,
        communication: { teamChannel: "sometimes" },
      }),
    ).toThrow(/teamChannel|invalid/i);
  });

  it.each([
    ["schema-v1-runs.yaml", /schemaVersion|unsupported|invalid/i],
    ["schedule-drift.yaml", /releaseOffsetsMs|invalid/i],
    ["order-drift.yaml", /condition orders/i],
    ["secret-bearing.yaml", /secret-bearing provider option/i],
    ["ceiling-overflow.yaml", /totalTokenCeiling/i],
  ])("rejects the %s fixture", async (name, error) => {
    await expect(
      loadStudyManifest(fixture(name)).then((manifest) => resolveStudy(manifest, resolve("."))),
    ).rejects.toThrow(error);
  });

  it("rejects compatibility and unknown structural fields", async () => {
    const manifest = await validManifest();

    expect(() => validateStudyManifest({ ...manifest, schemaVersion: 1 })).toThrow(
      /schemaVersion|invalid/i,
    );
    expect(() => validateStudyManifest({ ...manifest, runs: [] })).toThrow(/runs|invalid/i);
    expect(() => validateStudyManifest({ ...manifest, unexpected: true })).toThrow(
      /unexpected|invalid/i,
    );
  });

  it("rejects reordered blocks, assignments, and failure-policy drift", async () => {
    const reorderedBlocks = structuredClone(await validManifest());
    [reorderedBlocks.blocks[1], reorderedBlocks.blocks[2]] = [
      reorderedBlocks.blocks[2]!,
      reorderedBlocks.blocks[1]!,
    ];
    expect(() => validateStudyManifest(reorderedBlocks)).toThrow(/blocks|invalid/i);

    const reorderedAssignment = structuredClone(await validManifest());
    [reorderedAssignment.assignment[0], reorderedAssignment.assignment[1]] = [
      reorderedAssignment.assignment[1]!,
      reorderedAssignment.assignment[0]!,
    ];
    expect(() => validateStudyManifest(reorderedAssignment)).toThrow(/assignment|invalid/i);

    const manifest = await validManifest();
    const changedFailurePolicy = {
      ...manifest,
      failurePolicy: { ...manifest.failurePolicy, automaticRetry: true },
    };
    expect(() => validateStudyManifest(changedFailurePolicy)).toThrow(/automaticRetry|invalid/i);
  });

  it("checks token and monetary primary authorization independently", async () => {
    const manifest = structuredClone(await validManifest());
    manifest.budgets.totalMonetaryCeilingCents = 39_999;

    await expect(resolveStudy(manifest, resolve("."))).rejects.toThrow(
      /totalMonetaryCeilingCents/i,
    );
  });

  it.each([
    {
      name: "unknown model provider",
      change(manifest: StudyManifest) {
        manifest.models.gpt!.provider = "missing";
      },
      error: /models\.gpt\.provider.*missing/i,
    },
    {
      name: "unknown assigned model profile",
      change(manifest: StudyManifest) {
        manifest.assignment[1]!.modelProfileId = "missing";
      },
      error: /assignment\[1\].*missing/i,
    },
    {
      name: "credential-bearing provider URL",
      change(manifest: StudyManifest) {
        const provider = manifest.providers.local!;
        if (provider.driver === "openai-compatible") {
          provider.baseURL = "https://literal:secret@example.invalid/v1";
        }
      },
      error: /baseURL.*literal credentials/i,
    },
    {
      name: "rubric digest mismatch",
      change(manifest: StudyManifest) {
        manifest.rubric.sha256 = "a".repeat(64);
      },
      error: /rubric.*digest/i,
    },
    {
      name: "rubric outside the repository",
      change(manifest: StudyManifest) {
        manifest.rubric.path = "../behavior-rubric.md";
      },
      error: /rubric\.path.*repository/i,
    },
    {
      name: "unsafe token arithmetic",
      change(manifest: StudyManifest) {
        manifest.budgets.tokenBudgetPerAgent = Number.MAX_SAFE_INTEGER;
        manifest.budgets.totalTokenCeiling = Number.MAX_SAFE_INTEGER;
      },
      error: /authorized token total.*safe integer/i,
    },
  ])("rejects $name", async ({ change, error }) => {
    const manifest = structuredClone(await validManifest());
    change(manifest);
    await expect(resolveStudy(manifest, resolve("."))).rejects.toThrow(error);
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
