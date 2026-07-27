import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateFrozenAttempt } from "../src/evaluator.js";
import type { SandboxCommandResult } from "../src/sandbox.js";
import { FakeCommandSandbox } from "./helpers.js";

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
      score: async () => ({ accuracy: 1 }),
    });
    expect(result.status).toBe(status);
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
      score: async () => ({ matchedWords: 1, totalWords: 2, accuracy: 0.5 }),
    });

    expect(result).toMatchObject({
      status: "scored",
      score: { matchedWords: 1, totalWords: 2, accuracy: 0.5 },
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
        return {};
      },
    });

    expect(result).toMatchObject({ status: "execution-error" });
    expect(result.error).toContain("resolves outside");
    expect(scored).toBe(false);
  });
});
