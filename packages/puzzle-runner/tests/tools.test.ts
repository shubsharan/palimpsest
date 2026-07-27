import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ActivityBus } from "../src/activity.js";
import { createAgentTools, executeLocalCommand, TOOL_DEFINITIONS } from "../src/tools.js";

describe("agent tools", () => {
  it("gives every agent the same command, checker, and waiting tools", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "run_command",
      "check_reconstruction",
      "wait_for_activity",
    ]);
  });

  it("executes commands in the workspace and exposes only aggregate checker output", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "palimpsest-tools-"));
    await writeFile(join(workspace, "candidate.txt"), "one two\n", "utf8");
    const command = await executeLocalCommand({
      command: "pwd",
      cwd: workspace,
      timeoutMs: 1_000,
    });
    expect(command.exitCode).toBe(0);
    expect(command.stdout.trim()).toBe(await realpath(workspace));

    const tools = createAgentTools({
      agentId: "agent-1",
      workspacePath: workspace,
      activity: new ActivityBus(),
      getActivityCursor: () => 0,
      checker: async () => ({
        matchedWords: 1,
        totalWords: 2,
        coverage: 1,
        accuracy: 0.5,
      }),
      getReleasedStages: () => [1],
    });
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

  it("times out a long-running local command", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "palimpsest-timeout-"));
    const result = await executeLocalCommand({
      command: "sleep 2",
      cwd: workspace,
      timeoutMs: 20,
    });
    expect(result.timedOut).toBe(true);
  });
});
