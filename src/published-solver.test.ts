import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runGit } from "./git.js";
import {
  executePublishedSolver,
  MAX_SOLVER_OUTPUT_BYTES,
  PUBLISHED_MAIN_REF,
  PublishedSolverInfrastructureError,
  PublishedSolverSubmissionError,
  runPublishedSolver,
} from "./published-solver.js";
import { FakeCommandSandbox } from "./test-helpers.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-published-solver-test-"));
  temporaryRoots.push(root);
  return root;
}

async function publish(
  repositoryPath: string,
  branch: string,
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const root = await temporaryRoot();
  const checkout = join(root, "checkout");
  await runGit(["clone", repositoryPath, checkout]);
  await runGit(["config", "user.name", "Palimpsest Test"], checkout);
  await runGit(["config", "user.email", "test@palimpsest.invalid"], checkout);
  if (branch !== "main") await runGit(["switch", "-c", branch], checkout);
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(checkout, path), content, "utf8");
  }
  await runGit(["add", "."], checkout);
  await runGit(["commit", "-m", `Publish ${branch}`], checkout);
  await runGit(["push", "origin", `HEAD:refs/heads/${branch}`], checkout);
  return (await runGit(["rev-parse", "HEAD"], checkout)).stdout.trim();
}

async function forcePublishUnrelatedMain(
  repositoryPath: string,
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const root = await temporaryRoot();
  const checkout = join(root, "unrelated");
  await runGit(["init", "--initial-branch=main", checkout]);
  await runGit(["config", "user.name", "Palimpsest Test"], checkout);
  await runGit(["config", "user.email", "test@palimpsest.invalid"], checkout);
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(checkout, path), content, "utf8");
  }
  await runGit(["add", "."], checkout);
  await runGit(["commit", "-m", "Replace main"], checkout);
  await runGit(["remote", "add", "origin", repositoryPath], checkout);
  await runGit(["push", "--force", "origin", "HEAD:refs/heads/main"], checkout);
  return (await runGit(["rev-parse", "HEAD"], checkout)).stdout.trim();
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("published solver snapshots", () => {
  it("runs the exact main commit and returns only after removing its Git-free snapshot", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "origin.git");
    const ciphertextPath = join(root, "ciphertext.txt");
    const outputRoot = join(root, "output");
    await runGit(["init", "--bare", "--initial-branch=main", repository]);
    await Promise.all([writeFile(ciphertextPath, "ciphertext\n"), mkdir(outputRoot)]);
    const mainCommit = await publish(repository, "main", {
      "solver.py": "from helper import answer\n",
      "helper.py": "answer = 'main'\n",
    });
    await publish(repository, "alternate", {
      "solver.py": "raise RuntimeError('alternate')\n",
      "alternate-only.txt": "must not be exported\n",
    });
    await runGit(["symbolic-ref", "HEAD", "refs/heads/alternate"], repository);
    let submissionPath = "";
    const captured: unknown[] = [];
    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "solver") throw new Error("Expected solver profile.");
      submissionPath = request.submissionPath;
      await expect(readFile(join(submissionPath, "helper.py"), "utf8")).resolves.toBe(
        "answer = 'main'\n",
      );
      await expect(access(join(submissionPath, "alternate-only.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(access(join(submissionPath, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(join(request.outputRoot, request.outputPath), "answer\n");
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        outputExceeded: false,
      };
    });

    const outcome = await runPublishedSolver({
      repositoryPath: repository,
      ciphertextPath,
      outputRoot,
      sandbox,
      deadline: performance.now() + 5_000,
      onCaptured: (identity) => {
        captured.push(identity);
      },
      evaluate: async ({ outputPath }) => readFile(outputPath, "utf8"),
    });

    expect(outcome).toEqual({
      kind: "succeeded",
      identity: { ref: PUBLISHED_MAIN_REF, commit: mainCommit },
      execution: expect.objectContaining({ exitCode: 0 }),
      outputPath: join(outputRoot, "reconstruction.txt"),
      value: "answer\n",
    });
    expect(captured).toEqual([{ ref: PUBLISHED_MAIN_REF, commit: mainCommit }]);
    await expect(access(submissionPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the materialized commit stable after an unrelated force-push", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "origin.git");
    const ciphertextPath = join(root, "ciphertext.txt");
    const outputRoot = join(root, "output");
    await runGit(["init", "--bare", "--initial-branch=main", repository]);
    await Promise.all([writeFile(ciphertextPath, "ciphertext\n"), mkdir(outputRoot)]);
    const firstCommit = await publish(repository, "main", { "solver.py": "print('first')\n" });
    let submittedSolver = "";
    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "solver") throw new Error("Expected solver profile.");
      const replacement = await forcePublishUnrelatedMain(repository, {
        "solver.py": "print('replacement')\n",
      });
      expect(replacement).not.toBe(firstCommit);
      submittedSolver = await readFile(join(request.submissionPath, "solver.py"), "utf8");
      await writeFile(join(request.outputRoot, request.outputPath), "answer\n");
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        outputExceeded: false,
      };
    });

    const outcome = await runPublishedSolver({
      repositoryPath: repository,
      ciphertextPath,
      outputRoot,
      sandbox,
      deadline: performance.now() + 5_000,
      evaluate: async () => "scored",
    });

    expect(outcome).toMatchObject({
      kind: "succeeded",
      identity: { commit: firstCommit },
      value: "scored",
    });
    expect(submittedSolver).toBe("print('first')\n");
  });

  it("rejects a repository without a published main commit", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "origin.git");
    const outputRoot = join(root, "output");
    const ciphertextPath = join(root, "ciphertext.txt");
    await runGit(["init", "--bare", "--initial-branch=main", repository]);
    await Promise.all([mkdir(outputRoot), writeFile(ciphertextPath, "ciphertext\n")]);

    await expect(
      runPublishedSolver({
        repositoryPath: repository,
        ciphertextPath,
        outputRoot,
        sandbox: new FakeCommandSandbox(async () => {
          throw new Error("Sandbox must not run.");
        }),
        deadline: performance.now() + 5_000,
        evaluate: async () => "unreachable",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PublishedSolverSubmissionError>>({
        name: "PublishedSolverSubmissionError",
        message: "Published ref refs/heads/main must resolve to an available commit.",
      }),
    );
  });

  it("cancels capture without invoking the callback or retaining a snapshot", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "origin.git");
    const outputRoot = join(root, "output");
    const ciphertextPath = join(root, "ciphertext.txt");
    await runGit(["init", "--bare", "--initial-branch=main", repository]);
    await Promise.all([mkdir(outputRoot), writeFile(ciphertextPath, "ciphertext\n")]);
    const controller = new AbortController();
    controller.abort();
    let invoked = false;

    await expect(
      runPublishedSolver({
        repositoryPath: repository,
        ciphertextPath,
        outputRoot,
        sandbox: new FakeCommandSandbox(async () => {
          invoked = true;
          throw new Error("Sandbox must not run.");
        }),
        deadline: performance.now() + 5_000,
        signal: controller.signal,
        evaluate: async () => "unreachable",
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(invoked).toBe(false);
  });

  it("classifies trusted evaluator rejection as infrastructure and completes cleanup first", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "origin.git");
    const outputRoot = join(root, "output");
    const ciphertextPath = join(root, "ciphertext.txt");
    await runGit(["init", "--bare", "--initial-branch=main", repository]);
    await Promise.all([mkdir(outputRoot), writeFile(ciphertextPath, "ciphertext\n")]);
    await publish(repository, "main", { "solver.py": "print('solver')\n" });
    let submissionPath = "";
    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "solver") throw new Error("Expected solver profile.");
      submissionPath = request.submissionPath;
      await writeFile(join(request.outputRoot, request.outputPath), "answer\n");
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        outputExceeded: false,
      };
    });

    await expect(
      runPublishedSolver({
        repositoryPath: repository,
        ciphertextPath,
        outputRoot,
        sandbox,
        deadline: performance.now() + 5_000,
        evaluate: async () => {
          throw new Error("checker crashed");
        },
      }),
    ).rejects.toThrow(PublishedSolverInfrastructureError);
    await expect(access(submissionPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["missing", "empty", "directory", "escaping-symlink", "oversized"] as const)(
    "rejects %s solver output before scoring",
    async (failure) => {
      const root = await temporaryRoot();
      const snapshotPath = join(root, "submission");
      const outputRoot = join(root, "output");
      const ciphertextPath = join(root, "ciphertext.txt");
      const outside = join(root, "outside.txt");
      await Promise.all([
        mkdir(snapshotPath),
        mkdir(outputRoot),
        writeFile(ciphertextPath, "ciphertext\n"),
        writeFile(outside, "outside\n"),
      ]);
      const sandbox = new FakeCommandSandbox(async (request) => {
        if (request.profile !== "solver") throw new Error("Expected solver profile.");
        const outputPath = join(request.outputRoot, request.outputPath);
        if (failure === "empty") await writeFile(outputPath, "");
        if (failure === "directory") await mkdir(outputPath);
        if (failure === "escaping-symlink") await symlink(outside, outputPath);
        if (failure === "oversized") {
          await writeFile(outputPath, Buffer.alloc(MAX_SOLVER_OUTPUT_BYTES + 1));
        }
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          outputExceeded: false,
        };
      });

      const result = await executePublishedSolver({
        snapshot: {
          ref: PUBLISHED_MAIN_REF,
          commit: "0".repeat(40),
          snapshotPath,
        },
        ciphertextPath,
        outputRoot,
        sandbox,
      });

      expect(result).toMatchObject({
        kind: "submission-error",
        error: expect.stringMatching(/did not produce|empty|regular file|resolves outside|exceeds/),
      });
    },
  );
});
