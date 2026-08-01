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
} from "./package.js";

const FILE_DIGEST = createHash("sha256").update("x").digest("hex");

function fixture() {
  const stages = ["agent-1", "agent-2"].flatMap((agentId) =>
    [1, 2, 3].map((ordinal) => ({
      agentId,
      ordinal,
      sourcePath: `private/${agentId}/stages/stage-${String(ordinal)}.txt`,
      sha256: FILE_DIGEST,
    })),
  );
  return {
    schemaVersion: 2,
    fixtureId: "small",
    constructionId: `construction-${"c".repeat(64)}`,
    contentDigest: "a".repeat(64),
    source: { sourceId: "source", sha256: "d".repeat(64) },
    window: { sha256: FILE_DIGEST },
    agentIds: ["agent-1", "agent-2"],
    stageCount: 3,
    allocation: { path: "oracle/allocation.json", sha256: FILE_DIGEST },
    oracleDesign: { path: "oracle/design.json", sha256: FILE_DIGEST },
    baseKeyPath: "oracle/keys/base.json",
    manipulationCheck: { path: "oracle/manipulation-check.json", sha256: FILE_DIGEST },
    rekeyAtStage: null,
    buildId: `build-${"b".repeat(64)}`,
    publicCiphertextPath: "complete/ciphertext.txt",
    publicCiphertextSha256: FILE_DIGEST,
    stages,
  };
}

async function preparedFixture(): Promise<{ root: string; value: ReturnType<typeof fixture> }> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-fixture-package-"));
  const value = fixture();
  const paths = new Set([
    "oracle/plaintext.txt",
    "oracle/allocation.json",
    "oracle/design.json",
    "oracle/manipulation-check.json",
    "oracle/keys/base.json",
    "oracle/checker/agent-1/stage-1.txt",
    value.publicCiphertextPath,
    ...value.stages.map(({ sourcePath }) => sourcePath),
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
  it("decodes one realized fixture without references or variants", () => {
    const decoded = decodeFixturePackage(fixture());
    expect(decoded.agentIds).toHaveLength(2);
    expect(decoded.stageCount).toBe(3);
    expect(decoded.rekeyAtStage).toBeNull();
    expect(selectFixtureVariant(decoded, "stationary").stages).toHaveLength(6);
    expect(fixture()).not.toHaveProperty("references");
    expect(fixture()).not.toHaveProperty("variants");
  });

  it("requires complete ordered evidence for every agent", () => {
    const value = fixture();
    value.stages.pop();
    expect(() => decodeFixturePackage(value)).toThrow(/every stage/i);
  });

  it("rejects a prepared package whose manifest bytes do not match its digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-fixture-integrity-"));
    await writeFile(join(root, "fixture.json"), `${JSON.stringify(fixture())}\n`, "utf8");
    await expect(loadFixturePackage(root)).rejects.toThrow(/contentDigest does not match/i);
  });

  it.each([
    ["checker truth", "oracle/checker/agent-1/stage-1.txt"],
    ["key", "oracle/keys/base.json"],
    ["oracle file", "oracle/design.json"],
    ["stage", "private/agent-1/stages/stage-1.txt"],
    ["ciphertext", "complete/ciphertext.txt"],
  ])("rejects package-tree drift in a %s", async (_label, path) => {
    const { root } = await preparedFixture();
    await writeFile(join(root, path), "mutated", "utf8");
    await expect(loadFixturePackage(root)).rejects.toThrow(/contentDigest does not match/i);
  });
});
