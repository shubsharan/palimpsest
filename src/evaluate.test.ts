import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { contentDigest } from "./canonical.js";
import {
  evaluateCanonicalOrigins,
  reevaluateRun,
  SOLVER_COMMAND,
  SOLVER_OUTPUT_PATH,
} from "./evaluate.js";
import { runGit, type FrozenGitEnvironment, type GitRepositoryId } from "./git.js";
import type { AgentId } from "./model.js";
import { runPythonJson } from "./python.js";
import { publishRunRecord, type RunRecord } from "./records.js";
import type { SandboxCommandResult, SolverSandboxCommand } from "./sandbox/contracts.js";
import { sealTree } from "./seal.js";
import { FakeCommandSandbox } from "./test-helpers.js";
import { JsonlObservationLog } from "./trace.js";

vi.mock("./python.js", async () => {
  const actual = await vi.importActual<typeof import("./python.js")>("./python.js");
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
  const reference = "reference\n";
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
    mkdir(join(fixtureRoot, "variants", "stationary", "complete"), { recursive: true }),
    mkdir(join(fixtureRoot, "variants", "stationary", "references"), { recursive: true }),
    mkdir(join(fixtureRoot, "variants", "stationary", "private", "agent-1", "stages"), {
      recursive: true,
    }),
    mkdir(join(fixtureRoot, "variants", "stationary", "private", "agent-2", "stages"), {
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
    sourcePath: `variants/stationary/private/${agentId}/stages/stage-01.txt`,
    sha256: digest(stageContent),
  }));
  const fixtureContent = {
    schemaVersion: 1,
    fixtureId: "evaluation-fixture",
    window: { sha256: digest(plaintext) },
    allocation: { path: "oracle/allocation.json", sha256: digest(oracleDocument) },
    oracleDesign: { path: "oracle/design.json", sha256: digest(oracleDocument) },
    manipulationCheck: {
      path: "oracle/manipulation-check.json",
      sha256: digest(oracleDocument),
    },
    agentIds,
    stageCount: 1,
    variants: {
      stationary: {
        variantId: "stationary",
        rekeyFromStage: null,
        buildId: `build-${"b".repeat(64)}`,
        publicCiphertextPath: "variants/stationary/complete/ciphertext.txt",
        publicCiphertextSha256: digest(ciphertext),
        referenceCorpusPath: "variants/stationary/references",
        referenceFiles: [
          {
            sourceId: "reference",
            sourceSha256: digest(reference),
            path: "variants/stationary/references/reference.txt",
            byteLength: Buffer.byteLength(reference),
            sha256: digest(reference),
          },
        ],
        stages,
      },
    },
  };
  await Promise.all([
    writeFile(
      join(fixtureRoot, "fixture.json"),
      `${JSON.stringify({ ...fixtureContent, contentDigest: contentDigest(fixtureContent) })}\n`,
      "utf8",
    ),
    writeFile(
      join(fixtureRoot, "variants", "stationary", "complete", "ciphertext.txt"),
      ciphertext,
      "utf8",
    ),
    writeFile(
      join(fixtureRoot, "variants", "stationary", "references", "reference.txt"),
      reference,
    ),
    ...agentIds.map((agentId) =>
      writeFile(
        join(fixtureRoot, "variants", "stationary", "private", agentId, "stages", "stage-01.txt"),
        stageContent,
      ),
    ),
    writeFile(join(fixtureRoot, "oracle", "plaintext.txt"), plaintext, "utf8"),
    writeFile(join(fixtureRoot, "oracle", "allocation.json"), oracleDocument, "utf8"),
    writeFile(join(fixtureRoot, "oracle", "design.json"), oracleDocument, "utf8"),
    writeFile(join(fixtureRoot, "oracle", "manipulation-check.json"), oracleDocument, "utf8"),
  ]);
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
  return { root, runRoot, fixtureRoot, tracePath, frozen, publishedCommits };
}

function scoringSandbox(inspect?: (request: SolverSandboxCommand) => Promise<void>) {
  return new FakeCommandSandbox(async (request) => {
    if (request.profile !== "solver") throw new Error("Expected solver execution.");
    await inspect?.(request);
    await writeFile(join(request.outputRoot, request.outputPath), "clear answer\n", "utf8");
    return SUCCESS;
  });
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
      repositoryId: "shared",
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
    expect(trace).toContain('"repositoryId":"shared"');
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
      repositoryId: "agent-1",
      agentIds: ["agent-1"],
      status: "scored",
      commit: fixture.publishedCommits.get("agent-1"),
    });
    expect(evaluations[1]).toMatchObject({
      repositoryId: "agent-2",
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
      repositoryId: "shared",
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
    const binding = {
      profile: "fixture",
      provider: "fixture",
      driver: "openai-compatible" as const,
      requestedModel: "fixture",
      settings: {},
      providerOptions: {},
    };
    const record: RunRecord = {
      schemaVersion: 1,
      experimentId: "experiment",
      run: {
        id: "run",
        fixture: {
          id: "evaluation-fixture",
          packagePath: fixture.fixtureRoot,
          digest: "a".repeat(64),
          variant: "stationary",
        },
        assignment: { "agent-1": "fixture", "agent-2": "fixture" },
        capabilities: { git: "shared", teamRoom: "disabled" },
        schedule: { releaseOffsetsMs: [0], cutoffMs: 1_000 },
        limits: { tokenLimitPerAgent: null, spendCeilingCents: 0 },
        labels: {},
      },
      models: fixture.frozen.workspaces.map(({ agentId }) => ({ agentId, binding })),
      sessions: fixture.frozen.workspaces.map(({ agentId }) => ({
        agentId,
        model: binding,
        state: "finished" as const,
        inputTokens: 0,
        outputTokens: 0,
        activityCursor: 0,
        terminationReason: "finished",
      })),
      trace: { path: fixture.tracePath, metadataPath: `${fixture.tracePath}.meta.json` },
      frozen: fixture.frozen,
      sandbox: new FakeCommandSandbox().identity,
      evaluations: [
        {
          repositoryId: "shared",
          agentIds: ["agent-1", "agent-2"],
          status: "not-runnable",
        },
      ],
      status: "completed",
    };
    await publishRunRecord(fixture.runRoot, record);
    const traceBefore = await readFile(fixture.tracePath, "utf8");

    await expect(
      reevaluateRun({
        root: fixture.root,
        runRoot: fixture.runRoot,
        sandbox: scoringSandbox(),
      }),
    ).resolves.toMatchObject([{ repositoryId: "shared", status: "scored" }]);

    expect(await readFile(fixture.tracePath, "utf8")).toBe(traceBefore);
    await expect(readdir(join(fixture.runRoot, "evaluations", "history"))).resolves.toHaveLength(1);
  });
});
