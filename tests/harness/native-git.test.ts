import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import { startGitServer } from "../../tools/harness/git-server.js";

const execFileAsync = promisify(execFile);
const agents = ["agent-1", "agent-2", "agent-3"] as const;
const temporaryRoots: string[] = [];

async function git(arguments_: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("three-worker native Git transport", () => {
  test("authenticates clones and carries independent commit/push/fetch workflows", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-native-git-"));
    temporaryRoots.push(root);
    const seed = join(root, "seed");
    const repository = join(root, "repository.git");
    await git(["init", "--quiet", "--object-format=sha256", seed]);
    await git(["config", "user.name", "Palimpsest Fixture"], seed);
    await git(["config", "user.email", "fixture@palimpsest.invalid"], seed);
    await writeFile(join(seed, "README.md"), "fixture genesis\n");
    await git(["add", "README.md"], seed);
    await git(["commit", "--quiet", "-m", "genesis"], seed);
    await git(["branch", "-M", "main"], seed);
    await git(["clone", "--quiet", "--bare", seed, repository]);
    await git(["config", "http.receivepack", "true"], repository);

    const server = await startGitServer({
      repository,
      secrets: {
        "agent-1": "secret-1",
        "agent-2": "secret-2",
        "agent-3": "secret-3",
      },
    });
    try {
      await Promise.all(
        agents.map(async (agentId) => {
          const clone = join(root, agentId);
          await git(["clone", "--quiet", server.endpoint(agentId), clone]);
          await git(["config", "user.name", agentId], clone);
          await git(["config", "user.email", `${agentId}@palimpsest.invalid`], clone);
          await writeFile(join(clone, `${agentId}.txt`), `${agentId} hypothesis\n`);
          await git(["add", `${agentId}.txt`], clone);
          await git(["commit", "--quiet", "-m", `${agentId} work`], clone);
          await git(["push", "--quiet", "origin", `HEAD:refs/heads/agents/${agentId}/work`], clone);
        }),
      );
      const refs = await git(
        ["for-each-ref", "--format=%(refname)", "refs/heads/agents"],
        repository,
      );
      expect(refs.split("\n").sort()).toEqual(
        agents.map((agentId) => `refs/heads/agents/${agentId}/work`),
      );

      const agentOne = join(root, "agent-1");
      await git(
        [
          "fetch",
          "--quiet",
          "origin",
          "refs/heads/agents/agent-2/work:refs/remotes/origin/agent-2-work",
        ],
        agentOne,
      );
      expect(await git(["rev-parse", "refs/remotes/origin/agent-2-work"], agentOne)).toMatch(
        /^[0-9a-f]{64}$/,
      );

      const unauthorized = new URL(server.endpoint("agent-1"));
      unauthorized.password = "wrong";
      await expect(git(["ls-remote", unauthorized.toString()])).rejects.toThrow();

      const staging = await startGitServer({
        repository,
        stagingRefMode: true,
        secrets: {
          "agent-1": "staging-1",
          "agent-2": "staging-2",
          "agent-3": "staging-3",
        },
      });
      try {
        await git([
          "-C",
          agentOne,
          "push",
          "--quiet",
          staging.endpoint("agent-1"),
          "HEAD:refs/heads/quarantine/agent-1/work",
        ]);
        await expect(
          git([
            "-C",
            agentOne,
            "push",
            "--quiet",
            staging.endpoint("agent-1"),
            "HEAD:refs/heads/quarantine/agent-2/work",
          ]),
        ).rejects.toThrow();
        expect(
          await git([
            "ls-remote",
            staging.endpoint("agent-2"),
            "refs/heads/quarantine/agent-1/work",
          ]),
        ).toBe("");
        expect(await git(["rev-parse", "refs/heads/quarantine/agent-1/work"], repository)).toMatch(
          /^[0-9a-f]{64}$/,
        );
      } finally {
        await staging.close();
      }
    } finally {
      await server.close();
    }
  }, 30_000);
});
