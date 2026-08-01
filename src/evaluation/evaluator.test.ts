import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeFixturePackageContentDigest } from "../fixture/package.js";
import {
  evaluateCanonicalOrigins,
  reevaluateRun,
  SOLVER_COMMAND,
  SOLVER_OUTPUT_PATH,
} from "./evaluator.js";
import { runGit, type FrozenGitEnvironment, type GitRepositoryId } from "../git.js";
import type { AgentId } from "../model/contracts.js";
import { runPythonJson } from "../python.js";
import { freezeRunConfiguration, publishRunRecord, type RunRecord } from "../run/record.js";
import type { SandboxCommandResult, SolverSandboxCommand } from "../sandbox/contracts.js";
import { sealTree } from "../seal.js";
import { FakeCommandSandbox } from "../../tests/support/fake-command-sandbox.js";
import { JsonlObservationLog } from "../trace.js";

vi.mock("../python.js", async () => {
  const actual = await vi.importActual<typeof import("../python.js")>("../python.js");
  return { ...actual, runPythonJson: vi.fn() };
});

const runPythonJsonMock = vi.mocked(runPythonJson);

const SUCCESS: SandboxCommandResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  outputExceeded: false,
};

async function publishSolver(repositoryPath: string, source: string): Promise<string> {
  const seedRoot = await mkdtemp(join(tmpdir(), "palimpsest-evaluate-seed-"));
  const checkout = join(seedRoot, "checkout");
  await runGit(["clone", repositoryPath, checkout]);
  await runGit(["config", "user.name", "Palimpsest Test"], checkout);
  await runGit(["config", "user.email", "test@palimpsest.invalid"], checkout);
  await writeFile(join(checkout, "solver.py"), source, "utf8");
  await runGit(["add", "solver.py"], checkout);
  await runGit(["commit", "-m", "Publish solver"], checkout);
  await runGit(["push", "origin", "HEAD:main"], checkout);
  return (await runGit(["rev-parse", "HEAD"], checkout)).stdout.trim();
}

async function evaluationFixture(
  communicationMode: "shared" | "isolated",
  publish: readonly AgentId[] | "shared",
) {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-canonical-evaluate-"));
  const runRoot = join(root, "run");
  const fixtureRoot = join(root, "fixture");
  const frozenRoot = join(runRoot, "frozen");
  const tracePath = join(runRoot, "trace.jsonl");
  const agentIds = ["agent-1", "agent-2"] as const;
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const ciphertext = "ciphertext\n";
  const stageContent = "stage\n";
  const plaintext = "clear answer\n";
  const oracleDocument = "{}\n";
  const repositories = (
    communicationMode === "shared"
      ? [{ repositoryId: "shared" as const, agentIds: [...agentIds] }]
      : agentIds.map((agentId) => ({ repositoryId: agentId, agentIds: [agentId] }))
  ).map((repository) => ({
    ...repository,
    path: join(frozenRoot, `${repository.repositoryId}.git`),
  }));
  await Promise.all([
    mkdir(join(fixtureRoot, "complete"), { recursive: true }),
    mkdir(join(fixtureRoot, "private", "agent-1", "stages"), {
      recursive: true,
    }),
    mkdir(join(fixtureRoot, "private", "agent-2", "stages"), {
      recursive: true,
    }),
    mkdir(join(fixtureRoot, "oracle"), { recursive: true }),
    mkdir(join(frozenRoot, "workspaces", "agent-1"), { recursive: true }),
    mkdir(join(frozenRoot, "workspaces", "agent-2"), { recursive: true }),
    ...repositories.map((repository) =>
      runGit(["init", "--bare", "--initial-branch=main", repository.path]),
    ),
  ]);
  const publishedCommits = new Map<GitRepositoryId, string>();
  for (const repository of repositories) {
    if (publish === "shared" || publish.includes(repository.repositoryId as AgentId)) {
      publishedCommits.set(
        repository.repositoryId,
        await publishSolver(
          repository.path,
          `from pathlib import Path\nPath("unused").write_text("${repository.repositoryId}")\n`,
        ),
      );
    }
  }
  const stages = agentIds.map((agentId) => ({
    agentId,
    ordinal: 1,
    sourcePath: `private/${agentId}/stages/stage-01.txt`,
    sha256: digest(stageContent),
  }));
  const fixtureContent = {
    schemaVersion: 2,
    fixtureId: "evaluation-fixture",
    constructionId: `construction-${"c".repeat(64)}`,
    window: { sha256: digest(plaintext) },
    allocation: { path: "oracle/allocation.json", sha256: digest(oracleDocument) },
    oracleDesign: { path: "oracle/design.json", sha256: digest(oracleDocument) },
    manipulationCheck: {
      path: "oracle/manipulation-check.json",
      sha256: digest(oracleDocument),
    },
    agentIds,
    stageCount: 1,
    rekeyAtStage: null,
    buildId: `build-${"b".repeat(64)}`,
    publicCiphertextPath: "complete/ciphertext.txt",
    publicCiphertextSha256: digest(ciphertext),
    stages,
  };
  await Promise.all([
    writeFile(join(fixtureRoot, "complete", "ciphertext.txt"), ciphertext, "utf8"),
    ...agentIds.map((agentId) =>
      writeFile(join(fixtureRoot, "private", agentId, "stages", "stage-01.txt"), stageContent),
    ),
    writeFile(join(fixtureRoot, "oracle", "plaintext.txt"), plaintext, "utf8"),
    writeFile(join(fixtureRoot, "oracle", "allocation.json"), oracleDocument, "utf8"),
    writeFile(join(fixtureRoot, "oracle", "design.json"), oracleDocument, "utf8"),
    writeFile(join(fixtureRoot, "oracle", "manipulation-check.json"), oracleDocument, "utf8"),
  ]);
  const fixtureDigest = await computeFixturePackageContentDigest(fixtureRoot, fixtureContent);
  await writeFile(
    join(fixtureRoot, "fixture.json"),
    `${JSON.stringify({ ...fixtureContent, contentDigest: fixtureDigest })}\n`,
    "utf8",
  );
  const log = await JsonlObservationLog.create(tracePath);
  await log.flush();
  const frozen: FrozenGitEnvironment = {
    frozen: true,
    root: frozenRoot,
    communicationMode,
    repositories,
    workspaces: agentIds.map((agentId) => ({
      agentId,
      path: join(frozenRoot, "workspaces", agentId),
      repositoryId: communicationMode === "shared" ? "shared" : agentId,
    })),
    treeSeal: await sealTree(frozenRoot),
  };
  return { root, runRoot, fixtureRoot, fixtureDigest, tracePath, frozen, publishedCommits };
}

function scoringSandbox(inspect?: (request: SolverSandboxCommand) => Promise<void>) {
  return new FakeCommandSandbox(async (request) => {
    if (request.profile !== "solver") throw new Error("Expected solver execution.");
    await inspect?.(request);
    await writeFile(join(request.outputRoot, request.outputPath), "clear answer\n", "utf8");
    return SUCCESS;
  });
}

function runRecord(
  fixture: Awaited<ReturnType<typeof evaluationFixture>>,
  digest = fixture.fixtureDigest,
): RunRecord {
  const binding = {
    profile: "fixture",
    provider: "fixture",
    driver: "openai-compatible" as const,
    requestedModel: "fixture",
    settings: {},
    providerOptions: {},
  };
  const configuration = freezeRunConfiguration({
    manifestPath: "experiment.yaml",
    manifestDigest: "a".repeat(64),
    run: {
      id: "run",
      fixture: {
        id: "evaluation-fixture",
        constructionId: `construction-${"c".repeat(64)}`,
        buildId: `build-${"b".repeat(64)}`,
        packagePath: relative(fixture.root, fixture.fixtureRoot),
        digest,
        variant: "stationary",
      },
      assignment: { "agent-1": "fixture", "agent-2": "fixture" },
      capabilities: { git: "shared", teamRoom: "disabled", checker: true },
      schedule: { releaseOffsetsMs: [0], cutoffMs: 1_000 },
      limits: { tokenLimitPerAgent: null, spendCeilingCents: 0 },
      labels: {},
    },
    models: fixture.frozen.workspaces.map(({ agentId }) => ({ agentId, binding })),
    validation: {
      manifestPath: "experiment.yaml",
      manifestDigest: "a".repeat(64),
      fixture: {
        packagePath: relative(fixture.root, fixture.fixtureRoot),
        fixtureId: "evaluation-fixture",
        contentDigest: digest,
      },
      sandbox: new FakeCommandSandbox().identity,
      smoke: {
        sourceRunId: "run",
        runId: "run-validation",
        fixtureId: "evaluation-fixture",
        variantId: "stationary",
        fixtureDigest: digest,
        agentIds: fixture.frozen.workspaces.map(({ agentId }) => agentId),
        stageCount: 1,
      },
      validatedAt: "2026-07-31T12:00:00.000Z",
      spendAuthorized: true,
    },
  });
  const origins = fixture.frozen.repositories.map((repository) => ({
    originId: repository.repositoryId,
    path: relative(fixture.runRoot, repository.path),
    agentIds: repository.agentIds,
    mainCommit: fixture.publishedCommits.get(repository.repositoryId) ?? null,
  }));
  return {
    schemaVersion: 1,
    manifestDigest: "a".repeat(64),
    runId: "run",
    status: "completed",
    startedAt: "2026-07-31T12:00:00.000Z",
    frozenAt: "2026-07-31T12:01:00.000Z",
    publishedAt: "2026-07-31T12:02:00.000Z",
    configuration,
    trace: { path: "trace.jsonl", metadataPath: "trace.meta.json" },
    releases: fixture.frozen.workspaces.map(({ agentId }) => ({
      agentId,
      ordinal: 1,
      variantId: "stationary",
      releasedAt: "2026-07-31T12:00:00.000Z",
      visiblePath: `evidence/${agentId}/stage-01.txt`,
      sha256: createHash("sha256").update("stage\n").digest("hex"),
    })),
    sessions: fixture.frozen.workspaces.map(({ agentId }) => ({
      agentId,
      model: binding,
      state: "finished" as const,
      inputTokens: 0,
      outputTokens: 0,
      activityCursor: 0,
      terminationReason: "finished",
    })),
    topology: {
      root: relative(fixture.runRoot, fixture.frozen.root),
      communicationMode: fixture.frozen.communicationMode,
      origins,
      workspaces: fixture.frozen.workspaces.map((workspace) => ({
        agentId: workspace.agentId,
        path: relative(fixture.runRoot, workspace.path),
        originId: workspace.repositoryId,
      })),
      treeSeal: fixture.frozen.treeSeal,
    },
    evaluations: [
      {
        evaluationId: "automatic-1",
        kind: "automatic",
        evaluatedAt: "2026-07-31T12:01:00.000Z",
        results: origins.map((origin) => ({
          originId: origin.originId,
          agentIds: origin.agentIds,
          status: "not-runnable" as const,
          ...(origin.mainCommit === null ? {} : { commit: origin.mainCommit }),
          error: "not evaluated",
        })),
      },
    ],
    analyses: [],
    sessionInfrastructureFailures: [],
  };
}

beforeEach(() => {
  runPythonJsonMock.mockReset();
  runPythonJsonMock.mockResolvedValue({
    matchedWords: 2,
    totalWords: 2,
    coverage: 1,
    accuracy: 1,
  });
});

describe("canonical origin evaluation", () => {
  it("evaluates the one shared main from a Git-free snapshot", async () => {
    const fixture = await evaluationFixture("shared", "shared");
    const sandbox = scoringSandbox(async (request) => {
      expect(request.command).toBe(SOLVER_COMMAND);
      expect(request.outputPath).toBe(SOLVER_OUTPUT_PATH);
      await expect(access(join(request.submissionPath, ".git"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(join(request.submissionPath, "solver.py"), "utf8")).toContain(
        '"shared"',
      );
    });

    const evaluations = await evaluateCanonicalOrigins({
      ...fixture,
      variantId: "stationary",
      sandbox,
    });

    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]).toMatchObject({
      originId: "shared",
      agentIds: ["agent-1", "agent-2"],
      status: "scored",
      commit: fixture.publishedCommits.get("shared"),
      score: { matchedWords: 2, totalWords: 2, coverage: 1, accuracy: 1 },
    });
    expect(evaluations[0]?.outputPath).toMatch(
      /^evaluations\/batch-[^/]+\/shared\/output\/reconstruction\.txt$/,
    );
    const trace = await readFile(fixture.tracePath, "utf8");
    expect(trace).toContain('"kind":"evaluation.completed"');
    expect(trace).toContain('"originId":"shared"');
  });

  it("evaluates every isolated origin and preserves a missing main", async () => {
    const fixture = await evaluationFixture("isolated", ["agent-1"]);

    const evaluations = await evaluateCanonicalOrigins({
      ...fixture,
      variantId: "stationary",
      sandbox: scoringSandbox(),
    });

    expect(evaluations).toHaveLength(2);
    expect(evaluations[0]).toMatchObject({
      originId: "agent-1",
      agentIds: ["agent-1"],
      status: "scored",
      commit: fixture.publishedCommits.get("agent-1"),
    });
    expect(evaluations[1]).toMatchObject({
      originId: "agent-2",
      agentIds: ["agent-2"],
      status: "not-runnable",
      error: expect.stringMatching(/refs\/heads\/main/),
    });
    expect(evaluations[1]).not.toHaveProperty("commit");
  });

  it.each([
    ["no-output", SUCCESS],
    ["execution-error", { ...SUCCESS, exitCode: 7 }],
  ] as const)("preserves the %s solver outcome", async (status, execution) => {
    const fixture = await evaluationFixture("shared", "shared");
    const sandbox = new FakeCommandSandbox(async () => execution);

    const evaluations = await evaluateCanonicalOrigins({
      ...fixture,
      variantId: "stationary",
      sandbox,
    });

    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]).toMatchObject({
      originId: "shared",
      status,
      commit: fixture.publishedCommits.get("shared"),
    });
    if (status === "execution-error") {
      expect(evaluations[0]?.error).toBe("Published solver exited 7.");
    } else {
      expect(evaluations[0]).not.toHaveProperty("error");
    }
  });

  it("rejects a frozen topology that does not match the fixture agents", async () => {
    const fixture = await evaluationFixture("isolated", ["agent-1"]);
    const frozen = {
      ...fixture.frozen,
      repositories: fixture.frozen.repositories.slice(0, 1),
    };

    await expect(
      evaluateCanonicalOrigins({
        ...fixture,
        frozen,
        variantId: "stationary",
        sandbox: scoringSandbox(),
      }),
    ).rejects.toThrow(/one canonical origin per fixture agent/i);
  });

  it("appends re-evaluation history without changing the published trace", async () => {
    const fixture = await evaluationFixture("shared", "shared");
    await publishRunRecord(fixture.runRoot, runRecord(fixture));
    const log = await JsonlObservationLog.open(fixture.tracePath, { nowEpochMs: () => Date.now() });
    await log.append("review.note", { accepted: true });
    const traceBefore = await readFile(fixture.tracePath, "utf8");

    await expect(
      reevaluateRun({
        root: fixture.root,
        runRoot: fixture.runRoot,
        sandbox: scoringSandbox(),
      }),
    ).resolves.toMatchObject([{ originId: "shared", status: "scored" }]);

    expect(await readFile(fixture.tracePath, "utf8")).toBe(traceBefore);
    const persisted = JSON.parse(await readFile(join(fixture.runRoot, "run.json"), "utf8"));
    expect(persisted.evaluations).toHaveLength(2);
    expect(persisted.evaluations[1]).toMatchObject({ kind: "review" });
  });

  it("re-evaluates after the complete fixture and run artifact tree moves", async () => {
    const fixture = await evaluationFixture("shared", "shared");
    await publishRunRecord(fixture.runRoot, runRecord(fixture));
    const movedRoot = `${fixture.root}-moved`;
    await rename(fixture.root, movedRoot);

    await expect(
      reevaluateRun({
        root: movedRoot,
        runRoot: join(movedRoot, "run"),
        sandbox: scoringSandbox(),
      }),
    ).resolves.toMatchObject([{ originId: "shared", status: "scored" }]);
  });

  it("rejects fixture drift before running a solver", async () => {
    const fixture = await evaluationFixture("shared", "shared");
    await publishRunRecord(fixture.runRoot, runRecord(fixture, "f".repeat(64)));
    const sandbox = scoringSandbox();
    const execute = vi.spyOn(sandbox, "execute");

    await expect(
      reevaluateRun({ root: fixture.root, runRoot: fixture.runRoot, sandbox }),
    ).rejects.toThrow(/differs from recorded digest/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing trace",
      async (fixture: Awaited<ReturnType<typeof evaluationFixture>>) => rm(fixture.tracePath),
    ],
    [
      "missing trace metadata",
      async (fixture: Awaited<ReturnType<typeof evaluationFixture>>) =>
        rm(join(fixture.runRoot, "trace.meta.json")),
    ],
    [
      "malformed trace",
      async (fixture: Awaited<ReturnType<typeof evaluationFixture>>) =>
        writeFile(fixture.tracePath, "not-json\n"),
    ],
    [
      "nonsequential trace",
      async (fixture: Awaited<ReturnType<typeof evaluationFixture>>) =>
        writeFile(
          fixture.tracePath,
          `${JSON.stringify({ sequence: 2, atMs: 1, kind: "event", data: {} })}\n`,
        ),
    ],
    [
      "timestamp-regressing trace",
      async (fixture: Awaited<ReturnType<typeof evaluationFixture>>) =>
        writeFile(
          fixture.tracePath,
          [
            JSON.stringify({ sequence: 1, atMs: 2, kind: "event", data: {} }),
            JSON.stringify({ sequence: 2, atMs: 1, kind: "event", data: {} }),
            "",
          ].join("\n"),
        ),
    ],
  ])("rejects a %s before re-evaluation", async (_name, corrupt) => {
    const fixture = await evaluationFixture("shared", "shared");
    await publishRunRecord(fixture.runRoot, runRecord(fixture));
    await corrupt(fixture);

    await expect(
      reevaluateRun({
        root: fixture.root,
        runRoot: fixture.runRoot,
        sandbox: scoringSandbox(),
      }),
    ).rejects.toThrow();
  });

  it("rejects redirected trace paths before re-evaluation", async () => {
    const fixture = await evaluationFixture("shared", "shared");
    const record = runRecord(fixture);
    await publishRunRecord(fixture.runRoot, record);
    await writeFile(
      join(fixture.runRoot, "run.json"),
      `${JSON.stringify({ ...record, trace: { path: "other.jsonl", metadataPath: "trace.meta.json" } })}\n`,
    );

    await expect(
      reevaluateRun({
        root: fixture.root,
        runRoot: fixture.runRoot,
        sandbox: scoringSandbox(),
      }),
    ).rejects.toThrow(/trace paths must be trace\.jsonl and trace\.meta\.json/i);
  });
});
