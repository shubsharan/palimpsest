import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseExperimentYaml,
  resolveExperimentConfig,
  validateExperimentConfig,
  validateProviderOptions,
} from "./config.js";

function validConfig(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    puzzle: { block: "calibration-theron-ware" },
    limits: { tokenBudgetPerAgent: 200_000 },
    providers: {
      openai: { driver: "openai", apiKeyEnv: "RESEARCH_OPENAI_KEY" },
      anthropic: { driver: "anthropic", apiKeyEnv: "RESEARCH_ANTHROPIC_KEY" },
      google: { driver: "google", apiKeyEnv: "RESEARCH_GOOGLE_KEY" },
      local: {
        driver: "openai-compatible",
        baseURL: "http://127.0.0.1:4000/v1",
      },
    },
    models: {
      gpt: {
        provider: "openai",
        model: "gpt-research",
        settings: { maxOutputTokens: 4096, temperature: 0.2, topP: 0.9, seed: 7 },
      },
      claude: {
        provider: "anthropic",
        model: "claude-research",
        providerOptions: { anthropic: { effort: "low" } },
      },
      gemini: { provider: "google", model: "gemini-research" },
      local: { provider: "local", model: "local-research" },
    },
    runs: [
      { name: "gpt-only", model: "gpt" },
      { name: "mixed", agents: ["gpt", "claude", "gemini"], repetitions: 2 },
    ],
  };
}

describe("experiment configuration", () => {
  it("parses YAML and rejects duplicate keys and aliases", () => {
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

  it("rejects unknown structural fields with a useful path", () => {
    const config = validConfig();
    config.unexpected = true;

    expect(() => validateExperimentConfig(config)).toThrow(/\/unexpected|unexpected/);
  });

  it("resolves the block, defaults, and homogeneous and mixed assignments", async () => {
    const resolved = await resolveExperimentConfig(validConfig(), {
      root: resolve("."),
      selectedRun: "mixed",
      env: {
        RESEARCH_OPENAI_KEY: "openai-secret",
        RESEARCH_ANTHROPIC_KEY: "anthropic-secret",
        RESEARCH_GOOGLE_KEY: "google-secret",
      },
    });

    expect(resolved.puzzle).toEqual({ block: "calibration-theron-ware" });
    expect(resolved.runs).toEqual([
      {
        name: "gpt-only",
        repetitions: 1,
        agents: [
          { agentId: "agent-1", modelProfile: "gpt" },
          { agentId: "agent-2", modelProfile: "gpt" },
          { agentId: "agent-3", modelProfile: "gpt" },
        ],
      },
      {
        name: "mixed",
        repetitions: 2,
        agents: [
          { agentId: "agent-1", modelProfile: "gpt" },
          { agentId: "agent-2", modelProfile: "claude" },
          { agentId: "agent-3", modelProfile: "gemini" },
        ],
      },
    ]);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.runs[0]?.agents)).toBe(true);
    expect(JSON.stringify(resolved)).not.toContain("openai-secret");
    expect(resolved.providers.openai).toEqual({
      driver: "openai",
      apiKeyEnv: "RESEARCH_OPENAI_KEY",
    });
  });

  it.each([
    {
      name: "unknown provider",
      change(config: Record<string, unknown>) {
        (config.models as Record<string, Record<string, unknown>>).gpt!.provider = "missing";
      },
      error: /models\.gpt\.provider.*missing/i,
    },
    {
      name: "unknown run model",
      change(config: Record<string, unknown>) {
        config.runs = [{ name: "broken", model: "missing" }];
      },
      error: /runs\[0\].*missing/i,
    },
    {
      name: "mixed assignment count mismatch",
      change(config: Record<string, unknown>) {
        config.runs = [{ name: "broken", agents: ["gpt", "claude"] }];
      },
      error: /runs\[0\]\.agents.*exactly three/i,
    },
    {
      name: "duplicate run names",
      change(config: Record<string, unknown>) {
        config.runs = [
          { name: "same", model: "gpt" },
          { name: "same", model: "claude" },
        ];
      },
      error: /runs\[1\]\.name.*unique/i,
    },
  ])("rejects $name", async ({ change, error }) => {
    const config = validConfig();
    change(config);
    await expect(resolveExperimentConfig(config, { root: resolve(".") })).rejects.toThrow(error);
  });

  it.each([
    ["puzzle timing", "puzzle", "stageIntervalMs"],
    ["wall-time drift", "limits", "wallTimeMs"],
  ])("rejects obsolete %s configuration", (_name, section, field) => {
    const config = validConfig();
    (config[section] as Record<string, unknown>)[field] = 1;
    expect(() => validateExperimentConfig(config)).toThrow(new RegExp(field));
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

  it("preflights only credentials used by the selected run", async () => {
    await expect(
      resolveExperimentConfig(validConfig(), {
        root: resolve("."),
        selectedRun: "gpt-only",
        env: {},
      }),
    ).rejects.toThrow(/RESEARCH_OPENAI_KEY/);

    await expect(
      resolveExperimentConfig(validConfig(), {
        root: resolve("."),
        selectedRun: "gpt-only",
        env: { RESEARCH_OPENAI_KEY: "present" },
      }),
    ).resolves.toMatchObject({
      providers: {
        anthropic: { apiKeyEnv: "RESEARCH_ANTHROPIC_KEY" },
      },
    });
  });
});
