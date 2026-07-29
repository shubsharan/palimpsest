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
    buildId: manifest.variants.rekey.buildId,
    buildPath: output,
    agentIds: manifest.agentIds,
    stageCount: manifest.stageCount,
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
    "selected variant identity",
    {
      result: { buildId: `build-${"b".repeat(64)}` },
    },
  ],
  ["block identity", { block: "validation-odd-women" }],
];

describe("build handoff validation", () => {
  it("accepts a current-version build that exactly matches the requested block", () => {
    const { manifest, result } = currentBuild();

    expect(() => assertBuildMatchesBlock(manifest, result, block, output)).not.toThrow();
  });

  it("reports the rekey variant build ID", () => {
    const { manifest, result } = currentBuild();

    expect(result.buildId).toBe(manifest.variants.rekey.buildId);
    expect(result.buildId).not.toBe(manifest.variants.stationary.buildId);
  });

  it("uses the fixed interim rekey variant selection", () => {
    const { manifest, result } = currentBuild();
    const selected = selectBuildVariant(manifest, "rekey");

    expect(selected).toBe(manifest.variants.rekey);
    expect(selected.variantId).toBe("rekey");
    expect(selected.buildId).toBe(result.buildId);
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
