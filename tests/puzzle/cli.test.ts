import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPuzzle } from "../../src/build.js";
import type { PuzzleDefinition } from "../../src/config.js";
import { parseFlags } from "../../src/flags.js";

const root = resolve(".");
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const smallPuzzle: PuzzleDefinition = {
  target: {
    corpus: "middlemarch",
    chapters: { start: 10, end: 15 },
  },
  references: ["jane-eyre", "moby-dick"],
  seed: 17,
  agentCount: 2,
  stageCount: 4,
  stageIntervalMs: 10,
  rekeys: [],
};

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

async function artifactFiles(directory: string, current = directory): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await artifactFiles(directory, path)));
    } else if (entry.isFile()) {
      files.push(relative(directory, path));
    }
  }
  return files.sort();
}

describe("operator CLI contract", () => {
  it("publishes the five existing commands plus experiment", async () => {
    const scripts = await packageScripts();
    const commandNames = Object.keys(scripts)
      .filter((name) => name.startsWith("puzzle:"))
      .sort();

    expect(commandNames).toEqual([
      "puzzle:build",
      "puzzle:evaluate",
      "puzzle:experiment",
      "puzzle:offline",
      "puzzle:run",
      "puzzle:sandbox:build",
    ]);
    for (const name of commandNames) {
      expect(scripts[name]?.trim().length).toBeGreaterThan(0);
    }
  });

  it("accepts the provider-neutral build, run, experiment, and evaluate flag names", () => {
    expect(
      parseFlags([
        "--",
        "--config",
        "experiments/config.yaml",
        "--run",
        "mixed",
        "--output",
        "attempt",
        "--build",
        "build",
        "--attempt",
        "attempt",
        "--workspace",
        "agent-1",
        "--command",
        "sh solve.sh",
        "--output-path",
        "reconstruction.txt",
        "--notes",
        "reviewed",
      ]),
    ).toEqual(
      new Map([
        ["--config", "experiments/config.yaml"],
        ["--run", "mixed"],
        ["--output", "attempt"],
        ["--build", "build"],
        ["--attempt", "attempt"],
        ["--workspace", "agent-1"],
        ["--command", "sh solve.sh"],
        ["--output-path", "reconstruction.txt"],
        ["--notes", "reviewed"],
      ]),
    );
  });

  it("rejects missing flag values and duplicate names explicitly", () => {
    expect(() => parseFlags(["--config"])).toThrow("--config requires a value.");
    expect(() => parseFlags(["--config", "one", "--config", "two"])).toThrow(
      "--config may be provided only once.",
    );
  });

  it("builds from one experiment config and emits one absolute result", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-build-cli-"));
    const output = join(temporaryRoot, "build");
    const scripts = await packageScripts();
    const command = scripts["puzzle:build"]?.split(/\s+/);
    expect(command?.[0]).toBe("tsx");

    const result = await execute(
      process.execPath,
      [
        tsxCli,
        ...(command?.slice(1) ?? []),
        "--config",
        "experiments/config.yaml",
        "--output",
        output,
      ],
      { cwd: root },
    );

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(expectOneJsonObject(result.stdout)).toMatchObject({
      buildId: expect.stringMatching(/^build-[0-9a-f]{64}$/),
      buildPath: output,
      agentIds: ["agent-1", "agent-2", "agent-3"],
      stageCount: 6,
    });
  }, 30_000);

  it("rejects an invalid config before creating a build directory", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-invalid-config-"));
    const config = join(temporaryRoot, "invalid.yaml");
    const output = join(temporaryRoot, "build");
    const baseline = await readFile(join(root, "experiments", "config.yaml"), "utf8");
    await writeFile(config, `${baseline}\nunknownTopLevelKey: true\n`, "utf8");
    const scripts = await packageScripts();
    const command = scripts["puzzle:build"]?.split(/\s+/);

    const result = await execute(
      process.execPath,
      [tsxCli, ...(command?.slice(1) ?? []), "--config", config, "--output", output],
      { cwd: root },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Experiment configuration is invalid");
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rebuilds dynamic geometry byte-identically", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-build-determinism-"));
    const firstOutput = join(temporaryRoot, "first");
    const secondOutput = join(temporaryRoot, "second");
    const first = await buildPuzzle({
      root,
      output: firstOutput,
      puzzle: smallPuzzle,
    });
    const second = await buildPuzzle({
      root,
      output: secondOutput,
      puzzle: smallPuzzle,
    });

    expect(first).toEqual({
      buildId: expect.stringMatching(/^build-[0-9a-f]{64}$/),
      buildPath: firstOutput,
      agentIds: ["agent-1", "agent-2"],
      stageCount: 4,
    });
    expect(second).toEqual({ ...first, buildPath: secondOutput });

    const firstFiles = await artifactFiles(firstOutput);
    expect(firstFiles).toEqual(await artifactFiles(secondOutput));
    await Promise.all(
      firstFiles.map(async (path) => {
        expect(await readFile(join(firstOutput, path))).toEqual(
          await readFile(join(secondOutput, path)),
        );
      }),
    );
  }, 30_000);

  it.each([
    ["puzzle:build", []],
    ["puzzle:run", []],
    ["puzzle:evaluate", []],
    ["puzzle:experiment", []],
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
