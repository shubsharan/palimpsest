import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { decodeEvaluationRecord } from "./artifacts.js";
import { resolveCondition, type ConditionId } from "./condition.js";
import { evaluateFrozenAttempt, evaluatePuzzle } from "./evaluate.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";
import type { SandboxCommandResult } from "./sandbox/contracts.js";
import {
  FakeCommandSandbox,
  testAttemptSummary,
  testBuildManifest,
  TEST_SANDBOX_IDENTITY,
} from "./test-helpers.js";

vi.mock("./sandbox/container.js", () => ({
  createDockerCommandSandbox: vi.fn(),
}));

const createSandboxMock = vi.mocked(createDockerCommandSandbox);

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

async function conditionAttemptFixture(conditionId: ConditionId) {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-condition-evaluate-"));
  const attemptRoot = join(root, "attempt");
  const buildRoot = join(root, "build");
  const frozenRoot = join(attemptRoot, "frozen");
  const tracePath = join(attemptRoot, "trace.jsonl");
  const traceMetadataPath = join(attemptRoot, "trace.meta.json");
  const condition = resolveCondition(conditionId);
  const attempt = testAttemptSummary({ condition: conditionId });
  attempt.buildRoot = buildRoot;
  attempt.tracePath = tracePath;
  attempt.traceMetadataPath = traceMetadataPath;
  const frozen = attempt.frozen as {
    root: string;
    repositories: Array<{ repositoryId: string; path: string; agentIds: string[] }>;
    workspaces: Array<{ agentId: string; path: string; repositoryId: string }>;
  };
  frozen.root = frozenRoot;
  frozen.repositories = frozen.repositories.map((repository) => ({
    ...repository,
    path: join(frozenRoot, `${repository.repositoryId}.git`),
  }));
  frozen.workspaces = frozen.workspaces.map((workspace) => ({
    ...workspace,
    path: join(frozenRoot, "workspaces", workspace.agentId),
  }));

  const selectedWorkspace = frozen.workspaces[1]!;
  const selectedRepository = frozen.repositories.find(
    (repository) => repository.repositoryId === selectedWorkspace.repositoryId,
  );
  if (!selectedRepository) throw new Error("Fixture omitted the selected repository.");
  const variant = (
    testBuildManifest().variants as Record<string, { publicCiphertextPath: string }>
  )[condition.variantId]!;
  const ciphertextPath = join(buildRoot, variant.publicCiphertextPath);

  await Promise.all([
    mkdir(attemptRoot, { recursive: true }),
    mkdir(join(buildRoot, "oracle"), { recursive: true }),
    mkdir(join(buildRoot, "variants", condition.variantId, "complete"), { recursive: true }),
    ...frozen.repositories.map((repository) => mkdir(repository.path, { recursive: true })),
    ...frozen.workspaces.map((workspace) => mkdir(workspace.path, { recursive: true })),
  ]);
  await Promise.all([
    writeFile(join(attemptRoot, "attempt.json"), `${JSON.stringify(attempt)}\n`, "utf8"),
    writeFile(
      join(buildRoot, "puzzle-build.json"),
      `${JSON.stringify(testBuildManifest())}\n`,
      "utf8",
    ),
    writeFile(join(buildRoot, "oracle", "plaintext.txt"), "selected plaintext\n", "utf8"),
    writeFile(ciphertextPath, "ciphertext\n", "utf8"),
    writeFile(tracePath, "", "utf8"),
    writeFile(
      traceMetadataPath,
      `${JSON.stringify({ schemaVersion: 1, startedAt: new Date(0).toISOString() })}\n`,
      "utf8",
    ),
    ...frozen.workspaces.map((workspace) =>
      writeFile(join(workspace.path, `${workspace.agentId}.txt`), `${workspace.agentId}\n`, "utf8"),
    ),
  ]);
  return {
    root,
    attemptRoot,
    selectedWorkspace,
    selectedRepository,
    peerRepositories: frozen.repositories.filter(
      (repository) => repository.repositoryId !== selectedRepository.repositoryId,
    ),
  };
}

beforeEach(() => {
  createSandboxMock.mockReset();
});

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
        gitOriginPath: fixture.frozenGitPath,
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

describe("condition attempt evaluation", () => {
  it.each([
    ["not-runnable", {}],
    ["runnable", { command: "run selected solver", outputPath: "answer.txt" }],
  ] as const)("requires an explicit workspace before %s evaluation setup", async (_, selection) => {
    const fixture = await conditionAttemptFixture("IR");

    await expect(
      evaluatePuzzle({
        root: process.cwd(),
        attempt: fixture.attemptRoot,
        ...selection,
      }),
    ).rejects.toThrow("Reviewer workspace must be provided for evaluation.");
    expect(createSandboxMock).not.toHaveBeenCalled();
    await expect(access(join(fixture.attemptRoot, "evaluation"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves not-runnable evaluation for an explicitly selected workspace", async () => {
    const fixture = await conditionAttemptFixture("IR");
    const sandbox = new FakeCommandSandbox(async () => {
      throw new Error("Not-runnable evaluation must not execute a command.");
    });
    createSandboxMock.mockResolvedValue(
      sandbox as unknown as Awaited<ReturnType<typeof createDockerCommandSandbox>>,
    );

    const result = await evaluatePuzzle({
      root: process.cwd(),
      attempt: fixture.attemptRoot,
      workspace: "agent-2",
    });

    expect(result).toEqual({ status: "not-runnable" });
    expect(sandbox.requests).toEqual([]);
  });

  it.each([
    ["CR", "shared"],
    ["IR", "isolated"],
  ] as const)(
    "pairs the selected workspace with its assigned origin in %s",
    async (conditionId, communicationMode) => {
      const fixture = await conditionAttemptFixture(conditionId);
      const sandbox = new FakeCommandSandbox(async (request) => {
        if (request.profile !== "evaluation") throw new Error("Expected evaluation profile.");
        expect(await readFile(join(request.workspacePath, "agent-2.txt"), "utf8")).toBe(
          "agent-2\n",
        );
        await expect(access(join(request.workspacePath, "agent-1.txt"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        await writeFile(join(request.workspacePath, request.outputPath), "selected plaintext\n");
        return SUCCESS;
      });
      createSandboxMock.mockResolvedValue(
        sandbox as unknown as Awaited<ReturnType<typeof createDockerCommandSandbox>>,
      );

      const result = await evaluatePuzzle({
        root: process.cwd(),
        attempt: fixture.attemptRoot,
        workspace: "agent-2",
        command: "run selected solver",
        outputPath: "answer.txt",
      });

      expect(result).toMatchObject({ status: "scored", score: { accuracy: 1, coverage: 1 } });
      expect(createSandboxMock).toHaveBeenCalledWith({
        root: process.cwd(),
        expectedImageId: TEST_SANDBOX_IDENTITY.imageId,
      });
      expect(sandbox.requests).toEqual([
        expect.objectContaining({
          profile: "evaluation",
          gitOriginPath: fixture.selectedRepository.path,
          outputPath: "answer.txt",
        }),
      ]);
      for (const repository of fixture.peerRepositories) {
        expect(JSON.stringify(sandbox.requests)).not.toContain(repository.path);
      }
      expect(resolveCondition(conditionId).communicationMode).toBe(communicationMode);
    },
  );

  it.each(["missing repository", "mismatched assignment"] as const)(
    "rejects isolated topology with %s before sandbox creation",
    async (failure) => {
      const root = await mkdtemp(join(tmpdir(), "palimpsest-evaluate-invalid-topology-"));
      const attempt = testAttemptSummary({ condition: "IR" });
      const frozen = attempt.frozen as {
        repositories: Array<{ repositoryId: string; path: string; agentIds: string[] }>;
        workspaces: Array<{ agentId: string; path: string; repositoryId: string }>;
      };
      if (failure === "missing repository") {
        frozen.repositories = frozen.repositories.slice(0, 2);
      } else {
        frozen.workspaces[1] = { ...frozen.workspaces[1]!, repositoryId: "agent-1" };
      }
      await writeFile(join(root, "attempt.json"), `${JSON.stringify(attempt)}\n`, "utf8");

      await expect(
        evaluatePuzzle({
          root: process.cwd(),
          attempt: root,
          workspace: "agent-2",
          command: "must not run",
          outputPath: "answer.txt",
        }),
      ).rejects.toThrow(/frozen Git|condition-assigned repository/i);
      expect(createSandboxMock).not.toHaveBeenCalled();
      await expect(access(join(root, "evaluation"))).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});
