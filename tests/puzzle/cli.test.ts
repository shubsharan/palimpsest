import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPuzzle } from "../../tools/puzzle/build.js";
import { parseFlags } from "../../tools/puzzle/common.js";

describe("puzzle build CLI", () => {
  it("accepts pnpm's conventional standalone option separator", () => {
    expect(parseFlags(["--", "--output", "attempt"])).toEqual(new Map([["--output", "attempt"]]));
  });

  it("reproduces three private six-stage streams while separating public and oracle files", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-build-cli-"));
    const first = join(root, "first");
    const second = join(root, "second");
    const left = await buildPuzzle({
      root: process.cwd(),
      output: first,
      seed: 17,
      stageIntervalMs: 10,
      transitionStage: 4,
      changedTokenMass: 0.2,
    });
    const right = await buildPuzzle({
      root: process.cwd(),
      output: second,
      seed: 17,
      stageIntervalMs: 10,
      transitionStage: 4,
      changedTokenMass: 0.2,
    });

    expect(left).toMatchObject({ agentCount: 3, stageCount: 6, transitionStage: 4 });
    expect(right.buildId).toBe(left.buildId);
    const manifest = JSON.parse(await readFile(join(first, "puzzle-build.json"), "utf8")) as {
      stages: { sourcePath: string }[];
      publicCiphertextPath: string;
      oracleRoot: string;
    };
    expect(manifest.stages).toHaveLength(18);
    expect(new Set(manifest.stages.map((stage) => stage.sourcePath.split("/")[1]))).toEqual(
      new Set(["agent-1", "agent-2", "agent-3"]),
    );
    await access(join(first, manifest.publicCiphertextPath));
    await access(join(first, manifest.oracleRoot, "plaintext.txt"));
    expect(manifest.publicCiphertextPath.startsWith(manifest.oracleRoot)).toBe(false);
  }, 30_000);
});
