import { describe, expect, it } from "vitest";

import {
  decodeBuildManifest,
  decodeBuildResult,
  selectBuildVariant,
  type BuildPuzzleResult,
} from "./artifacts.js";
import { assertBuildMatchesBlock } from "./build.js";
import { testBuildManifest } from "./test-helpers.js";

const output = "/tmp/palimpsest/build";
const block = "calibration-theron-ware";

function currentBuild() {
  const manifest = decodeBuildManifest(testBuildManifest());
  const result = decodeBuildResult({
    pairedBuildId: manifest.pairedBuildId,
    blockId: manifest.blockId,
    buildPath: output,
    agentIds: manifest.agentIds,
    stageCount: manifest.stageCount,
    variants: {
      stationary: manifest.variants.stationary.buildId,
      rekey: manifest.variants.rekey.buildId,
    },
  });
  return { manifest, result };
}

const mismatches: readonly [
  string,
  {
    block?: string;
    result?: Partial<BuildPuzzleResult>;
  },
][] = [
  [
    "builder output path",
    {
      result: { buildPath: "/tmp/palimpsest/other-build" },
    },
  ],
  [
    "paired identity",
    {
      result: { pairedBuildId: `paired-${"b".repeat(64)}` },
    },
  ],
  ["reported block identity", { result: { blockId: "validation-odd-women" } }],
  ["requested block identity", { block: "validation-odd-women" }],
  [
    "stationary variant identity",
    {
      result: {
        variants: {
          stationary: `build-${"a".repeat(64)}`,
          rekey: `build-${"b".repeat(64)}`,
        },
      },
    },
  ],
  [
    "re-key variant identity",
    {
      result: {
        variants: {
          stationary: `build-${"b".repeat(64)}`,
          rekey: `build-${"c".repeat(64)}`,
        },
      },
    },
  ],
];

describe("build handoff validation", () => {
  it("accepts a current-version build that exactly matches the requested block", () => {
    const { manifest, result } = currentBuild();

    expect(() => assertBuildMatchesBlock(manifest, result, block, output)).not.toThrow();
  });

  it("decodes exactly the paired build result contract", () => {
    const { manifest, result } = currentBuild();

    expect(result).toEqual({
      pairedBuildId: manifest.pairedBuildId,
      blockId: manifest.blockId,
      buildPath: output,
      agentIds: ["agent-1", "agent-2", "agent-3"],
      stageCount: 6,
      variants: {
        stationary: manifest.variants.stationary.buildId,
        rekey: manifest.variants.rekey.buildId,
      },
    });
    expect(() => decodeBuildResult({ ...result, buildId: result.variants.rekey })).toThrow(
      "Puzzle build result.buildId is unsupported.",
    );
  });

  it("uses the fixed interim rekey variant selection", () => {
    const { manifest, result } = currentBuild();
    const selected = selectBuildVariant(manifest, "rekey");

    expect(selected).toBe(manifest.variants.rekey);
    expect(selected.variantId).toBe("rekey");
    expect(selected.buildId).toBe(result.variants.rekey);
  });

  it("rejects stale build schemas before comparing resolved inputs", () => {
    expect(() =>
      decodeBuildManifest({
        ...testBuildManifest(),
        schemaVersion: 1,
      }),
    ).toThrow("Unsupported puzzle build schema version.");
  });

  it("keeps release timing outside schema version 3", () => {
    const raw = testBuildManifest();
    const manifest = decodeBuildManifest(raw);

    expect(raw).not.toHaveProperty("stageIntervalMs");
    expect(manifest.variants.stationary.stages[0]).not.toHaveProperty("releaseOffsetMs");
    expect(manifest.variants.rekey.stages[0]).not.toHaveProperty("releaseOffsetMs");
    expect(() => decodeBuildManifest({ ...raw, stageIntervalMs: 20 })).toThrow(
      "Puzzle build manifest.stageIntervalMs is unsupported.",
    );

    const variants = raw.variants as Record<string, Record<string, unknown>>;
    const rekey = variants.rekey!;
    const stages = [...(rekey.stages as Record<string, unknown>[])];
    stages[0] = { ...stages[0], releaseOffsetMs: 0 };

    expect(() =>
      decodeBuildManifest({
        ...raw,
        variants: { ...variants, rekey: { ...rekey, stages } },
      }),
    ).toThrow("releaseOffsetMs is unsupported.");
  });

  it.each(mismatches)("rejects a %s mismatch", (_name, overrides) => {
    const { manifest, result } = currentBuild();
    const reportedResult = {
      ...result,
      ...overrides.result,
    };

    expect(() =>
      assertBuildMatchesBlock(manifest, reportedResult, overrides.block ?? block, output),
    ).toThrow("Puzzle build does not match the requested block.");
  });
});
