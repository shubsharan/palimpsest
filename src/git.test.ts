import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ActivityBus } from "./activity.js";
import {
  createGitEnvironment,
  freezeGitEnvironment,
  GitActivityMonitor,
  listRemoteRefs,
  runGit,
} from "./git.js";

describe("ordinary shared Git", () => {
  it("supports arbitrary branches, commits, pushes, fetches, and an unused clone", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-git-"));
    const environment = await createGitEnvironment(root);
    const [first, second, unused] = environment.workspaces;
    if (!first || !second || !unused) throw new Error("Expected three workspaces.");

    await runGit(["switch", "--orphan", "ideas/first-rule"], first.path);
    await writeFile(join(first.path, "solver.ts"), "export const attempt = 1;\n", "utf8");
    await runGit(["add", "solver.ts"], first.path);
    await runGit(["commit", "-m", "try a rule"], first.path);
    await runGit(["push", environment.barePath, "HEAD:refs/heads/ideas/first-rule"], first.path);

    await runGit(
      [
        "fetch",
        environment.barePath,
        "refs/heads/ideas/first-rule:refs/remotes/origin/ideas/first-rule",
      ],
      second.path,
    );
    expect(await listRemoteRefs(environment.barePath)).toHaveProperty(
      "refs/heads/ideas/first-rule",
    );
    expect(await readFile(join(first.path, "solver.ts"), "utf8")).toContain("attempt");
    expect((await runGit(["status", "--porcelain"], unused.path)).stdout).toBe("");
    expect((await runGit(["remote", "get-url", "origin"], unused.path)).stdout.trim()).toBe(
      "/git/shared.git",
    );
  });

  it("freezes the bare repository and all three workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-freeze-"));
    const environment = await createGitEnvironment(join(root, "active"));
    const frozen = await freezeGitEnvironment(environment, join(root, "frozen"));
    expect(frozen.workspaces).toHaveLength(3);
    expect(await listRemoteRefs(frozen.barePath)).toEqual({});
  });

  it("creates and freezes the declared dynamic workspace set", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-dynamic-git-"));
    const environment = await createGitEnvironment(join(root, "active"), [
      "agent-1",
      "agent-2",
      "agent-3",
      "agent-4",
      "agent-5",
    ]);
    const frozen = await freezeGitEnvironment(environment, join(root, "frozen"));

    expect(environment.workspaces.map(({ agentId }) => agentId)).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
      "agent-4",
      "agent-5",
    ]);
    expect(frozen.workspaces).toHaveLength(5);
  });

  it("publishes peer-visible ref changes as wake activity", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-git-activity-"));
    const environment = await createGitEnvironment(root);
    const first = environment.workspaces[0];
    if (!first) throw new Error("Expected agent-1 workspace.");
    const activity = new ActivityBus();
    const monitor = new GitActivityMonitor({
      barePath: environment.barePath,
      activity,
      pollIntervalMs: 60_000,
    });
    await monitor.start();
    const waiting = activity.waitForVisible("agent-3", 0);
    await runGit(["switch", "--orphan", "rule/revision"], first.path);
    await writeFile(join(first.path, "rule.txt"), "revision\n", "utf8");
    await runGit(["add", "rule.txt"], first.path);
    await runGit(["commit", "-m", "revise rule"], first.path);
    await runGit(["push", environment.barePath, "HEAD:refs/heads/rule/revision"], first.path);
    await monitor.checkNow();
    await expect(waiting).resolves.toMatchObject({
      kind: "git-changed",
      detail: { refs: ["refs/heads/rule/revision"] },
    });
    await monitor.stop();
  });
});
