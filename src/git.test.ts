import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createGitEnvironment,
  freezeGitEnvironment,
  GitActivityMonitor,
  listRemoteRefs,
  runGit,
  SOLVER_SCAFFOLD,
} from "./git.js";
import type { AgentId } from "./model/contracts.js";

const AGENTS = ["agent-1", "agent-2", "agent-3"] as const satisfies readonly AgentId[];

describe("condition-assigned ordinary Git", () => {
  it("supports arbitrary branches, commits, pushes, fetches, and an unused clone", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-git-"));
    const environment = await createGitEnvironment(root, "shared", AGENTS);
    const [first, second, unused] = environment.workspaces;
    if (!first || !second || !unused) throw new Error("Expected three workspaces.");
    const repository = environment.repositories[0];
    if (!repository) throw new Error("Expected one shared repository.");

    await runGit(["switch", "--orphan", "ideas/first-rule"], first.path);
    await writeFile(join(first.path, "solver.ts"), "export const attempt = 1;\n", "utf8");
    await runGit(["add", "solver.ts"], first.path);
    await runGit(["commit", "-m", "try a rule"], first.path);
    await runGit(["push", repository.path, "HEAD:refs/heads/ideas/first-rule"], first.path);

    await runGit(
      [
        "fetch",
        repository.path,
        "refs/heads/ideas/first-rule:refs/remotes/origin/ideas/first-rule",
      ],
      second.path,
    );
    expect(await listRemoteRefs(repository.path)).toHaveProperty("refs/heads/ideas/first-rule");
    expect(await readFile(join(first.path, "solver.ts"), "utf8")).toContain("attempt");
    expect(await readFile(join(unused.path, "solver.py"), "utf8")).toBe(SOLVER_SCAFFOLD);
    expect((await runGit(["status", "--porcelain"], unused.path)).stdout).toBe("");
    expect((await runGit(["remote", "get-url", "origin"], unused.path)).stdout.trim()).toBe(
      "/git/origin.git",
    );
    expect(environment.repositories).toEqual([
      expect.objectContaining({ repositoryId: "shared", agentIds: AGENTS }),
    ]);
    expect(environment.workspaces.map(({ repositoryId }) => repositoryId)).toEqual([
      "shared",
      "shared",
      "shared",
    ]);
  });

  it("gives isolated agents usable origins without peer refs", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-isolated-git-"));
    const environment = await createGitEnvironment(root, "isolated", AGENTS);
    const first = environment.workspaces[0];
    const second = environment.workspaces[1];
    const firstRepository = environment.repositories[0];
    const secondRepository = environment.repositories[1];
    if (!first || !second || !firstRepository || !secondRepository) {
      throw new Error("Expected isolated workspaces and repositories.");
    }
    expect(await readFile(join(first.path, "solver.py"), "utf8")).toBe(SOLVER_SCAFFOLD);
    expect(await readFile(join(second.path, "solver.py"), "utf8")).toBe(SOLVER_SCAFFOLD);

    await runGit(["switch", "--orphan", "private/rule"], first.path);
    await writeFile(join(first.path, "rule.txt"), "agent one\n", "utf8");
    await runGit(["add", "rule.txt"], first.path);
    await runGit(["commit", "-m", "record private rule"], first.path);
    await runGit(["push", firstRepository.path, "HEAD:refs/heads/private/rule"], first.path);

    const firstRefs = await listRemoteRefs(firstRepository.path);
    const secondRefs = await listRemoteRefs(secondRepository.path);
    expect(firstRefs).toHaveProperty("refs/heads/private/rule");
    expect(firstRefs).toHaveProperty("refs/heads/main");
    expect(secondRefs).toHaveProperty("refs/heads/main");
    expect(firstRefs["refs/heads/main"]).toBe(secondRefs["refs/heads/main"]);
    expect((await runGit(["remote", "get-url", "origin"], first.path)).stdout.trim()).toBe(
      "/git/origin.git",
    );
    expect((await runGit(["remote", "get-url", "origin"], second.path)).stdout.trim()).toBe(
      "/git/origin.git",
    );
    expect(
      environment.repositories.map(({ repositoryId, agentIds }) => [repositoryId, agentIds]),
    ).toEqual(AGENTS.map((agentId) => [agentId, [agentId]]));
  });

  it("publishes repository changes only to assigned activity streams", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-git-activity-"));
    const environment = await createGitEnvironment(root, "isolated", AGENTS);
    const workspace = environment.workspaces[0];
    const repository = environment.repositories[0];
    if (!workspace || !repository) throw new Error("Expected agent-1 Git resources.");
    const changes: unknown[] = [];
    const monitor = new GitActivityMonitor({
      repository,
      onChange: (repositoryId, agentIds, refs) => {
        changes.push({ repositoryId, agentIds, refs });
      },
      pollIntervalMs: 60_000,
    });
    await monitor.start();
    await runGit(["switch", "--orphan", "rule/revision"], workspace.path);
    await writeFile(join(workspace.path, "rule.txt"), "revision\n", "utf8");
    await runGit(["add", "rule.txt"], workspace.path);
    await runGit(["commit", "-m", "revise rule"], workspace.path);
    await runGit(["push", repository.path, "HEAD:refs/heads/rule/revision"], workspace.path);
    await monitor.checkNow();

    expect(changes).toEqual([
      {
        repositoryId: "agent-1",
        agentIds: ["agent-1"],
        refs: ["refs/heads/rule/revision"],
      },
    ]);
    await monitor.stop();
  });

  it("fans one shared repository change out as the first event on every stream", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-shared-git-activity-"));
    const environment = await createGitEnvironment(root, "shared", AGENTS);
    const workspace = environment.workspaces[0];
    const repository = environment.repositories[0];
    if (!workspace || !repository) throw new Error("Expected shared Git resources.");
    const changes: unknown[] = [];
    const monitor = new GitActivityMonitor({
      repository,
      onChange: (repositoryId, agentIds, refs) => {
        changes.push({ repositoryId, agentIds, refs });
      },
      pollIntervalMs: 60_000,
    });
    await monitor.start();
    await runGit(["switch", "--orphan", "rule/revision"], workspace.path);
    await writeFile(join(workspace.path, "rule.txt"), "revision\n", "utf8");
    await runGit(["add", "rule.txt"], workspace.path);
    await runGit(["commit", "-m", "revise rule"], workspace.path);
    await runGit(["push", repository.path, "HEAD:refs/heads/rule/revision"], workspace.path);
    await monitor.checkNow();

    expect(changes).toEqual([
      {
        repositoryId: "shared",
        agentIds: AGENTS,
        refs: ["refs/heads/rule/revision"],
      },
    ]);
    await monitor.stop();
  });

  it("does not consume a ref change when its canonical observer rejects it", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-git-retry-"));
    const environment = await createGitEnvironment(root, "isolated", AGENTS);
    const workspace = environment.workspaces[0];
    const repository = environment.repositories[0];
    if (!workspace || !repository) throw new Error("Expected agent-1 Git resources.");
    let available = false;
    let attempts = 0;
    const monitor = new GitActivityMonitor({
      repository,
      pollIntervalMs: 60_000,
      onChange: () => {
        attempts += 1;
        if (!available) throw new Error("trace unavailable");
      },
    });
    await monitor.start();
    await runGit(["switch", "--orphan", "rule/retry"], workspace.path);
    await writeFile(join(workspace.path, "rule.txt"), "retry\n", "utf8");
    await runGit(["add", "rule.txt"], workspace.path);
    await runGit(["commit", "-m", "retry rule observation"], workspace.path);
    await runGit(["push", repository.path, "HEAD:refs/heads/rule/retry"], workspace.path);

    await expect(monitor.checkNow()).rejects.toThrow("trace unavailable");
    available = true;
    await expect(monitor.checkNow()).resolves.toEqual(["refs/heads/rule/retry"]);
    expect(attempts).toBe(2);
    await monitor.stop();
  });

  it.each(["shared", "isolated"] as const)(
    "freezes the complete %s repository and workspace inventory without merging",
    async (communicationMode) => {
      const root = await mkdtemp(join(tmpdir(), `palimpsest-${communicationMode}-freeze-`));
      const environment = await createGitEnvironment(
        join(root, "active"),
        communicationMode,
        AGENTS,
      );
      const workspace = environment.workspaces[0];
      const activeRepository = environment.repositories[0];
      if (!workspace || !activeRepository) throw new Error("Expected Git resources to freeze.");
      await runGit(["switch", "--orphan", "result/agent-1"], workspace.path);
      await writeFile(join(workspace.path, "result.txt"), "retained result\n", "utf8");
      await runGit(["add", "result.txt"], workspace.path);
      await runGit(["commit", "-m", "retain model work"], workspace.path);
      await runGit(
        ["push", activeRepository.path, "HEAD:refs/heads/result/agent-1"],
        workspace.path,
      );

      const frozen = await freezeGitEnvironment(environment, join(root, "frozen"));

      expect(frozen).toMatchObject({
        communicationMode,
        frozen: true,
        repositories: expect.arrayContaining(
          environment.repositories.map(({ repositoryId, agentIds }) =>
            expect.objectContaining({ repositoryId, agentIds }),
          ),
        ),
      });
      expect(frozen.repositories).toHaveLength(communicationMode === "shared" ? 1 : 3);
      expect(frozen.workspaces).toHaveLength(3);
      for (const repository of frozen.repositories) {
        const refs = await listRemoteRefs(repository.path);
        if (repository.repositoryId === activeRepository.repositoryId) {
          expect(refs).toHaveProperty("refs/heads/result/agent-1");
        } else {
          expect(refs).toHaveProperty("refs/heads/main");
        }
      }
    },
  );
});
