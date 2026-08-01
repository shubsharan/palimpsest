import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildFixture, derivedFixtureDefinition } from "../../src/fixture/build.js";
import { loadResolvedExperiment } from "../../src/experiment/manifest.js";
import { parseFlags } from "../../src/flags.js";

const root = resolve(".");
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

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
  it("parses only explicit flag values", () => {
    expect(parseFlags(["--config", "experiments/config.yaml", "--run", "shared"])).toEqual(
      new Map([
        ["--config", "experiments/config.yaml"],
        ["--run", "shared"],
      ]),
    );
    expect(() => parseFlags(["--config"])).toThrow("--config requires a value.");
  });

  it("builds and decodes one package through the real Python boundary", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-fixture-build-"));
    temporaryRoots.push(temporaryRoot);
    const run = (await loadResolvedExperiment(join(root, "experiments/config.yaml"), root))
      .runs[0]!;
    const result = await buildFixture({
      root,
      output: join(temporaryRoot, "package"),
      fixture: derivedFixtureDefinition(run),
      selectedVariant: run.fixture.variant,
    });
    expect(result).toMatchObject({
      fixtureId: expect.stringMatching(/^fixture-[0-9a-f]{16}$/),
      contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      buildId: expect.stringMatching(/^build-[0-9a-f]{64}$/),
      rekeyAtStage: null,
    });
  }, 30_000);

  it.each([
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
