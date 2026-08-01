import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  computeFixturePackageContentDigest,
  decodeFixturePackage,
  loadFixturePackage,
  selectFixtureVariant,
} from "./fixture-package.js";

const FILE_DIGEST = createHash("sha256").update("x").digest("hex");

function fixture() {
  const stages = ["agent-1", "agent-2"].flatMap((agentId) =>
    [1, 2, 3].map((ordinal) => ({
      agentId,
      ordinal,
      sourcePath: `variants/stationary/private/${agentId}/stage-${String(ordinal)}.txt`,
      sha256: FILE_DIGEST,
    })),
  );
  return {
    schemaVersion: 1,
    fixtureId: "small",
    contentDigest: "a".repeat(64),
    agentIds: ["agent-1", "agent-2"],
    stageCount: 3,
    variants: {
      stationary: {
        variantId: "stationary",
        rekeyFromStage: null,
        buildId: `build-${"b".repeat(64)}`,
        publicCiphertextPath: "variants/stationary/ciphertext.txt",
        publicCiphertextSha256: FILE_DIGEST,
        referenceCorpusPath: "variants/stationary/reference",
        referenceFiles: [
          {
            sourceId: "reference",
            sourceSha256: "d".repeat(64),
            path: "variants/stationary/reference/reference.txt",
            byteLength: 1,
            sha256: FILE_DIGEST,
          },
        ],
        stages,
      },
    },
  };
}

async function preparedFixture(): Promise<{ root: string; value: ReturnType<typeof fixture> }> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-fixture-package-"));
  const value = {
    ...fixture(),
    window: { sha256: FILE_DIGEST },
    allocation: { path: "oracle/allocation.json", sha256: FILE_DIGEST },
    oracleDesign: { path: "oracle/design.json", sha256: FILE_DIGEST },
    baseKeyPath: "oracle/keys/base.json",
    manipulationCheck: { path: "oracle/manipulation-check.json", sha256: FILE_DIGEST },
  };
  const paths = new Set([
    "oracle/plaintext.txt",
    "oracle/allocation.json",
    "oracle/design.json",
    "oracle/manipulation-check.json",
    "oracle/keys/base.json",
    "oracle/checker/agent-1/stage-1.txt",
    value.variants.stationary.publicCiphertextPath,
    ...value.variants.stationary.referenceFiles.map(({ path }) => path),
    ...value.variants.stationary.stages.map(({ sourcePath }) => sourcePath),
  ]);
  await Promise.all(
    [...paths].map(async (path) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), "x", "utf8");
    }),
  );
  value.contentDigest = await computeFixturePackageContentDigest(root, value);
  await writeFile(join(root, "fixture.json"), `${JSON.stringify(value)}\n`, "utf8");
  return { root, value };
}

describe("fixture packages", () => {
  it("decodes variable geometry and selects variants", () => {
    const decoded = decodeFixturePackage(fixture());
    expect(decoded.agentIds).toHaveLength(2);
    expect(decoded.stageCount).toBe(3);
    expect(selectFixtureVariant(decoded, "stationary").stages).toHaveLength(6);
  });

  it("requires complete ordered evidence for every agent", () => {
    const value = fixture();
    value.variants.stationary.stages.pop();
    expect(() => decodeFixturePackage(value)).toThrow(/every stage/i);
  });

  it("rejects a prepared package whose manifest bytes do not match its digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-fixture-integrity-"));
    const value = fixture();
    await writeFile(join(root, "fixture.json"), `${JSON.stringify(value)}\n`, "utf8");
    await expect(loadFixturePackage(root)).rejects.toThrow(/contentDigest does not match/i);
  });

  it.each([
    ["checker truth", "oracle/checker/agent-1/stage-1.txt"],
    ["key", "oracle/keys/base.json"],
    ["oracle file", "oracle/design.json"],
    ["stage", "variants/stationary/private/agent-1/stage-1.txt"],
    ["reference", "variants/stationary/reference/reference.txt"],
    ["ciphertext", "variants/stationary/ciphertext.txt"],
  ])("rejects package-tree drift in a %s", async (_label, path) => {
    const { root } = await preparedFixture();
    await writeFile(join(root, path), "mutated", "utf8");

    await expect(loadFixturePackage(root)).rejects.toThrow(/contentDigest does not match/i);
  });
});
