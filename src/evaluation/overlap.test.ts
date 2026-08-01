import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeRun, analyzeRunFromFlags } from "./overlap.js";
import { computeFixturePackageContentDigest } from "../fixture/package.js";
import { runGit, type FrozenGitEnvironment, type GitRepository } from "../git.js";
import { freezeRunConfiguration, publishRunRecord, type RunRecord } from "../run/record.js";
import { sealTree } from "../seal.js";
import { FakeCommandSandbox } from "../test-helpers.js";
import { JsonlObservationLog } from "../trace.js";

const PLAINTEXT =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november\n";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function commitHistory(repository: GitRepository, leak: boolean): Promise<string> {
  const checkoutRoot = await mkdtemp(join(tmpdir(), "palimpsest-analysis-checkout-"));
  const checkout = join(checkoutRoot, "checkout");
  await runGit(["clone", repository.path, checkout]);
  await runGit(["config", "user.name", "Palimpsest Test"], checkout);
  await runGit(["config", "user.email", "test@palimpsest.invalid"], checkout);
  await writeFile(join(checkout, "solver.py"), "print('solver')\n", "utf8");
  if (leak) await writeFile(join(checkout, "discarded-notes.txt"), PLAINTEXT, "utf8");
  await runGit(["add", "."], checkout);
  await runGit(["commit", "-m", "Historical work"], checkout);
  await runGit(["push", "origin", "HEAD:main"], checkout);
  if (leak) {
    await runGit(["rm", "discarded-notes.txt"], checkout);
    await runGit(["commit", "-m", "Remove discarded notes"], checkout);
    await runGit(["push", "origin", "HEAD:main"], checkout);
  }
  return (await runGit(["rev-parse", "HEAD"], checkout)).stdout.trim();
}

async function fixturePackage(root: string): Promise<string> {
  const fixtureRoot = join(root, "fixture");
  const stage = "one two three four five six seven eight nine ten eleven twelve\n";
  const reference = "reference corpus\n";
  const oracle = "{}\n";
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
  ]);
  const content = {
    schemaVersion: 1,
    fixtureId: "analysis-fixture",
    window: { sha256: sha256(PLAINTEXT) },
    allocation: { path: "oracle/allocation.json", sha256: sha256(oracle) },
    oracleDesign: { path: "oracle/design.json", sha256: sha256(oracle) },
    manipulationCheck: { path: "oracle/manipulation-check.json", sha256: sha256(oracle) },
    agentIds: ["agent-1", "agent-2"],
    stageCount: 1,
    variants: {
      stationary: {
        variantId: "stationary",
        rekeyFromStage: null,
        buildId: `build-${"b".repeat(64)}`,
        publicCiphertextPath: "variants/stationary/complete/ciphertext.txt",
        publicCiphertextSha256: sha256("ciphertext\n"),
        referenceCorpusPath: "variants/stationary/references",
        referenceFiles: [
          {
            sourceId: "reference",
            sourceSha256: sha256(reference),
            path: "variants/stationary/references/reference.txt",
            byteLength: Buffer.byteLength(reference),
            sha256: sha256(reference),
          },
        ],
        stages: ["agent-1", "agent-2"].map((agentId) => ({
          agentId,
          ordinal: 1,
          sourcePath: `variants/stationary/private/${agentId}/stages/stage-01.txt`,
          sha256: sha256(stage),
        })),
      },
    },
  };
  await Promise.all([
    writeFile(
      join(fixtureRoot, "variants", "stationary", "complete", "ciphertext.txt"),
      "ciphertext\n",
    ),
    writeFile(
      join(fixtureRoot, "variants", "stationary", "references", "reference.txt"),
      reference,
    ),
    writeFile(
      join(fixtureRoot, "variants", "stationary", "private", "agent-1", "stages", "stage-01.txt"),
      stage,
    ),
    writeFile(
      join(fixtureRoot, "variants", "stationary", "private", "agent-2", "stages", "stage-01.txt"),
      stage,
    ),
    writeFile(join(fixtureRoot, "oracle", "plaintext.txt"), PLAINTEXT),
    writeFile(join(fixtureRoot, "oracle", "allocation.json"), oracle),
    writeFile(join(fixtureRoot, "oracle", "design.json"), oracle),
    writeFile(join(fixtureRoot, "oracle", "manipulation-check.json"), oracle),
  ]);
  const digest = await computeFixturePackageContentDigest(fixtureRoot, content);
  await writeFile(
    join(fixtureRoot, "fixture.json"),
    `${JSON.stringify({ ...content, contentDigest: digest })}\n`,
  );
  return digest;
}

async function analysisArtifact(mode: "shared" | "isolated") {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-analysis-"));
  const runRoot = join(root, "run");
  const frozenRoot = join(runRoot, "frozen");
  const digest = await fixturePackage(root);
  await mkdir(join(root, "python"));
  await symlink(join(process.cwd(), "python", ".venv"), join(root, "python", ".venv"));
  const agentIds = ["agent-1", "agent-2"] as const;
  const repositories: GitRepository[] =
    mode === "shared"
      ? [{ repositoryId: "shared", path: join(frozenRoot, "shared.git"), agentIds }]
      : agentIds.map((agentId) => ({
          repositoryId: agentId,
          path: join(frozenRoot, `${agentId}.git`),
          agentIds: [agentId],
        }));
  await Promise.all([
    mkdir(join(frozenRoot, "workspaces", "agent-1"), { recursive: true }),
    mkdir(join(frozenRoot, "workspaces", "agent-2"), { recursive: true }),
    ...repositories.map((repository) =>
      runGit(["init", "--bare", "--initial-branch=main", repository.path]),
    ),
  ]);
  const commits = new Map<string, string>();
  for (const [index, repository] of repositories.entries()) {
    commits.set(repository.repositoryId, await commitHistory(repository, index === 0));
  }
  const frozen: FrozenGitEnvironment = {
    frozen: true,
    root: frozenRoot,
    communicationMode: mode,
    repositories,
    workspaces: agentIds.map((agentId) => ({
      agentId,
      path: join(frozenRoot, "workspaces", agentId),
      repositoryId: mode === "shared" ? "shared" : agentId,
    })),
    treeSeal: await sealTree(frozenRoot),
  };
  await JsonlObservationLog.create(join(runRoot, "trace.jsonl"));
  const sandbox = new FakeCommandSandbox().identity;
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
      fixture: { id: "analysis-fixture", packagePath: "fixture", digest, variant: "stationary" },
      assignment: { "agent-1": "fixture", "agent-2": "fixture" },
      capabilities: { git: mode, teamRoom: "disabled" },
      schedule: { releaseOffsetsMs: [0], cutoffMs: 1000 },
      limits: { tokenLimitPerAgent: null, spendCeilingCents: 0 },
      labels: {},
    },
    models: agentIds.map((agentId) => ({ agentId, binding })),
    validation: {
      manifestPath: "experiment.yaml",
      manifestDigest: "a".repeat(64),
      fixture: { packagePath: "fixture", fixtureId: "analysis-fixture", contentDigest: digest },
      sandbox,
      smoke: {
        runId: "run-validation",
        fixtureId: "analysis-fixture",
        variantId: "stationary",
        fixtureDigest: digest,
        agentIds,
        stageCount: 1,
      },
      validatedAt: "2026-07-31T12:00:00.000Z",
      spendAuthorized: true,
    },
  });
  const origins = repositories.map((repository) => ({
    originId: repository.repositoryId,
    path: relative(runRoot, repository.path),
    agentIds: repository.agentIds,
    mainCommit: commits.get(repository.repositoryId)!,
  }));
  const record: RunRecord = {
    schemaVersion: 1,
    manifestDigest: "a".repeat(64),
    runId: "run",
    status: "completed",
    startedAt: "2026-07-31T12:00:00.000Z",
    frozenAt: "2026-07-31T12:01:00.000Z",
    publishedAt: "2026-07-31T12:02:00.000Z",
    configuration,
    trace: { path: "trace.jsonl", metadataPath: "trace.meta.json" },
    releases: agentIds.map((agentId) => ({
      agentId,
      ordinal: 1,
      variantId: "stationary",
      releasedAt: "2026-07-31T12:00:00.000Z",
      visiblePath: `evidence/${agentId}/stage-01.txt`,
      sha256: sha256("one two three four five six seven eight nine ten eleven twelve\n"),
    })),
    sessions: agentIds.map((agentId) => ({
      agentId,
      model: binding,
      state: "finished",
      inputTokens: 0,
      outputTokens: 0,
      activityCursor: 0,
      terminationReason: "finished",
    })),
    topology: {
      root: "frozen",
      communicationMode: mode,
      origins,
      workspaces: frozen.workspaces.map((workspace) => ({
        agentId: workspace.agentId,
        path: relative(runRoot, workspace.path),
        originId: workspace.repositoryId,
      })),
      treeSeal: frozen.treeSeal,
    },
    evaluations: [
      {
        evaluationId: "automatic-1",
        kind: "automatic",
        evaluatedAt: "2026-07-31T12:01:00.000Z",
        results: origins.map((origin) => ({
          originId: origin.originId,
          agentIds: origin.agentIds,
          status: "not-runnable",
          ...(origin.mainCommit === null ? {} : { commit: origin.mainCommit }),
          error: "not evaluated",
        })),
      },
    ],
    analyses: [],
    sessionInfrastructureFailures: [],
  };
  await publishRunRecord(runRoot, record);
  return { root, runRoot, record };
}

describe("run overlap analysis", () => {
  it.each(["shared", "isolated"] as const)(
    "scans complete reachable %s history and appends ordered analysis without changing evidence",
    async (mode) => {
      const artifact = await analysisArtifact(mode);
      const moved = `${artifact.root}-moved`;
      await rename(artifact.root, moved);
      const runRoot = join(moved, "run");
      const traceBefore = await readFile(join(runRoot, "trace.jsonl"), "utf8");
      const before = JSON.parse(await readFile(join(runRoot, "run.json"), "utf8"));

      const first = await analyzeRun({ root: moved, runRoot, minimumWords: 8 });
      const second = await analyzeRun({ root: moved, runRoot, minimumWords: 9 });

      expect(first.origins[0]?.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            committedPath: "discarded-notes.txt",
            sourceKind: "plaintext",
          }),
        ]),
      );
      expect(first.origins[0]?.scan.reachableBlobReferenceCount).toBeGreaterThan(1);
      expect(first.origins).toHaveLength(mode === "shared" ? 1 : 2);
      const after = JSON.parse(await readFile(join(runRoot, "run.json"), "utf8"));
      expect(after.analyses.map(({ analysisId }: { analysisId: string }) => analysisId)).toEqual([
        first.analysisId,
        second.analysisId,
      ]);
      expect(after.status).toBe(before.status);
      expect(after.configuration).toEqual(before.configuration);
      expect(after.topology).toEqual(before.topology);
      expect(after.evaluations).toEqual(before.evaluations);
      expect(await readFile(join(runRoot, "trace.jsonl"), "utf8")).toBe(traceBefore);
      expect((await readdir(runRoot)).filter((name) => name.startsWith(".analysis-"))).toEqual([]);
    },
  );

  it("defaults to 32 words and rejects thresholds below eight", async () => {
    const artifact = await analysisArtifact("shared");
    await expect(
      analyzeRunFromFlags(new Map([["--run-root", artifact.runRoot]]), artifact.root),
    ).resolves.toMatchObject({ minimumWords: 32 });
    await expect(
      analyzeRunFromFlags(
        new Map([
          ["--run-root", artifact.runRoot],
          ["--minimum-words", "7"],
        ]),
        artifact.root,
      ),
    ).rejects.toThrow(/at least 8/i);
  });

  it("leaves the record unchanged and removes staging when analysis fails", async () => {
    const artifact = await analysisArtifact("shared");
    const before = await readFile(join(artifact.runRoot, "run.json"), "utf8");
    await writeFile(join(artifact.root, "fixture", "oracle", "plaintext.txt"), "drift\n");

    await expect(analyzeRun({ root: artifact.root, runRoot: artifact.runRoot })).rejects.toThrow();

    expect(await readFile(join(artifact.runRoot, "run.json"), "utf8")).toBe(before);
    expect(
      (await readdir(artifact.runRoot)).filter((name) => name.startsWith(".analysis-")),
    ).toEqual([]);
  });
});
