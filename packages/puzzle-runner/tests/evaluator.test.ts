import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateFrozenAttempt } from "../src/evaluator.js";

describe("frozen attempt evaluation", () => {
  it.each([
    [undefined, "not-runnable"],
    [{ command: "true", outputPath: "answer.txt" }, "no-output"],
    [{ command: "exit 7", outputPath: "answer.txt" }, "execution-error"],
  ] as const)("reports %s selection as %s", async (selection, status) => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-evaluate-"));
    const frozen = join(root, "frozen");
    await mkdir(frozen);
    const result = await evaluateFrozenAttempt({
      frozenWorkspacePath: frozen,
      evaluationRoot: join(root, "evaluation"),
      ciphertextPath: join(root, "ciphertext.txt"),
      selection,
      score: async () => ({ accuracy: 1 }),
    });
    expect(result.status).toBe(status);
  });

  it("records selection before execution and preserves the score", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-score-"));
    const frozen = join(root, "frozen");
    await mkdir(frozen);
    await writeFile(join(frozen, "solver.sh"), "printf 'answer' > \"$PALIMPSEST_OUTPUT\"\n", {
      encoding: "utf8",
      mode: 0o755,
    });
    const kinds: string[] = [];
    const result = await evaluateFrozenAttempt({
      frozenWorkspacePath: frozen,
      evaluationRoot: join(root, "evaluation"),
      ciphertextPath: join(root, "ciphertext.txt"),
      selection: { command: "sh solver.sh", outputPath: "answer.txt" },
      observe: async (kind) => {
        kinds.push(kind);
      },
      score: async () => ({ matchedWords: 1, totalWords: 2, accuracy: 0.5 }),
    });
    expect(result).toMatchObject({
      status: "scored",
      score: { matchedWords: 1, totalWords: 2, accuracy: 0.5 },
    });
    expect(kinds.indexOf("reviewer.selection")).toBeLessThan(kinds.indexOf("evaluation.started"));
    const recorded = JSON.parse(
      await readFile(join(root, "evaluation", "selection.json"), "utf8"),
    ) as {
      selection: { command: string; outputPath: string };
    };
    expect(recorded.selection).toEqual({
      command: "sh solver.sh",
      outputPath: "answer.txt",
    });
    expect(
      JSON.parse(await readFile(join(root, "evaluation", "result.json"), "utf8")),
    ).toMatchObject({ status: "scored", score: { accuracy: 0.5 } });
  });
});
