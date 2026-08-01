import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";

import { contentDigest as hashContent } from "../canonical.js";
import { isAgentId, type AgentId } from "../model/contracts.js";
import { readJsonObject } from "../python.js";

const DIGEST = /^[0-9a-f]{64}$/;
const BUILD_ID = /^build-[0-9a-f]{64}$/;
const CONSTRUCTION_ID = /^construction-[0-9a-f]{64}$/;

export interface FixtureStage {
  ordinal: number;
  agentId: AgentId;
  sourcePath: string;
  sha256: string;
}

export interface FixtureRealization {
  variantId: string;
  rekeyFromStage: number | null;
  buildId: string;
  publicCiphertextPath: string;
  publicCiphertextSha256: string;
  stages: readonly FixtureStage[];
}

export type FixtureVariant = FixtureRealization;

export interface FixturePackage extends FixtureRealization {
  schemaVersion: 2;
  fixtureId: string;
  constructionId: string;
  contentDigest: string;
  agentIds: readonly AgentId[];
  stageCount: number;
  rekeyAtStage: number | null;
  /** Internal compatibility projection for the resolved runner. Not serialized. */
  variants: Readonly<Record<string, FixtureRealization>>;
}

interface PackageFileDigest {
  path: string;
  sha256: string;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function digest(value: unknown, name: string): string {
  const result = text(value, name);
  if (!DIGEST.test(result)) throw new Error(`${name} must be a lowercase SHA-256 digest.`);
  return result;
}

function relativePath(value: unknown, name: string): string {
  const path = text(value, name);
  if (
    posix.isAbsolute(path) ||
    win32.isAbsolute(path) ||
    path.includes("\0") ||
    path.split(/[\\/]/).some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${name} must be a safe relative path.`);
  }
  return path;
}

function decodeStages(
  value: unknown,
  agentIds: readonly AgentId[],
  stageCount: number,
): FixtureStage[] {
  if (!Array.isArray(value)) throw new Error("Fixture package stages must be an array.");
  const stages = value.map((raw, index): FixtureStage => {
    const stage = record(raw, `Fixture stage ${String(index + 1)}`);
    if (!isAgentId(stage.agentId) || !agentIds.includes(stage.agentId)) {
      throw new Error("Fixture stage agent is not declared.");
    }
    if (
      !Number.isSafeInteger(stage.ordinal) ||
      (stage.ordinal as number) < 1 ||
      (stage.ordinal as number) > stageCount
    ) {
      throw new Error("Fixture stage ordinal is invalid.");
    }
    return {
      agentId: stage.agentId,
      ordinal: stage.ordinal as number,
      sourcePath: relativePath(stage.sourcePath, "Fixture stage sourcePath"),
      sha256: digest(stage.sha256, "Fixture stage sha256"),
    };
  });
  for (const agentId of agentIds) {
    const ordinals = stages
      .filter((stage) => stage.agentId === agentId)
      .map((stage) => stage.ordinal)
      .sort((left, right) => left - right);
    if (ordinals.join(",") !== Array.from({ length: stageCount }, (_, i) => i + 1).join(",")) {
      throw new Error(`Fixture package must contain every stage for ${agentId}.`);
    }
  }
  return stages;
}

export function decodeFixturePackage(value: unknown): FixturePackage {
  const root = record(value, "Fixture package");
  if (root.schemaVersion !== 2) throw new Error("Unsupported fixture package schema version.");
  const fixtureId = text(root.fixtureId, "Fixture package fixtureId");
  const constructionId = text(root.constructionId, "Fixture package constructionId");
  if (!CONSTRUCTION_ID.test(constructionId)) {
    throw new Error("Fixture package constructionId is invalid.");
  }
  const contentDigest = digest(root.contentDigest, "Fixture package contentDigest");
  if (!Array.isArray(root.agentIds) || root.agentIds.length < 2) {
    throw new Error("Fixture package agentIds must contain at least two agents.");
  }
  const agentIds = root.agentIds.map((agent, index) => {
    if (!isAgentId(agent))
      throw new Error(`Fixture package agentIds[${String(index)}] is invalid.`);
    return agent;
  });
  if (new Set(agentIds).size !== agentIds.length)
    throw new Error("Fixture package agentIds must be unique.");
  if (!Number.isSafeInteger(root.stageCount) || (root.stageCount as number) < 1) {
    throw new Error("Fixture package stageCount must be positive.");
  }
  const stageCount = root.stageCount as number;
  const rekeyAtStage = root.rekeyAtStage;
  if (
    rekeyAtStage !== null &&
    (!Number.isSafeInteger(rekeyAtStage) ||
      (rekeyAtStage as number) < 2 ||
      (rekeyAtStage as number) > stageCount)
  ) {
    throw new Error("Fixture package rekeyAtStage is outside the fixture.");
  }
  const buildId = text(root.buildId, "Fixture package buildId");
  if (!BUILD_ID.test(buildId)) throw new Error("Fixture package buildId is invalid.");
  const publicCiphertextPath = relativePath(
    root.publicCiphertextPath,
    "Fixture package publicCiphertextPath",
  );
  const publicCiphertextSha256 = digest(
    root.publicCiphertextSha256,
    "Fixture package publicCiphertextSha256",
  );
  const stages = decodeStages(root.stages, agentIds, stageCount);
  const variantId = rekeyAtStage === null ? "stationary" : `rekey-stage-${String(rekeyAtStage)}`;
  const realization: FixtureRealization = {
    variantId,
    rekeyFromStage: rekeyAtStage as number | null,
    buildId,
    publicCiphertextPath,
    publicCiphertextSha256,
    stages,
  };
  return {
    schemaVersion: 2,
    fixtureId,
    constructionId,
    contentDigest,
    agentIds,
    stageCount,
    rekeyAtStage: rekeyAtStage as number | null,
    ...realization,
    variants: { [variantId]: realization },
  };
}

async function verifyFile(
  packageRoot: string,
  path: string,
  expectedDigest: string,
): Promise<void> {
  const bytes = await readFile(join(packageRoot, path));
  if (createHash("sha256").update(bytes).digest("hex") !== expectedDigest) {
    throw new Error(`Fixture package file ${path} does not match its declared digest.`);
  }
}

async function packageFileDigests(
  packageRoot: string,
  directory = "",
): Promise<PackageFileDigest[]> {
  const entries = await readdir(join(packageRoot, directory), { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<PackageFileDigest[]> => {
      const path = directory === "" ? entry.name : posix.join(directory, entry.name);
      if (entry.isDirectory()) return packageFileDigests(packageRoot, path);
      if (!entry.isFile() || path === "fixture.json") return [];
      const bytes = await readFile(join(packageRoot, path));
      return [{ path, sha256: createHash("sha256").update(bytes).digest("hex") }];
    }),
  );
  return files.flat();
}

export async function computeFixturePackageContentDigest(
  packageRoot: string,
  manifest: Record<string, unknown>,
): Promise<string> {
  const { contentDigest: _claimedDigest, ...content } = manifest;
  const files = (await packageFileDigests(packageRoot)).sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return hashContent({ manifest: content, files });
}

export async function loadFixturePackage(packageRoot: string): Promise<FixturePackage> {
  const raw = await readJsonObject(join(packageRoot, "fixture.json"));
  const fixture = decodeFixturePackage(raw);
  if ((await computeFixturePackageContentDigest(packageRoot, raw)) !== fixture.contentDigest) {
    throw new Error("Fixture package contentDigest does not match its content.");
  }
  const allocation = record(raw.allocation, "Fixture package allocation");
  const oracleDesign = record(raw.oracleDesign, "Fixture package oracleDesign");
  const manipulationCheck = record(raw.manipulationCheck, "Fixture package manipulationCheck");
  const window = record(raw.window, "Fixture package window");
  await Promise.all([
    verifyFile(packageRoot, "oracle/plaintext.txt", digest(window.sha256, "Fixture window sha256")),
    ...[allocation, oracleDesign, manipulationCheck].map((item) =>
      verifyFile(
        packageRoot,
        relativePath(item.path, "Fixture oracle path"),
        digest(item.sha256, "Fixture oracle sha256"),
      ),
    ),
    verifyFile(packageRoot, fixture.publicCiphertextPath, fixture.publicCiphertextSha256),
    ...fixture.stages.map((stage) => verifyFile(packageRoot, stage.sourcePath, stage.sha256)),
  ]);
  return fixture;
}

export function selectFixtureVariant(
  fixture: FixturePackage,
  variantId: string,
): FixtureRealization {
  const realization = fixture.variants[variantId];
  if (realization === undefined) {
    throw new Error(`Fixture ${fixture.fixtureId} is not the requested realization ${variantId}.`);
  }
  return realization;
}
