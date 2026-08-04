import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";

import { contentDigest } from "../canonical.js";
import { EVIDENCE_COMPILER_VERSION } from "./evidence.js";
import { EPISTEMIC_PROCESS_RUBRIC_VERSION } from "./rubric.js";

export type OfficialProviderFamily = "openai" | "anthropic" | "google";

export interface GradingModelProfile {
  readonly provider: OfficialProviderFamily;
  readonly model: string;
}

export interface GradingReviewerProfile {
  readonly profile: string;
  readonly tokenLimit: number;
  readonly maxOutputTokens: number;
}

export interface GradingConfiguration {
  readonly schemaVersion: 1;
  readonly rubric: typeof EPISTEMIC_PROCESS_RUBRIC_VERSION;
  readonly models: Readonly<Record<string, GradingModelProfile>>;
  readonly reviewers: readonly [GradingReviewerProfile, GradingReviewerProfile];
}

export interface LoadedGradingConfiguration {
  readonly config: GradingConfiguration;
  readonly source: Buffer;
  readonly digest: string;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(value: unknown, required: readonly string[], name: string): Record<string, unknown> {
  const decoded = object(value, name);
  if (Object.keys(decoded).sort().join("\0") !== [...required].sort().join("\0")) {
    throw new Error(`${name} contains unknown or missing fields.`);
  }
  return decoded;
}

function nonEmptyText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function controlledId(value: unknown, name: string): string {
  const result = nonEmptyText(value, name);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(result)) {
    throw new Error(`${name} must be a controlled identifier.`);
  }
  return result;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value as number;
}

function officialProvider(value: unknown, name: string): OfficialProviderFamily {
  if (value !== "openai" && value !== "anthropic" && value !== "google") {
    throw new Error(`${name} must name an official provider family.`);
  }
  return value;
}

export function decodeGradingConfiguration(value: unknown): GradingConfiguration {
  const decoded = exact(
    value,
    ["schemaVersion", "rubric", "models", "reviewers"],
    "Grading config",
  );
  if (decoded.schemaVersion !== 1) throw new Error("Grading config schemaVersion is unsupported.");
  if (decoded.rubric !== EPISTEMIC_PROCESS_RUBRIC_VERSION) {
    throw new Error(`Unsupported grading rubric ${String(decoded.rubric)}.`);
  }

  const modelsInput = object(decoded.models, "Grading config models");
  if (Object.keys(modelsInput).length !== 2) {
    throw new Error("Grading config models must contain exactly the two reviewer profiles.");
  }
  const models = Object.fromEntries(
    Object.entries(modelsInput).map(([profileId, value]) => {
      controlledId(profileId, "Grading model profile ID");
      const model = exact(value, ["provider", "model"], `Grading model ${profileId}`);
      return [
        profileId,
        {
          provider: officialProvider(model.provider, `Grading model ${profileId}.provider`),
          model: nonEmptyText(model.model, `Grading model ${profileId}.model`),
        },
      ];
    }),
  );

  if (!Array.isArray(decoded.reviewers) || decoded.reviewers.length !== 2) {
    throw new Error("Grading config reviewers must contain exactly two entries.");
  }
  const reviewers = decoded.reviewers.map((value, index): GradingReviewerProfile => {
    const reviewer = exact(
      value,
      ["profile", "tokenLimit", "maxOutputTokens"],
      `Grading reviewer ${String(index + 1)}`,
    );
    const profile = controlledId(reviewer.profile, `Grading reviewer ${String(index + 1)}.profile`);
    if (models[profile] === undefined) {
      throw new Error(
        `Grading reviewer ${String(index + 1)} references unknown profile ${profile}.`,
      );
    }
    return {
      profile,
      tokenLimit: positiveInteger(
        reviewer.tokenLimit,
        `Grading reviewer ${String(index + 1)}.tokenLimit`,
      ),
      maxOutputTokens: positiveInteger(
        reviewer.maxOutputTokens,
        `Grading reviewer ${String(index + 1)}.maxOutputTokens`,
      ),
    };
  }) as [GradingReviewerProfile, GradingReviewerProfile];
  if (reviewers[0].profile === reviewers[1].profile) {
    throw new Error("Grading reviewers must reference distinct profiles.");
  }
  if (models[reviewers[0].profile]!.provider === models[reviewers[1].profile]!.provider) {
    throw new Error("Grading reviewers must use distinct provider families.");
  }
  if (
    Object.keys(models).some(
      (profile) => !reviewers.some((reviewer) => reviewer.profile === profile),
    )
  ) {
    throw new Error("Grading config models must contain only referenced reviewer profiles.");
  }

  return { schemaVersion: 1, rubric: EPISTEMIC_PROCESS_RUBRIC_VERSION, models, reviewers };
}

export function gradingConfigurationDigest(source: string | Buffer): string {
  const configurationFileDigest = createHash("sha256").update(source).digest("hex");
  return contentDigest({
    graderVersion: EPISTEMIC_PROCESS_RUBRIC_VERSION,
    evidenceCompilerVersion: EVIDENCE_COMPILER_VERSION,
    configurationFileDigest,
  });
}

export async function loadGradingConfigurationSource(
  path: string,
): Promise<LoadedGradingConfiguration> {
  const source = await readFile(resolve(path));
  let value: unknown;
  try {
    value = parse(source.toString("utf8"), { maxAliasCount: 0, uniqueKeys: true });
  } catch (error) {
    throw new Error(
      `Grading config is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    config: decodeGradingConfiguration(value),
    source,
    digest: gradingConfigurationDigest(source),
  };
}

export async function loadGradingConfig(path: string): Promise<GradingConfiguration> {
  return (await loadGradingConfigurationSource(path)).config;
}
