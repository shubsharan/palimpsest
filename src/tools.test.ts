import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ActivityBus } from "./activity.js";
import { createAgentTools, TOOL_DEFINITIONS } from "./tools.js";
import { FakeCommandSandbox } from "./test-helpers.js";

const COMMIT = "a".repeat(40);
const SUCCESS = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  outputExceeded: false,
} as const;

async function toolFixture(
  execute: ConstructorParameters<typeof FakeCommandSandbox>[0] = async () => SUCCESS,
) {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-tools-"));
  const workspace = join(root, "workspace");
  const evidence = join(root, "evidence");
  const gitOrigin = join(root, "origin.git");
  const reference = join(root, "reference.txt");
  await Promise.all([
    mkdir(workspace),
    mkdir(evidence),
    mkdir(gitOrigin),
    writeFile(reference, "reference\n"),
  ]);
  const sandbox = new FakeCommandSandbox(execute);
  const lease = await sandbox.openAgentLease({
    profile: "agent",
    workspacePath: workspace,
    evidencePath: evidence,
    referenceCorpusPath: reference,
    gitOriginPath: gitOrigin,
    timeoutMs: 1_000,
  });
  const activity = new ActivityBus();
  const checkerRequests: number[][] = [];
  const tools = createAgentTools({
    sandbox: lease,
    activity,
    getActivityCursor: () => 0,
    checkPublishedSolver: async (releasedStages) => {
      checkerRequests.push([...releasedStages]);
      return {
        commit: COMMIT,
        matchedWords: 1,
        totalWords: 2,
        coverage: 1,
        accuracy: 0.5,
      };
    },
    getReleasedStages: () => [1],
  });
  return {
    root,
    workspace,
    evidence,
    gitOrigin,
    reference,
    sandbox,
    checkerRequests,
    activity,
    tools,
  };
}

describe("agent tools", () => {
  it("gives every agent the same command, checker, and waiting tools", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "run_command",
      "check_published_solver",
      "wait_for_activity",
    ]);
    expect(
      TOOL_DEFINITIONS.find(({ name }) => name === "check_published_solver")?.inputSchema,
    ).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(TOOL_DEFINITIONS.find(({ name }) => name === "wait_for_activity")?.description).toBe(
      "Wait until new private evidence or Git activity is available.",
    );
  });

  it("reports Git activity without implying that a peer channel exists", async () => {
    const { activity, tools } = await toolFixture();
    activity.publish({ kind: "git-changed", detail: { repositoryId: "agent-1" } });

    await expect(tools.execute("wait_for_activity", { afterSequence: 0 })).resolves.toEqual({
      sequence: 1,
      kind: "git-changed",
      summary: "Git activity is available",
    });
  });

  it("checks only the pushed main solver and exposes its commit with aggregate output", async () => {
    const fixture = await toolFixture();
    const { sandbox, tools } = fixture;
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
        gitOriginPath: fixture.gitOrigin,
      }),
    ]);

    const checked = await tools.execute("check_published_solver", {});
    expect(checked).toEqual({
      commit: COMMIT,
      matchedWords: 1,
      totalWords: 2,
      coverage: 1,
      accuracy: 0.5,
    });
    expect(JSON.stringify(checked)).not.toMatch(/expected|mismatch|correctWords/);
    expect(fixture.checkerRequests).toEqual([[1]]);
    expect(sandbox.requests).toHaveLength(1);
  });

  it("rejects candidate paths because the published-solver checker takes no arguments", async () => {
    const { tools, checkerRequests } = await toolFixture();
    await expect(
      tools.execute("check_published_solver", { candidatePath: "candidate.txt" }),
    ).rejects.toThrow("does not accept arguments");
    expect(checkerRequests).toEqual([]);
  });
});
