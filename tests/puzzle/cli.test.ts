import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPuzzle } from "../../src/build.js";
import { evaluatePuzzle } from "../../src/evaluate.js";
import { parseFlags } from "../../src/flags.js";
import { runPuzzle } from "../../src/run.js";

const root = resolve(".");
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface PackageJson {
  scripts: Record<string, string>;
}

function execute(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8",
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        resolveResult({
          exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
          stdout,
          stderr,
        });
      },
    );
  });
}

function expectOneJsonObject(stdout: string): Record<string, unknown> {
  expect(stdout.endsWith("\n")).toBe(true);
  const lines = stdout.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  const value: unknown = JSON.parse(lines[0] ?? "");
  expect(value).toEqual(expect.any(Object));
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

async function packageScripts(): Promise<Record<string, string>> {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageJson;
  return packageJson.scripts;
}

describe("operator CLI contract", () => {
  it("keeps the five public command names without depending on their private entrypoint layout", async () => {
    const scripts = await packageScripts();
    const commandNames = Object.keys(scripts)
      .filter((name) => name.startsWith("puzzle:"))
      .sort();

    expect(commandNames).toEqual([
      "puzzle:build",
      "puzzle:evaluate",
      "puzzle:offline",
      "puzzle:run",
      "puzzle:sandbox:build",
    ]);
    for (const name of commandNames) {
      expect(scripts[name]?.trim().length).toBeGreaterThan(0);
    }
  });

  it("routes the explicit research preflight through the root CLI", async () => {
    const scripts = await packageScripts();
    expect(scripts.preflight).toBe("tsx src/cli.ts preflight");
  });

  it("accepts every documented flag name, including pnpm's standalone separator", () => {
    expect(
      parseFlags([
        "--",
        "--output",
        "attempt",
        "--seed",
        "0",
        "--stage-interval-ms",
        "120000",
        "--transition-stage",
        "4",
        "--changed-token-mass",
        "0.2",
        "--build",
        "build",
        "--adapter",
        "fixture",
        "--token-budget",
        "100",
        "--wall-time-ms",
        "10000",
        "--model",
        "model",
        "--fixture-scenario",
        "collaborative-revision",
        "--attempt",
        "attempt",
        "--workspace",
        "agent-1",
        "--command",
        "sh solve.sh",
        "--notes",
        "reviewed",
      ]),
    ).toEqual(
      new Map([
        ["--output", "attempt"],
        ["--seed", "0"],
        ["--stage-interval-ms", "120000"],
        ["--transition-stage", "4"],
        ["--changed-token-mass", "0.2"],
        ["--build", "build"],
        ["--adapter", "fixture"],
        ["--token-budget", "100"],
        ["--wall-time-ms", "10000"],
        ["--model", "model"],
        ["--fixture-scenario", "collaborative-revision"],
        ["--attempt", "attempt"],
        ["--workspace", "agent-1"],
        ["--command", "sh solve.sh"],
        ["--notes", "reviewed"],
      ]),
    );
  });

  it("rejects missing flag values and duplicate names explicitly", () => {
    expect(() => parseFlags(["--output"])).toThrow("--output requires a value.");
    expect(() => parseFlags(["--output", "one", "--output", "two"])).toThrow(
      "--output may be provided only once.",
    );
  });

  it("emits one extensible build result with defaults and an absolute path", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-build-cli-"));
    const defaultOutput = join(temporaryRoot, "default");
    const explicitOutput = join(temporaryRoot, "explicit");
    const first = await buildPuzzle({
      root,
      output: defaultOutput,
    });
    const second = await buildPuzzle({
      root,
      output: explicitOutput,
      seed: 0,
      stageIntervalMs: 120_000,
      transitionStage: 4,
      changedTokenMass: 0.2,
    });

    expect(first).toMatchObject({
      buildId: expect.stringMatching(/^build-/),
      buildPath: defaultOutput,
    });
    expect(Object.keys(first)).toEqual(
      expect.arrayContaining(["buildId", "buildPath", "agentCount", "stageCount"]),
    );
    expect(isAbsolute(first.buildPath)).toBe(true);
    expect(second.buildId).toBe(first.buildId);

    const scripts = await packageScripts();
    const command = scripts["puzzle:build"]?.split(/\s+/);
    expect(command?.[0]).toBe("tsx");
    const result = await execute(
      process.execPath,
      [tsxCli, ...(command?.slice(1) ?? []), "--output", join(temporaryRoot, "stdout")],
      {
        cwd: root,
      },
    );
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(expectOneJsonObject(result.stdout)).toMatchObject({
      buildId: expect.stringMatching(/^build-/),
      buildPath: expect.stringMatching(/^\//),
    });
  }, 30_000);

  it("preserves deterministic private streams while separating public and oracle files", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-build-contract-"));
    const firstOutput = join(temporaryRoot, "first");
    const secondOutput = join(temporaryRoot, "second");
    const first = await buildPuzzle({
      root,
      output: firstOutput,
      seed: 17,
      stageIntervalMs: 10,
      transitionStage: 4,
      changedTokenMass: 0.2,
    });
    const second = await buildPuzzle({
      root,
      output: secondOutput,
      seed: 17,
      stageIntervalMs: 10,
      transitionStage: 4,
      changedTokenMass: 0.2,
    });

    expect(first).toMatchObject({ agentCount: 3, stageCount: 6, transitionStage: 4 });
    expect(second.buildId).toBe(first.buildId);
    const manifest = JSON.parse(await readFile(join(firstOutput, "puzzle-build.json"), "utf8")) as {
      stages: { sourcePath: string }[];
      publicCiphertextPath: string;
      oracleRoot: string;
    };
    expect(manifest.stages).toHaveLength(18);
    expect(new Set(manifest.stages.map((stage) => stage.sourcePath.split("/")[1]))).toEqual(
      new Set(["agent-1", "agent-2", "agent-3"]),
    );
    await access(join(firstOutput, manifest.publicCiphertextPath));
    await access(join(firstOutput, manifest.oracleRoot, "plaintext.txt"));
    expect(manifest.publicCiphertextPath.startsWith(manifest.oracleRoot)).toBe(false);
  }, 30_000);

  it("enforces run positivity and the OpenAI model relationship before sandbox startup", async () => {
    await expect(
      runPuzzle({
        root,
        buildRoot: "unused",
        output: "unused",
        adapter: "fixture",
        tokenBudget: 0,
        wallTimeMs: 10_000,
      }),
    ).rejects.toThrow("Token budget and wall time must be positive.");

    const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-run-contract-"));
    const build = await buildPuzzle({
      root,
      output: join(temporaryRoot, "build"),
      stageIntervalMs: 1,
    });
    await expect(
      runPuzzle({
        root,
        buildRoot: build.buildPath,
        output: join(temporaryRoot, "attempt"),
        adapter: "openai",
        tokenBudget: 100,
        wallTimeMs: 10_000,
      }),
    ).rejects.toThrow("--model is required");

    const rejectedPaidAttempt = join(temporaryRoot, "missing-preflight-attempt");
    await expect(
      runPuzzle({
        root: temporaryRoot,
        buildRoot: build.buildPath,
        output: rejectedPaidAttempt,
        adapter: "openai",
        model: "test-model",
        tokenBudget: 100,
        wallTimeMs: 10_000,
      }),
    ).rejects.toThrow(/preflight receipt is missing or invalid/i);
    await expect(access(rejectedPaidAttempt)).rejects.toMatchObject({ code: "ENOENT" });

    const rejectedAttempt = join(temporaryRoot, "unknown-scenario-attempt");
    await expect(
      runPuzzle({
        root,
        buildRoot: build.buildPath,
        output: rejectedAttempt,
        adapter: "fixture",
        fixtureScenario: "unknown",
        tokenBudget: 100,
        wallTimeMs: 10_000,
      }),
    ).rejects.toThrow(/unknown fixture scenario.*collaborative-revision/i);
    await expect(access(rejectedAttempt)).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("requires evaluator command and output flags together before sandbox startup", async () => {
    const attemptRoot = await mkdtemp(join(tmpdir(), "palimpsest-evaluate-contract-"));
    await writeFile(
      join(attemptRoot, "attempt.json"),
      `${JSON.stringify({
        buildRoot: join(attemptRoot, "build"),
        tracePath: join(attemptRoot, "trace.jsonl"),
        frozenRoot: join(attemptRoot, "frozen"),
        sandbox: { imageId: "sha256:contract" },
      })}\n`,
      "utf8",
    );

    await expect(
      evaluatePuzzle({
        root,
        attempt: join(attemptRoot, "frozen"),
        command: "sh solve.sh",
      }),
    ).rejects.toThrow("Reviewer command and output path must be provided together.");
  });

  it.each([
    ["puzzle:build", []],
    ["puzzle:run", []],
    ["puzzle:evaluate", []],
    ["puzzle:offline", []],
    ["puzzle:sandbox:build", []],
  ])(
    "%s failures are nonzero, stderr-only, and never success-shaped",
    async (name, args) => {
      const scripts = await packageScripts();
      const command = scripts[name]?.split(/\s+/);
      expect(command?.[0]).toBe("tsx");
      const emptyPath = await mkdtemp(join(tmpdir(), "palimpsest-cli-path-"));
      const result = await execute(
        process.execPath,
        [tsxCli, ...(command?.slice(1) ?? []), ...args],
        {
          cwd: root,
          env: name === "puzzle:sandbox:build" ? { ...process.env, PATH: emptyPath } : process.env,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.trim().length).toBeGreaterThan(0);
      expect(result.stdout).toBe("");
    },
    30_000,
  );
});
