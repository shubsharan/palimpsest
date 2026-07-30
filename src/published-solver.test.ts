import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runGit } from "./git.js";
import { executePublishedSolver } from "./published-solver.js";
import { FakeCommandSandbox } from "./test-helpers.js";

const SUCCESS = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  outputExceeded: false,
} as const;

async function repositoryFixture(options: { trackedOutput?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-published-solver-"));
  const repositoryPath = join(root, "origin.git");
  const seedPath = join(root, "seed");
  const ciphertextPath = join(root, "ciphertext.txt");
  await runGit(["init", "--bare", "--initial-branch=main", repositoryPath]);
  await runGit(["clone", repositoryPath, seedPath]);
  await runGit(["config", "user.name", "Palimpsest Test"], seedPath);
  await runGit(["config", "user.email", "test@palimpsest.invalid"], seedPath);
  await writeFile(join(seedPath, "solver.py"), "# main solver\n", "utf8");
  if (options.trackedOutput === true) {
    await writeFile(join(seedPath, "reconstruction.txt"), "stale answer\n", "utf8");
  }
  await runGit(["add", "."], seedPath);
  await runGit(["commit", "-m", "Publish main solver"], seedPath);
  await runGit(["push", "origin", "main"], seedPath);
  await writeFile(ciphertextPath, "ciphertext\n", "utf8");
  return { root, repositoryPath, seedPath, ciphertextPath };
}

describe("published solver execution", () => {
  it("materializes refs/heads/main even when the bare origin HEAD names another branch", async () => {
    const fixture = await repositoryFixture();
    await runGit(["checkout", "-b", "decoy"], fixture.seedPath);
    await writeFile(join(fixture.seedPath, "solver.py"), "# decoy solver\n", "utf8");
    await runGit(["commit", "-am", "Publish decoy solver"], fixture.seedPath);
    await runGit(["push", "origin", "decoy"], fixture.seedPath);
    await runGit(["symbolic-ref", "HEAD", "refs/heads/decoy"], fixture.repositoryPath);

    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "evaluation") throw new Error("Expected evaluation profile.");
      expect(await readFile(join(request.workspacePath, "submission", "solver.py"), "utf8")).toBe(
        "# main solver\n",
      );
      await writeFile(join(request.workspacePath, request.outputPath), "answer\n", "utf8");
      return SUCCESS;
    });
    const result = await executePublishedSolver({
      repositoryPath: fixture.repositoryPath,
      ciphertextPaths: [fixture.ciphertextPath],
      executionRoot: join(fixture.root, "execution"),
      sandbox,
    });

    expect(result.status).toBe("succeeded");
    expect(result).toMatchObject({ commit: expect.stringMatching(/^[a-f0-9]{40}$/) });
  });

  it("runs from a sterile tree without Git, agent mounts, or the origin", async () => {
    const fixture = await repositoryFixture();
    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "evaluation") throw new Error("Expected evaluation profile.");
      await expect(access(join(request.workspacePath, "submission", ".git"))).rejects.toMatchObject(
        {
          code: "ENOENT",
        },
      );
      expect(JSON.stringify(request)).not.toMatch(/gitOriginPath|evidencePath|referenceCorpusPath/);
      await writeFile(join(request.workspacePath, request.outputPath), "answer\n", "utf8");
      return SUCCESS;
    });

    await expect(
      executePublishedSolver({
        repositoryPath: fixture.repositoryPath,
        ciphertextPaths: [fixture.ciphertextPath],
        executionRoot: join(fixture.root, "execution"),
        sandbox,
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  it("does not accept a tracked reconstruction when the solver produces no output", async () => {
    const fixture = await repositoryFixture({ trackedOutput: true });
    const sandbox = new FakeCommandSandbox(async () => SUCCESS);
    const result = await executePublishedSolver({
      repositoryPath: fixture.repositoryPath,
      ciphertextPaths: [fixture.ciphertextPath],
      executionRoot: join(fixture.root, "execution"),
      sandbox,
    });

    expect(result).toMatchObject({ status: "no-output" });
    if (result.status !== "no-output") throw new Error("Expected the canonical output path.");
    await expect(access(result.outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps checkout and solver failures distinct", async () => {
    const fixture = await repositoryFixture();
    const failed = await executePublishedSolver({
      repositoryPath: fixture.repositoryPath,
      ciphertextPaths: [fixture.ciphertextPath],
      executionRoot: join(fixture.root, "failed-execution"),
      sandbox: new FakeCommandSandbox(async () => ({
        ...SUCCESS,
        exitCode: 2,
        stderr: "solver failed",
      })),
    });
    expect(failed).toMatchObject({
      status: "execution-error",
      commit: expect.stringMatching(/^[a-f0-9]{40}$/),
      execution: { exitCode: 2, stderr: "solver failed" },
    });

    const emptyRoot = await mkdtemp(join(tmpdir(), "palimpsest-empty-origin-"));
    const emptyOrigin = join(emptyRoot, "origin.git");
    const ciphertextPath = join(emptyRoot, "ciphertext.txt");
    await runGit(["init", "--bare", "--initial-branch=main", emptyOrigin]);
    await writeFile(ciphertextPath, "ciphertext\n", "utf8");
    await expect(
      executePublishedSolver({
        repositoryPath: emptyOrigin,
        ciphertextPaths: [ciphertextPath],
        executionRoot: join(emptyRoot, "execution"),
        sandbox: new FakeCommandSandbox(),
      }),
    ).resolves.toMatchObject({ status: "checkout-error" });
  });
});
