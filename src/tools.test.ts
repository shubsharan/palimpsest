import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AttemptRuntime } from "./attempt-runtime.js";
import { runGit } from "./git.js";
import { PublishedSolverInfrastructureError } from "./published-solver.js";
import { SandboxInfrastructureError } from "./sandbox/contracts.js";
import { createAgentTools, type CheckerHook, TOOL_DEFINITIONS } from "./tools.js";
import { FakeCommandSandbox } from "./test-helpers.js";

const SUCCESS = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  outputExceeded: false,
} as const;

async function toolFixture(
  execute?: ConstructorParameters<typeof FakeCommandSandbox>[0],
  withTeamChannel = false,
  duringSolver?: (runtime: AttemptRuntime) => void | Promise<void>,
  checker?: CheckerHook,
) {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-tools-"));
  const workspace = join(root, "workspace");
  const evidence = join(root, "evidence");
  const source = join(root, "source");
  const gitOrigin = join(root, "origin.git");
  const reference = join(root, "reference.txt");
  await Promise.all([
    mkdir(workspace),
    mkdir(evidence),
    mkdir(source),
    writeFile(reference, "reference\n"),
  ]);
  const releasedStages = [
    {
      ordinal: 1,
      sourcePath: join(source, "stage-01.txt"),
      visiblePath: join(evidence, "stage-01-visible.txt"),
    },
    {
      ordinal: 2,
      sourcePath: join(source, "stage-02.txt"),
      visiblePath: join(evidence, "stage-02-visible.txt"),
    },
  ] as const;
  await Promise.all([
    writeFile(releasedStages[0].sourcePath, "one two\n"),
    writeFile(releasedStages[1].sourcePath, "three four\n"),
    writeFile(releasedStages[0].visiblePath, "tampered visible stage\n"),
    writeFile(releasedStages[1].visiblePath, "tampered visible stage\n"),
    writeFile(join(evidence, "stage-01-decoy.txt"), "decoy\n"),
  ]);
  const observedTeamMessages: unknown[] = [];
  const runtime = new AttemptRuntime({
    agentIds: ["agent-1", "agent-2", "agent-3"],
    teamChannelEnabled: withTeamChannel,
    nowMs: () => 50,
    observe: ({ kind, data }) => {
      if (kind === "team.message") observedTeamMessages.push(data);
    },
  });
  await runtime.publishReleasedStage("agent-1", releasedStages[0], () => undefined);
  await runtime.publishReleasedStage("agent-1", releasedStages[1], () => undefined);
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
  const capturedCiphertexts: string[] = [];
  const sandbox = new FakeCommandSandbox(async (request) => {
    if (request.profile === "solver") {
      capturedCiphertexts.push(await readFile(request.ciphertextPath, "utf8"));
      await duringSolver?.(runtime);
    }
    if (execute !== undefined) return execute(request);
    if (request.profile === "agent") return SUCCESS;
    await writeFile(join(request.outputRoot, request.outputPath), "one two\n", "utf8");
    return SUCCESS;
  });
  const lease = await sandbox.openAgentLease({
    profile: "agent",
    workspacePath: workspace,
    evidencePath: evidence,
    referenceCorpusPath: reference,
    gitOriginPath: gitOrigin,
    timeoutMs: 1_000,
  });
  const checkerRequests: string[] = [];
  const attempt = runtime.forAgent("agent-1");
  let activityCursor = attempt.latestActivitySequence;
  const tools = createAgentTools({
    agentId: "agent-1",
    sandbox: lease,
    solverSandbox: sandbox,
    repositoryPath: gitOrigin,
    attempt,
    getActivityCursor: () => activityCursor,
    setActivityCursor: (sequence) => {
      activityCursor = sequence;
    },
    checker:
      checker ??
      (async ({ candidatePath }) => {
        checkerRequests.push(candidatePath);
        return {
          feedbackId: "published-runnability-coverage-v1",
          outputValidity: "incomplete",
          ciphertextWords: 4,
          outputWords: 2,
          coverage: 1,
        };
      }),
  });
  return {
    root,
    workspace,
    evidence,
    gitOrigin,
    commit,
    reference,
    sandbox,
    capturedCiphertexts,
    checkerRequests,
    source,
    runtime,
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
    const { runtime, tools } = await toolFixture();
    await runtime.recordGitChange("agent-1", ["agent-1"], ["refs/heads/main"]);

    await expect(tools.execute("wait_for_activity", { afterSequence: 0 })).resolves.toEqual({
      sequence: 3,
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
    await expect(enabled.runtime.forAgent("agent-2").waitForActivity(0)).resolves.toMatchObject({
      kind: "team-message",
    });
  });

  it("checks only the pushed main solver and exposes blind coverage feedback", async () => {
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
      feedbackId: "published-runnability-coverage-v1",
      ref: "refs/heads/main",
      commit: fixture.commit,
      executionStatus: "succeeded",
      outputValidity: "incomplete",
      ciphertextWords: 4,
      outputWords: 2,
      coverage: 1,
    });
    expect(JSON.stringify(checked)).not.toMatch(
      /expected|mismatch|correctWords|matchedWords|accuracy/,
    );
    expect(fixture.checkerRequests).toHaveLength(1);
    expect(fixture.capturedCiphertexts).toEqual(["one two\n\nthree four\n"]);
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
    await expect(checkoutFailure.tools.execute("check_published_solver", {})).resolves.toEqual(
      expect.objectContaining({
        feedbackId: "published-runnability-coverage-v1",
        executionStatus: "failed",
        outputValidity: "missing",
        error: "Published ref refs/heads/main must resolve to an available commit.",
      }),
    );
    expect(checkoutFailure.checkerRequests).toEqual([]);

    const solverFailure = await toolFixture(async (request) =>
      request.profile === "solver"
        ? { ...SUCCESS, exitCode: 2, stderr: "solver.py missing" }
        : SUCCESS,
    );
    await expect(solverFailure.tools.execute("check_published_solver", {})).resolves.toEqual(
      expect.objectContaining({
        feedbackId: "published-runnability-coverage-v1",
        ref: "refs/heads/main",
        commit: solverFailure.commit,
        executionStatus: "failed",
        outputValidity: "malformed",
        error: "Published solver execution failed.",
        execution: expect.objectContaining({ exitCode: 2, stderr: "solver.py missing" }),
      }),
    );
    expect(solverFailure.checkerRequests).toEqual([]);

    const timeout = await toolFixture(async (request) =>
      request.profile === "solver" ? { ...SUCCESS, timedOut: true } : SUCCESS,
    );
    await expect(timeout.tools.execute("check_published_solver", {})).resolves.toEqual(
      expect.objectContaining({
        feedbackId: "published-runnability-coverage-v1",
        commit: timeout.commit,
        executionStatus: "timed-out",
        outputValidity: "malformed",
        error: "Published solver execution failed.",
        execution: expect.objectContaining({ timedOut: true }),
      }),
    );
    expect(timeout.checkerRequests).toEqual([]);
  });

  it("propagates sandbox infrastructure failures instead of returning checker errors", async () => {
    const fixture = await toolFixture(async (request) => {
      if (request.profile === "solver") {
        throw new SandboxInfrastructureError("Docker daemon unavailable.");
      }
      return SUCCESS;
    });

    await expect(fixture.tools.execute("check_published_solver", {})).rejects.toThrow(
      SandboxInfrastructureError,
    );
    expect(fixture.checkerRequests).toEqual([]);
  });

  it("checks one immutable evidence snapshot when another stage is released during execution", async () => {
    const fixture = await toolFixture(undefined, false, async (runtime) => {
      const sourcePath = join(fixture.source, "stage-03.txt");
      const visiblePath = join(fixture.evidence, "stage-03-visible.txt");
      await Promise.all([
        writeFile(sourcePath, "five six\n"),
        writeFile(visiblePath, "five six\n"),
      ]);
      await runtime.publishReleasedStage(
        "agent-1",
        { ordinal: 3, sourcePath, visiblePath },
        () => undefined,
      );
    });

    await expect(fixture.tools.execute("check_published_solver", {})).resolves.toMatchObject({
      commit: fixture.commit,
      feedbackId: "published-runnability-coverage-v1",
      outputValidity: "incomplete",
    });
    expect(fixture.capturedCiphertexts).toEqual(["one two\n\nthree four\n"]);
  });

  it("classifies trusted checker failures as infrastructure", async () => {
    const fixture = await toolFixture(undefined, false, undefined, async () => {
      throw new Error("checker unavailable");
    });

    await expect(fixture.tools.execute("check_published_solver", {})).rejects.toThrow(
      PublishedSolverInfrastructureError,
    );
  });
});
