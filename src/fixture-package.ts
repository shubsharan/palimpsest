import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";

import { contentDigest as hashContent } from "./canonical.js";
import { isAgentId, type AgentId } from "./model.js";
import { readJsonObject } from "./python.js";

const DIGEST = /^[0-9a-f]{64}$/;
const BUILD_ID = /^build-[0-9a-f]{64}$/;

export interface FixtureStage {
  ordinal: number;
  agentId: AgentId;
  sourcePath: string;
  sha256: string;
}

export interface FixtureReferenceFile {
  sourceId: string;
  sourceSha256: string;
  path: string;
  byteLength: number;
  sha256: string;
}

export interface FixtureVariant {
  variantId: string;
  rekeyFromStage: number | null;
  buildId: string;
  publicCiphertextPath: string;
  publicCiphertextSha256: string;
  referenceCorpusPath: string;
  referenceFiles: readonly FixtureReferenceFile[];
  stages: readonly FixtureStage[];
}

export interface FixturePackage {
  schemaVersion: 1;
  fixtureId: string;
  contentDigest: string;
  agentIds: readonly AgentId[];
  stageCount: number;
  variants: Readonly<Record<string, FixtureVariant>>;
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

export function decodeFixturePackage(value: unknown): FixturePackage {
  const root = record(value, "Fixture package");
  if (root.schemaVersion !== 1) throw new Error("Unsupported fixture package schema version.");
  const fixtureId = text(root.fixtureId, "Fixture package fixtureId");
  const contentDigest = text(root.contentDigest, "Fixture package contentDigest");
  if (!DIGEST.test(contentDigest)) throw new Error("Fixture package contentDigest is invalid.");
  if (!Array.isArray(root.agentIds) || root.agentIds.length === 0) {
    throw new Error("Fixture package agentIds must be non-empty.");
  }
  const agentIds = root.agentIds.map((value, index) => {
    if (!isAgentId(value))
      throw new Error(`Fixture package agentIds[${String(index)}] is invalid.`);
    return value;
  });
  if (new Set(agentIds).size !== agentIds.length) {
    throw new Error("Fixture package agentIds must be unique.");
  }
  if (!Number.isSafeInteger(root.stageCount) || (root.stageCount as number) < 1) {
    throw new Error("Fixture package stageCount must be a positive safe integer.");
  }
  const stageCount = root.stageCount as number;
  const variantsValue = record(root.variants, "Fixture package variants");
  const variants = Object.fromEntries(
    Object.entries(variantsValue).map(([key, value]) => {
      const item = record(value, `Fixture variant ${key}`);
      const variantId = text(item.variantId, `Fixture variant ${key} variantId`);
      if (variantId !== key) throw new Error(`Fixture variant ${key} key and identity differ.`);
      const rekeyFromStage = item.rekeyFromStage;
      if (
        rekeyFromStage !== null &&
        (!Number.isSafeInteger(rekeyFromStage) ||
          (rekeyFromStage as number) < 2 ||
          (rekeyFromStage as number) > stageCount)
      ) {
        throw new Error(`Fixture variant ${key} rekeyFromStage is outside the fixture.`);
      }
      const buildId = text(item.buildId, `Fixture variant ${key} buildId`);
      if (!BUILD_ID.test(buildId)) throw new Error(`Fixture variant ${key} buildId is invalid.`);
      if (!Array.isArray(item.stages))
        throw new Error(`Fixture variant ${key} stages are missing.`);
      const stages = item.stages.map((value, index): FixtureStage => {
        const stage = record(value, `Fixture variant ${key} stage ${String(index + 1)}`);
        if (!isAgentId(stage.agentId) || !agentIds.includes(stage.agentId)) {
          throw new Error(`Fixture variant ${key} stage agent is not declared.`);
        }
        if (
          !Number.isSafeInteger(stage.ordinal) ||
          (stage.ordinal as number) < 1 ||
          (stage.ordinal as number) > stageCount
        ) {
          throw new Error(`Fixture variant ${key} stage ordinal is invalid.`);
        }
        return {
          agentId: stage.agentId,
          ordinal: stage.ordinal as number,
          sourcePath: relativePath(stage.sourcePath, `Fixture variant ${key} stage sourcePath`),
          sha256: text(stage.sha256, `Fixture variant ${key} stage sha256`),
        };
      });
      if (stages.some(({ sha256 }) => !DIGEST.test(sha256))) {
        throw new Error(`Fixture variant ${key} stage sha256 is invalid.`);
      }
      const referenceCorpusPath = relativePath(
        item.referenceCorpusPath,
        `Fixture variant ${key} referenceCorpusPath`,
      );
      if (!Array.isArray(item.referenceFiles) || item.referenceFiles.length === 0) {
        throw new Error(`Fixture variant ${key} referenceFiles must be non-empty.`);
      }
      const referenceFiles = item.referenceFiles.map((value, index): FixtureReferenceFile => {
        const reference = record(
          value,
          `Fixture variant ${key} reference file ${String(index + 1)}`,
        );
        const path = relativePath(reference.path, `Fixture variant ${key} reference file path`);
        if (!path.startsWith(`${referenceCorpusPath}/`)) {
          throw new Error(`Fixture variant ${key} reference file is outside its corpus.`);
        }
        const sourceSha256 = text(
          reference.sourceSha256,
          `Fixture variant ${key} reference sourceSha256`,
        );
        const sha256 = text(reference.sha256, `Fixture variant ${key} reference sha256`);
        if (!DIGEST.test(sourceSha256) || !DIGEST.test(sha256)) {
          throw new Error(`Fixture variant ${key} reference digest is invalid.`);
        }
        if (!Number.isSafeInteger(reference.byteLength) || (reference.byteLength as number) < 1) {
          throw new Error(`Fixture variant ${key} reference byteLength is invalid.`);
        }
        return {
          sourceId: text(reference.sourceId, `Fixture variant ${key} reference sourceId`),
          sourceSha256,
          path,
          byteLength: reference.byteLength as number,
          sha256,
        };
      });
      if (new Set(referenceFiles.map(({ path }) => path)).size !== referenceFiles.length) {
        throw new Error(`Fixture variant ${key} reference file paths must be unique.`);
      }
      for (const agentId of agentIds) {
        const ordinals = stages
          .filter((stage) => stage.agentId === agentId)
          .map((stage) => stage.ordinal)
          .sort((left, right) => left - right);
        if (ordinals.join(",") !== Array.from({ length: stageCount }, (_, i) => i + 1).join(",")) {
          throw new Error(`Fixture variant ${key} must contain every stage for ${agentId}.`);
        }
      }
      const publicCiphertextSha256 = text(
        item.publicCiphertextSha256,
        `Fixture variant ${key} publicCiphertextSha256`,
      );
      if (!DIGEST.test(publicCiphertextSha256)) {
        throw new Error(`Fixture variant ${key} publicCiphertextSha256 is invalid.`);
      }
      return [
        key,
        {
          variantId,
          rekeyFromStage: rekeyFromStage as number | null,
          buildId,
          publicCiphertextPath: relativePath(
            item.publicCiphertextPath,
            `Fixture variant ${key} publicCiphertextPath`,
          ),
          publicCiphertextSha256,
          referenceCorpusPath,
          referenceFiles,
          stages,
        },
      ];
    }),
  );
  if (Object.keys(variants).length === 0) throw new Error("Fixture package has no variants.");
  return { schemaVersion: 1, fixtureId, contentDigest, agentIds, stageCount, variants };
}

async function verifyFile(
  packageRoot: string,
  path: string,
  expectedDigest: string,
  expectedBytes?: number,
): Promise<void> {
  if (!DIGEST.test(expectedDigest))
    throw new Error(`Fixture package digest for ${path} is invalid.`);
  const bytes = await readFile(join(packageRoot, path));
  if (
    createHash("sha256").update(bytes).digest("hex") !== expectedDigest ||
    (expectedBytes !== undefined && bytes.byteLength !== expectedBytes)
  ) {
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
    verifyFile(packageRoot, "oracle/plaintext.txt", text(window.sha256, "Fixture window sha256")),
    ...[allocation, oracleDesign, manipulationCheck].map((item) =>
      verifyFile(
        packageRoot,
        relativePath(item.path, "Fixture oracle path"),
        text(item.sha256, "Fixture oracle sha256"),
      ),
    ),
    ...Object.values(fixture.variants).flatMap((variant) => [
      verifyFile(packageRoot, variant.publicCiphertextPath, variant.publicCiphertextSha256),
      ...variant.referenceFiles.map((reference) =>
        verifyFile(packageRoot, reference.path, reference.sha256, reference.byteLength),
      ),
      ...variant.stages.map((stage) => verifyFile(packageRoot, stage.sourcePath, stage.sha256)),
    ]),
  ]);
  return fixture;
}

export function selectFixtureVariant(fixture: FixturePackage, variantId: string): FixtureVariant {
  const variant = fixture.variants[variantId];
  if (variant === undefined) {
    throw new Error(`Fixture ${fixture.fixtureId} does not contain variant ${variantId}.`);
  }
  return variant;
}
