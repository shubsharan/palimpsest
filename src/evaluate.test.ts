import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeAttemptSummary } from "./artifacts.js";
import { evaluateCanonicalOrigins, evaluatePuzzleFromFlags } from "./evaluate.js";
import { runGit } from "./git.js";
import type { AgentId } from "./model.js";
import type { SandboxCommandResult } from "./sandbox/contracts.js";
import { FakeCommandSandbox, testAttemptSummary } from "./test-helpers.js";

const SUCCESS: SandboxCommandResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  outputExceeded: false,
};

const CELL = { matchedWords: 1, totalWords: 1, accuracy: 1 } as const;

function diagnostics(expected = 2, predicted = 2) {
  const empty = { matchedWords: 0, totalWords: 0, accuracy: null } as const;
  return {
    overall: { matchedWords: 2, totalWords: 2, accuracy: 1 },
    regions: { preBoundary: CELL, postBoundary: CELL },
    changed: { preBoundary: empty, postBoundary: empty },
    controls: { preBoundary: empty, postBoundary: empty },
    sentinels: { preBoundary: empty, postBoundary: empty },
    specialists: { preBoundary: empty, postBoundary: empty },
    stages: Array.from({ length: 6 }, (_, index) => ({
      stage: index + 1,
      score: index < 2 ? CELL : empty,
    })),
    evidenceOwners: (["agent-1", "agent-2", "agent-3"] as const).map((agentId, index) => ({
      agentId,
      score: index < 2 ? CELL : empty,
    })),
    changedTypes: [],
    macroChangedTypeAccuracy: null,
    positionHandling: {
      expected,
      predicted,
      compared: Math.min(expected, predicted),
      missing: Math.max(0, expected - predicted),
      extra: Math.max(0, predicted - expected),
      coverage: expected === 0 ? Number(predicted === 0) : Math.min(expected, predicted) / expected,
    },
  };
}

async function publishSolver(repositoryPath: string): Promise<void> {
  await runGit(["init", "--bare", "--initial-branch=main", repositoryPath]);
  const seed = await mkdtemp(join(tmpdir(), "palimpsest-evaluator-seed-"));
  const checkout = join(seed, "checkout");
  await runGit(["clone", repositoryPath, checkout]);
  await runGit(["config", "user.name", "Evaluator Test"], checkout);
  await runGit(["config", "user.email", "evaluator@palimpsest.invalid"], checkout);
  await writeFile(join(checkout, "solver.py"), "print('fixture')\n", "utf8");
  await runGit(["add", "solver.py"], checkout);
  await runGit(["commit", "-m", "Publish solver"], checkout);
  await runGit(["push", "origin", "main"], checkout);
}

async function targets(ids: readonly ("shared" | AgentId)[]) {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-evaluator-origins-"));
  return Promise.all(
    ids.map(async (originId) => {
      const repositoryPath = join(root, `${originId}.git`);
      await publishSolver(repositoryPath);
      return { originId, repositoryPath, realizedTeamProduct: originId === "shared" };
    }),
  );
}

describe("canonical origin evaluation", () => {
  it("evaluates one shared origin with canonical command and a null integration gap", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-evaluator-shared-"));
    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "solver") throw new Error("expected solver sandbox");
      await writeFile(join(request.outputRoot, request.outputPath), "one two\n", "utf8");
      return SUCCESS;
    });
    const record = await evaluateCanonicalOrigins({
      attempt: decodeAttemptSummary(testAttemptSummary({ condition: "CS" })),
      targets: await targets(["shared"]),
      evaluationRoot: root,
      ciphertextPath: join(root, "ciphertext.txt"),
      sandbox,
      score: async () => ({
        aggregate: { matchedWords: 2, totalWords: 2, coverage: 1, accuracy: 1 },
        diagnostics: diagnostics(),
        correctPositions: [true, true],
        predictedWords: 2,
      }),
      now: () => new Date(0),
    });

    expect(record.origins).toHaveLength(1);
    expect(record.origins[0]).toMatchObject({
      origin: { originId: "shared", ref: "refs/heads/main", realizedTeamProduct: true },
      status: "scored",
    });
    expect(record.team).toEqual({
      realizedProductOriginId: "shared",
      collectiveCeiling: { matchedWords: 2, totalWords: 2, coverage: 1, accuracy: 1 },
      integrationGap: null,
      integrationGapReason: "shared-single-origin",
    });
    expect(sandbox.requests[0]).toMatchObject({
      command: "python3 solver.py",
      outputPath: "reconstruction.txt",
    });
    expect(JSON.stringify(record)).not.toContain("one two");
  });

  it("evaluates isolated origins in order and computes a position-wise ceiling", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-evaluator-isolated-"));
    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "solver") throw new Error("expected solver sandbox");
      await writeFile(join(request.outputRoot, request.outputPath), "candidate\n", "utf8");
      return SUCCESS;
    });
    const positionFacts = [
      [true, false],
      [false, true],
      [false, false],
    ];
    let index = 0;
    let activeScores = 0;
    let maximumActiveScores = 0;
    const record = await evaluateCanonicalOrigins({
      attempt: decodeAttemptSummary(testAttemptSummary({ condition: "IR" })),
      targets: await targets(["agent-1", "agent-2", "agent-3"]),
      evaluationRoot: root,
      ciphertextPath: join(root, "ciphertext.txt"),
      sandbox,
      score: async () => {
        activeScores += 1;
        maximumActiveScores = Math.max(maximumActiveScores, activeScores);
        await Promise.resolve();
        activeScores -= 1;
        return {
          aggregate: { matchedWords: 1, totalWords: 2, coverage: 1, accuracy: 0.5 },
          diagnostics: diagnostics(),
          correctPositions: positionFacts[index++]!,
          predictedWords: 2,
        };
      },
      now: () => new Date(0),
    });

    expect(record.origins.map(({ origin }) => origin.originId)).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
    ]);
    expect(record.team).toEqual({
      realizedProductOriginId: null,
      collectiveCeiling: { matchedWords: 2, totalWords: 2, coverage: 1, accuracy: 1 },
      integrationGap: null,
      integrationGapReason: "isolated-no-realized-product",
    });
    expect(maximumActiveScores).toBe(1);
  });

  it("computes the isolated ceiling from only scoreable origins", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-evaluator-partial-"));
    let execution = 0;
    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "solver") throw new Error("expected solver sandbox");
      execution += 1;
      if (execution === 2) return { ...SUCCESS, exitCode: 1 };
      await writeFile(join(request.outputRoot, request.outputPath), "candidate\n", "utf8");
      return SUCCESS;
    });
    let score = 0;
    const record = await evaluateCanonicalOrigins({
      attempt: decodeAttemptSummary(testAttemptSummary({ condition: "IS" })),
      targets: await targets(["agent-1", "agent-2", "agent-3"]),
      evaluationRoot: root,
      ciphertextPath: join(root, "ciphertext.txt"),
      sandbox,
      score: async () => ({
        aggregate: { matchedWords: 1, totalWords: 2, coverage: 1, accuracy: 0.5 },
        diagnostics: diagnostics(),
        correctPositions: score++ === 0 ? [true, false] : [false, true],
        predictedWords: 2,
      }),
      now: () => new Date(0),
    });

    expect(record.origins.map(({ status }) => status)).toEqual([
      "scored",
      "execution-error",
      "scored",
    ]);
    expect(record.team.collectiveCeiling).toEqual({
      matchedWords: 2,
      totalWords: 2,
      coverage: 1,
      accuracy: 1,
    });
    expect(record.team.integrationGapReason).toBe("isolated-no-realized-product");
  });

  it("retains a missing main as a terminal origin outcome", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-evaluator-missing-"));
    const repositoryPath = join(root, "shared.git");
    await runGit(["init", "--bare", "--initial-branch=main", repositoryPath]);
    const sandbox = new FakeCommandSandbox(async () => SUCCESS);
    const record = await evaluateCanonicalOrigins({
      attempt: decodeAttemptSummary(testAttemptSummary({ condition: "CR" })),
      targets: [{ originId: "shared", repositoryPath, realizedTeamProduct: true }],
      evaluationRoot: root,
      ciphertextPath: join(root, "ciphertext.txt"),
      sandbox,
      score: async () => {
        throw new Error("score must not run");
      },
      now: () => new Date(0),
    });

    expect(record.origins[0]).toMatchObject({ status: "not-runnable" });
    expect(record.team.collectiveCeiling).toBeNull();
    expect(record.team.integrationGapReason).toBe("shared-single-origin");
    expect(sandbox.requests).toEqual([]);
  });

  it("rejects every evaluator option except --attempt", () => {
    for (const flag of [
      "--workspace",
      "--notes",
      "--command",
      "--output-path",
      "--branch",
      "--ref",
    ]) {
      expect(() =>
        evaluatePuzzleFromFlags(
          new Map([
            ["--attempt", "attempt"],
            [flag, "value"],
          ]),
        ),
      ).toThrow(`Unknown evaluate option ${flag}.`);
    }
  });
});
