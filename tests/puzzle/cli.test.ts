import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildFixture } from "../../src/fixture/build.js";
import { parseFlags } from "../../src/flags.js";

const root = resolve(".");
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");

function execute(args: readonly string[]) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((finish) => {
    execFile(
      process.execPath,
      [tsxCli, "src/cli.ts", ...args],
      { cwd: root, encoding: "utf8", timeout: 30_000 },
      (error, stdout, stderr) =>
        finish({
          exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
          stdout,
          stderr,
        }),
    );
  });
}

describe("operator CLI contract", () => {
  it("exposes the lean research commands", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(
      Object.keys(packageJson.scripts)
        .filter((name) => name.startsWith("puzzle:"))
        .sort(),
    ).toEqual([
      "puzzle:analyze",
      "puzzle:build",
      "puzzle:evaluate",
      "puzzle:experiment",
      "puzzle:sandbox:build",
      "puzzle:validate",
    ]);
  });

  it("parses only explicit flag values", () => {
    expect(
      parseFlags(["--fixture", "calibration-theron-ware", "--output", "artifacts/fixture"]),
    ).toEqual(
      new Map([
        ["--fixture", "calibration-theron-ware"],
        ["--output", "artifacts/fixture"],
      ]),
    );
    expect(() => parseFlags(["--config"])).toThrow("--config requires a value.");
  });

  it("builds a declared fixture deterministically through the real Python boundary", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-fixture-build-"));
    const first = await buildFixture({
      root,
      fixtureId: "calibration-theron-ware",
      output: join(temporaryRoot, "first"),
    });
    const second = await buildFixture({
      root,
      fixtureId: "calibration-theron-ware",
      output: join(temporaryRoot, "second"),
    });
    expect(second).toEqual({ ...first, packagePath: join(temporaryRoot, "second") });
    expect(first.agentIds).toEqual(["agent-1", "agent-2", "agent-3"]);
    expect(first.stageCount).toBe(6);
    expect(first.variants).toEqual({
      stationary: expect.stringMatching(/^build-[0-9a-f]{64}$/),
      rekey: expect.stringMatching(/^build-[0-9a-f]{64}$/),
    });
  }, 30_000);

  it.each([
    ["build", []],
    ["validate", []],
    ["experiment", []],
    ["evaluate", []],
    ["analyze", []],
  ])("%s failures are stderr-only and nonzero", async (command, args) => {
    const result = await execute([command, ...args]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).not.toBe("");
  });
});
