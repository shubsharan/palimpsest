import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runGit } from "./git.js";
import {
  executePublishedSolver,
  materializePublishedSolver,
  MAX_SOLVER_OUTPUT_BYTES,
  PUBLISHED_MAIN_REF,
  resolvePublishedSolver,
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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("published solver snapshots", () => {
  it("exports the exact main commit without Git metadata or alternate branch files", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "origin.git");
    await runGit(["init", "--bare", "--initial-branch=main", repository]);
    const mainCommit = await publish(repository, "main", {
      "solver.py": "from helper import answer\n",
      "helper.py": "answer = 'main'\n",
    });
    await publish(repository, "alternate", {
      "solver.py": "raise RuntimeError('alternate')\n",
      "alternate-only.txt": "must not be exported\n",
    });
    await runGit(["symbolic-ref", "HEAD", "refs/heads/alternate"], repository);

    const identity = await resolvePublishedSolver(repository);
    expect(identity).toEqual({ ref: PUBLISHED_MAIN_REF, commit: mainCommit });

    const snapshot = join(root, "snapshot");
    await materializePublishedSolver(repository, snapshot, identity);

    await expect(readFile(join(snapshot, "helper.py"), "utf8")).resolves.toBe("answer = 'main'\n");
    await expect(access(join(snapshot, "alternate-only.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(snapshot, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the captured commit stable when main advances before materialization", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "origin.git");
    await runGit(["init", "--bare", "--initial-branch=main", repository]);
    await publish(repository, "main", { "solver.py": "print('first')\n" });
    const identity = await resolvePublishedSolver(repository);
    await publish(repository, "main", { "solver.py": "print('second')\n" });

    const snapshot = join(root, "snapshot");
    await materializePublishedSolver(repository, snapshot, identity);

    await expect(readFile(join(snapshot, "solver.py"), "utf8")).resolves.toBe("print('first')\n");
  });

  it("rejects a repository without a published main commit", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "origin.git");
    await runGit(["init", "--bare", "--initial-branch=main", repository]);

    await expect(resolvePublishedSolver(repository)).rejects.toThrow(
      "Published ref refs/heads/main must resolve to a commit.",
    );
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
        snapshotPath,
        ciphertextPath,
        outputRoot,
        sandbox,
      });

      expect(result.error).toMatch(/did not produce|empty|regular file|resolves outside|exceeds/);
    },
  );
});
