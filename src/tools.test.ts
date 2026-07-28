import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ActivityBus } from "./activity.js";
import { createAgentTools, TOOL_DEFINITIONS } from "./tools.js";
import { FakeCommandSandbox } from "./test-helpers.js";

async function toolFixture() {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-tools-"));
  const workspace = join(root, "workspace");
  const evidence = join(root, "evidence");
  const sharedGit = join(root, "shared.git");
  const reference = join(root, "reference.txt");
  await Promise.all([
    mkdir(workspace),
    mkdir(evidence),
    mkdir(sharedGit),
    writeFile(reference, "reference\n"),
  ]);
  const sandbox = new FakeCommandSandbox();
  const checkerRequests: string[] = [];
  const tools = createAgentTools({
    agentId: "agent-1",
    workspacePath: workspace,
    evidencePath: evidence,
    referenceCorpusPath: reference,
    sharedGitPath: sharedGit,
    sandbox,
    activity: new ActivityBus(),
    getActivityCursor: () => 0,
    checker: async ({ candidatePath }) => {
      checkerRequests.push(candidatePath);
      return {
        matchedWords: 1,
        totalWords: 2,
        coverage: 1,
        accuracy: 0.5,
      };
    },
    getReleasedStages: () => [1],
  });
  return { root, workspace, evidence, sharedGit, reference, sandbox, checkerRequests, tools };
}

describe("agent tools", () => {
  it("gives every agent the same command, checker, and waiting tools", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "run_command",
      "check_reconstruction",
      "wait_for_activity",
    ]);
  });

  it("routes commands through the injected sandbox and exposes only aggregate checker output", async () => {
    const fixture = await toolFixture();
    const { sandbox, tools, workspace } = fixture;
    await writeFile(join(workspace, "candidate.txt"), "one two\n", "utf8");
    const command = await tools.execute("run_command", {
      command: "pwd",
      timeoutMs: 1_000,
    });
    expect(command).toMatchObject({ exitCode: 0, timedOut: false });
    expect(sandbox.requests).toEqual([
      expect.objectContaining({
        profile: "agent",
        command: "pwd",
        workspacePath: fixture.workspace,
        evidencePath: fixture.evidence,
        referenceCorpusPath: fixture.reference,
        sharedGitPath: fixture.sharedGit,
      }),
    ]);

    const checked = await tools.execute("check_reconstruction", {
      candidatePath: "candidate.txt",
    });
    expect(checked).toEqual({
      matchedWords: 1,
      totalWords: 2,
      coverage: 1,
      accuracy: 0.5,
    });
    expect(JSON.stringify(checked)).not.toMatch(/expected|mismatch|correctWords/);
  });

  it("rejects a checker candidate whose symlink escapes the workspace", async () => {
    const { root, workspace, tools, checkerRequests } = await toolFixture();
    const outside = join(root, "outside.txt");
    await writeFile(outside, "secret\n");
    await symlink(outside, join(workspace, "candidate.txt"));

    await expect(
      tools.execute("check_reconstruction", { candidatePath: "candidate.txt" }),
    ).rejects.toThrow("resolves outside");
    expect(checkerRequests).toEqual([]);
  });

  it("accepts a contained symlink to a regular checker candidate", async () => {
    const { workspace, tools, checkerRequests } = await toolFixture();
    await writeFile(join(workspace, "answer.txt"), "candidate\n");
    await symlink("answer.txt", join(workspace, "candidate.txt"));

    await expect(
      tools.execute("check_reconstruction", { candidatePath: "candidate.txt" }),
    ).resolves.toMatchObject({ matchedWords: 1 });
    expect(checkerRequests).toHaveLength(1);
  });

  it("rejects checker directories and missing files", async () => {
    const { workspace, tools } = await toolFixture();
    await mkdir(join(workspace, "directory"));

    await expect(
      tools.execute("check_reconstruction", { candidatePath: "directory" }),
    ).rejects.toThrow("regular file");
    await expect(
      tools.execute("check_reconstruction", { candidatePath: "missing.txt" }),
    ).rejects.toThrow("does not exist");
    await expect(
      tools.execute("check_reconstruction", { candidatePath: "../outside.txt" }),
    ).rejects.toThrow("inside the workspace");
    await expect(
      tools.execute("check_reconstruction", { candidatePath: "/absolute.txt" }),
    ).rejects.toThrow("relative");
  });
});
