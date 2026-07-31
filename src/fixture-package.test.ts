import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decodeFixturePackage,
  loadFixturePackage,
  selectFixtureVariant,
} from "./fixture-package.js";

function fixture() {
  const stages = ["agent-1", "agent-2"].flatMap((agentId) =>
    [1, 2, 3].map((ordinal) => ({
      agentId,
      ordinal,
      sourcePath: `variants/stationary/private/${agentId}/stage-${String(ordinal)}.txt`,
      sha256: "c".repeat(64),
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
        publicCiphertextSha256: "c".repeat(64),
        referenceCorpusPath: "variants/stationary/reference",
        referenceFiles: [
          {
            sourceId: "reference",
            sourceSha256: "d".repeat(64),
            path: "variants/stationary/reference/reference.txt",
            byteLength: 1,
            sha256: "d".repeat(64),
          },
        ],
        stages,
      },
    },
  };
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
});
