import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeEvaluationRecord } from "./artifacts.js";
import { evaluateFrozenAttempt } from "./evaluate.js";
import type { SandboxCommandResult } from "./sandbox/contracts.js";
import { FakeCommandSandbox } from "./test-helpers.js";

const SUCCESS: SandboxCommandResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  outputExceeded: false,
};

async function evaluationFixture() {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-evaluate-"));
  const frozenWorkspacePath = join(root, "frozen-workspace");
  const frozenGitPath = join(root, "frozen-shared.git");
  const ciphertextPath = join(root, "ciphertext.txt");
  await Promise.all([
    mkdir(frozenWorkspacePath),
    mkdir(frozenGitPath),
    writeFile(ciphertextPath, "ciphertext\n"),
  ]);
  return { root, frozenWorkspacePath, frozenGitPath, ciphertextPath };
}

describe("frozen attempt evaluation", () => {
  it.each([
    [undefined, "not-runnable"],
    [{ command: "true", outputPath: "answer.txt" }, "no-output"],
    [{ command: "exit 7", outputPath: "answer.txt" }, "execution-error"],
  ] as const)("reports %s selection as %s", async (selection, status) => {
    const fixture = await evaluationFixture();
    const sandbox = new FakeCommandSandbox(async (request) => ({
      ...SUCCESS,
      exitCode: request.command === "exit 7" ? 7 : 0,
    }));
    const result = await evaluateFrozenAttempt({
      ...fixture,
      evaluationRoot: join(fixture.root, "evaluation"),
      selection,
      sandbox,
      score: async () => ({ matchedWords: 1, totalWords: 1, coverage: 1, accuracy: 1 }),
    });
    expect(result.status).toBe(status);
  });

  it("rejects a whitespace-only command before consuming the one-shot evaluation root", async () => {
    const fixture = await evaluationFixture();
    const evaluationRoot = join(fixture.root, "evaluation");
    const sandbox = new FakeCommandSandbox(async () => SUCCESS);
    const options = {
      ...fixture,
      evaluationRoot,
      sandbox,
      score: async () => ({ matchedWords: 1, totalWords: 1, coverage: 1, accuracy: 1 }),
    };

    await expect(
      evaluateFrozenAttempt({
        ...options,
        selection: { command: " \t ", outputPath: "answer.txt" },
      }),
    ).rejects.toThrow("Reviewer command must contain non-whitespace shell source.");
    await expect(access(evaluationRoot)).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      evaluateFrozenAttempt({
        ...options,
        selection: { command: "true", outputPath: "answer.txt" },
      }),
    ).resolves.toMatchObject({ status: "no-output" });
  });

  it("rejects empty notes before consuming the one-shot evaluation root", async () => {
    const fixture = await evaluationFixture();
    const evaluationRoot = join(fixture.root, "evaluation");
    const options = {
      ...fixture,
      evaluationRoot,
      sandbox: new FakeCommandSandbox(async () => SUCCESS),
      score: async () => ({ matchedWords: 1, totalWords: 1, coverage: 1, accuracy: 1 }),
    };

    await expect(
      evaluateFrozenAttempt({
        ...options,
        selection: { command: "true", outputPath: "answer.txt", notes: " \t " },
      }),
    ).rejects.toThrow("Reviewer notes must contain non-whitespace text.");
    await expect(access(evaluationRoot)).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      evaluateFrozenAttempt({
        ...options,
        selection: { command: "true", outputPath: "answer.txt", notes: "run the solver" },
      }),
    ).resolves.toMatchObject({ status: "no-output" });
  });

  it("rejects an unsafe output path before consuming the one-shot evaluation root", async () => {
    const fixture = await evaluationFixture();
    const evaluationRoot = join(fixture.root, "evaluation");
    const options = {
      ...fixture,
      evaluationRoot,
      sandbox: new FakeCommandSandbox(async () => SUCCESS),
      score: async () => ({ matchedWords: 1, totalWords: 1, coverage: 1, accuracy: 1 }),
    };

    await expect(
      evaluateFrozenAttempt({
        ...options,
        selection: { command: "true", outputPath: "../answer.txt" },
      }),
    ).rejects.toThrow("Reviewer outputPath must be a safe relative path.");
    await expect(access(evaluationRoot)).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      evaluateFrozenAttempt({
        ...options,
        selection: { command: "true", outputPath: "answer.txt" },
      }),
    ).resolves.toMatchObject({ status: "no-output" });
  });

  it("records selection before sandbox execution and preserves the score", async () => {
    const fixture = await evaluationFixture();
    await writeFile(
      join(fixture.frozenWorkspacePath, "solver.sh"),
      "printf 'answer' > \"$PALIMPSEST_OUTPUT\"\n",
      { encoding: "utf8", mode: 0o755 },
    );
    const kinds: string[] = [];
    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "evaluation") throw new Error("Expected evaluation profile.");
      await writeFile(join(request.workspacePath, request.outputPath), "answer");
      return SUCCESS;
    });
    const result = await evaluateFrozenAttempt({
      ...fixture,
      evaluationRoot: join(fixture.root, "evaluation"),
      selection: { command: "sh solver.sh", outputPath: "answer.txt" },
      sandbox,
      observe: async (kind) => {
        kinds.push(kind);
      },
      score: async () => ({
        matchedWords: 1,
        totalWords: 2,
        coverage: 1,
        accuracy: 0.5,
      }),
    });

    expect(result).toMatchObject({
      status: "scored",
      score: { matchedWords: 1, totalWords: 2, coverage: 1, accuracy: 0.5 },
    });
    expect(sandbox.requests).toEqual([
      expect.objectContaining({
        profile: "evaluation",
        frozenGitPath: fixture.frozenGitPath,
        ciphertextPath: fixture.ciphertextPath,
        outputPath: "answer.txt",
      }),
    ]);
    expect(kinds.indexOf("reviewer.selection")).toBeLessThan(kinds.indexOf("evaluation.started"));
    const recorded = JSON.parse(
      await readFile(join(fixture.root, "evaluation", "selection.json"), "utf8"),
    ) as {
      selection: { command: string; outputPath: string };
    };
    expect(recorded.selection).toEqual({
      command: "sh solver.sh",
      outputPath: "answer.txt",
    });
  });

  it("converts malformed scorer output into a valid execution-error record", async () => {
    const fixture = await evaluationFixture();
    const evaluationRoot = join(fixture.root, "evaluation");
    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "evaluation") throw new Error("Expected evaluation profile.");
      await writeFile(join(request.workspacePath, request.outputPath), "answer");
      return SUCCESS;
    });

    const result = await evaluateFrozenAttempt({
      ...fixture,
      evaluationRoot,
      selection: { command: "true", outputPath: "answer.txt" },
      sandbox,
      score: async () => ({ accuracy: 1 }) as never,
    });

    expect(result).toMatchObject({
      status: "execution-error",
      error: expect.stringContaining("totalWords"),
    });
    expect(
      decodeEvaluationRecord(
        JSON.parse(await readFile(join(evaluationRoot, "result.json"), "utf8")),
      ),
    ).toEqual(result);
  });

  it("rejects an evaluator output symlink that escapes the workspace", async () => {
    const fixture = await evaluationFixture();
    const outside = join(fixture.root, "outside.txt");
    await writeFile(outside, "not an evaluator output\n");
    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "evaluation") throw new Error("Expected evaluation profile.");
      await symlink(outside, join(request.workspacePath, request.outputPath));
      return SUCCESS;
    });
    let scored = false;
    const result = await evaluateFrozenAttempt({
      ...fixture,
      evaluationRoot: join(fixture.root, "evaluation"),
      selection: { command: "ln -s", outputPath: "answer.txt" },
      sandbox,
      score: async () => {
        scored = true;
        return { matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 };
      },
    });

    expect(result).toMatchObject({ status: "execution-error" });
    expect(result.error).toContain("resolves outside");
    expect(scored).toBe(false);
  });
});
