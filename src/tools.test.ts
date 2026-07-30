import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ActivityBus } from "./activity.js";
import { runGit } from "./git.js";
import { TeamChannel } from "./team-channel.js";
import { createAgentTools, TOOL_DEFINITIONS } from "./tools.js";
import { FakeCommandSandbox } from "./test-helpers.js";

const SUCCESS = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  outputExceeded: false,
} as const;

async function toolFixture(
  execute: ConstructorParameters<typeof FakeCommandSandbox>[0] = async (request) => {
    if (request.profile === "agent") return SUCCESS;
    await writeFile(join(request.outputRoot, request.outputPath), "one two\n", "utf8");
    return SUCCESS;
  },
  withTeamChannel = false,
) {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-tools-"));
  const workspace = join(root, "workspace");
  const evidence = join(root, "evidence");
  const gitOrigin = join(root, "origin.git");
  const reference = join(root, "reference.txt");
  await Promise.all([mkdir(workspace), mkdir(evidence), writeFile(reference, "reference\n")]);
  await writeFile(join(evidence, "stage-01-visible.txt"), "one two\n");
  await runGit(["init", "--bare", "--initial-branch=main", gitOrigin]);
  const seed = join(root, "seed");
  await runGit(["clone", gitOrigin, seed]);
  await runGit(["config", "user.name", "Palimpsest Test"], seed);
  await runGit(["config", "user.email", "test@palimpsest.invalid"], seed);
  await writeFile(join(seed, "solver.py"), "print('solver')\n");
  await runGit(["add", "solver.py"], seed);
  await runGit(["commit", "-m", "Publish solver"], seed);
  await runGit(["push", "origin", "HEAD:main"], seed);
  const commit = (await runGit(["rev-parse", "HEAD"], seed)).stdout.trim();
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
  const peerActivities = {
    "agent-1": activity,
    "agent-2": new ActivityBus(),
    "agent-3": new ActivityBus(),
  };
  const observedTeamMessages: unknown[] = [];
  const teamChannel = withTeamChannel
    ? new TeamChannel({
        activities: peerActivities,
        nowMs: () => 50,
        observe: (message) => {
          observedTeamMessages.push(message);
        },
      })
    : undefined;
  const checkerRequests: string[] = [];
  const tools = createAgentTools({
    agentId: "agent-1",
    sandbox: lease,
    solverSandbox: sandbox,
    repositoryPath: gitOrigin,
    evidencePath: evidence,
    activity,
    ...(teamChannel === undefined ? {} : { teamChannel }),
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
  return {
    root,
    workspace,
    evidence,
    gitOrigin,
    commit,
    reference,
    sandbox,
    checkerRequests,
    activity,
    peerActivities,
    observedTeamMessages,
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

  it("exposes direct discussion only when the runtime supplies a shared channel", async () => {
    const disabled = await toolFixture();
    expect(disabled.tools.definitions.map(({ name }) => name)).not.toContain("post_team_message");

    const enabled = await toolFixture(undefined, true);
    expect(enabled.tools.definitions.map(({ name }) => name)).toEqual([
      "run_command",
      "check_published_solver",
      "wait_for_activity",
      "post_team_message",
      "read_team_messages",
    ]);
    expect(
      enabled.tools.definitions.find(({ name }) => name === "wait_for_activity")?.description,
    ).toContain("team discussion");
    await expect(
      enabled.tools.execute("post_team_message", { message: "Try the repeated-word mapping." }),
    ).resolves.toMatchObject({
      sequence: 1,
      author: "agent-1",
      message: "Try the repeated-word mapping.",
    });
    await expect(
      enabled.tools.execute("read_team_messages", { afterSequence: 0 }),
    ).resolves.toMatchObject({
      messages: [expect.objectContaining({ author: "agent-1" })],
      nextSequence: 1,
      hasMore: false,
    });
    expect(enabled.observedTeamMessages).toHaveLength(1);
    expect(enabled.peerActivities["agent-2"].events).toEqual([
      expect.objectContaining({ kind: "team-message" }),
    ]);
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
      commit: fixture.commit,
      matchedWords: 1,
      totalWords: 2,
      coverage: 1,
      accuracy: 0.5,
    });
    expect(JSON.stringify(checked)).not.toMatch(/expected|mismatch|correctWords/);
    expect(fixture.checkerRequests).toHaveLength(1);
    expect(fixture.checkerRequests[0]).not.toContain(fixture.workspace);
    expect(sandbox.requests.slice(1)).toEqual([
      expect.objectContaining({
        profile: "solver",
        command: "python3 solver.py",
        ciphertextPath: expect.not.stringContaining(fixture.workspace),
        outputRoot: expect.not.stringContaining(fixture.workspace),
        submissionPath: expect.not.stringContaining(fixture.workspace),
      }),
    ]);
    expect(JSON.stringify(sandbox.requests[1])).not.toMatch(/gitOriginPath|evidencePath|reference/);
  });

  it("rejects candidate paths because the published-solver checker takes no arguments", async () => {
    const { tools, checkerRequests } = await toolFixture();
    await expect(
      tools.execute("check_published_solver", { candidatePath: "candidate.txt" }),
    ).rejects.toThrow("does not accept arguments");
    expect(checkerRequests).toEqual([]);
  });

  it("reports checkout and solver failures without scoring private workspace files", async () => {
    const checkoutFailure = await toolFixture();
    await runGit(["update-ref", "-d", "refs/heads/main"], checkoutFailure.gitOrigin);
    await expect(checkoutFailure.tools.execute("check_published_solver", {})).resolves.toEqual({
      error: "Published ref refs/heads/main must resolve to a commit.",
    });
    expect(checkoutFailure.checkerRequests).toEqual([]);

    const solverFailure = await toolFixture(async (request) =>
      request.profile === "solver"
        ? { ...SUCCESS, exitCode: 2, stderr: "solver.py missing" }
        : SUCCESS,
    );
    await expect(solverFailure.tools.execute("check_published_solver", {})).resolves.toEqual({
      commit: solverFailure.commit,
      error: "Published solver execution failed.",
      execution: expect.objectContaining({ exitCode: 2, stderr: "solver.py missing" }),
    });
    expect(solverFailure.checkerRequests).toEqual([]);
  });
});
