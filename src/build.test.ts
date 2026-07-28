import { describe, expect, it } from "vitest";

import { decodeBuildManifest, decodeBuildResult, type BuildPuzzleResult } from "./artifacts.js";
import { assertBuildMatchesPuzzle } from "./build.js";
import type { PuzzleDefinition } from "./config.js";
import { testBuildManifest } from "./test-helpers.js";

const output = "/tmp/palimpsest/build";
const puzzle: PuzzleDefinition = {
  target: {
    corpus: "middlemarch",
    chapters: { start: 10, end: 15 },
  },
  references: ["jane-eyre", "moby-dick"],
  seed: 17,
  agentCount: 3,
  stageCount: 6,
  stageIntervalMs: 20,
  rekeys: [{ atStage: 4, changedTokenMass: 0.2 }],
};

function currentBuild() {
  const manifest = decodeBuildManifest(testBuildManifest());
  const result = decodeBuildResult({
    buildId: manifest.buildId,
    buildPath: output,
    agentIds: manifest.agentIds,
    stageCount: manifest.stageCount,
  });
  return { manifest, result };
}

const mismatches: readonly [
  string,
  {
    puzzle?: Partial<PuzzleDefinition>;
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
    "reference order",
    {
      puzzle: { references: ["moby-dick", "jane-eyre"] },
    },
  ],
  [
    "agent count",
    {
      puzzle: { agentCount: 2 },
    },
  ],
  [
    "re-key schedule",
    {
      puzzle: { rekeys: [{ atStage: 5, changedTokenMass: 0.2 }] },
    },
  ],
];

describe("build handoff validation", () => {
  it("accepts a current-version build that exactly matches the resolved puzzle", () => {
    const { manifest, result } = currentBuild();

    expect(() => assertBuildMatchesPuzzle(manifest, result, puzzle, output)).not.toThrow();
  });

  it("rejects stale build schemas before comparing resolved inputs", () => {
    expect(() =>
      decodeBuildManifest({
        ...testBuildManifest(),
        schemaVersion: 1,
      }),
    ).toThrow("Unsupported puzzle build schema version.");
  });

  it.each(mismatches)("rejects a %s mismatch", (_name, overrides) => {
    const { manifest, result } = currentBuild();
    const declaredPuzzle = {
      ...puzzle,
      ...overrides.puzzle,
    };
    const reportedResult = {
      ...result,
      ...overrides.result,
    };

    expect(() =>
      assertBuildMatchesPuzzle(manifest, reportedResult, declaredPuzzle, output),
    ).toThrow("Puzzle build does not match its resolved experiment configuration.");
  });
});
