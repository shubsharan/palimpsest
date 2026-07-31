import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decodeAttemptSummary,
  publishAttemptSummary,
  type AttemptSummary,
  type OverlapResult,
} from "../../src/artifacts.js";
import type { ConditionId } from "../../src/condition.js";
import { runGit } from "../../src/git.js";
import { appendTraceEvent } from "../../src/python.js";
import { finalizeAttempt } from "../../src/run.js";
import { sealTree } from "../../src/seal.js";
import { TEST_TREE_SEAL, testAttemptSummary } from "../../src/test-helpers.js";
import type { AttemptResult } from "../../src/run.js";
import type { AgentId } from "../../src/model.js";

const EMPTY_OVERLAP: OverlapResult = {
  findings: [],
  scan: {
    reachableObjectCount: 0,
    reachableBlobReferenceCount: 0,
    uniqueReachableBlobCount: 0,
    uniqueTextBlobCount: 0,
    repeatedTreeReferenceCount: 0,
    skippedNonTextBlobCount: 0,
  },
};
const AGENT_IDS = ["agent-1", "agent-2", "agent-3"] as const satisfies readonly AgentId[];

interface FrozenFixture {
  attemptRoot: string;
  buildRoot: string;
  result: AttemptResult;
}

async function frozenFixture(condition: ConditionId = "CR"): Promise<FrozenFixture> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-attempt-durability-"));
  const attemptRoot = join(root, "attempt");
  const buildRoot = join(root, "build");
  const frozenRoot = join(attemptRoot, "frozen");
  const artifact = decodeAttemptSummary(testAttemptSummary({ condition }));
  const repositories =
    artifact.communicationMode === "shared"
      ? [
          {
            repositoryId: "shared" as const,
            path: join(frozenRoot, "shared.git"),
            agentIds: AGENT_IDS,
          },
        ]
      : AGENT_IDS.map((agentId) => ({
          repositoryId: agentId,
          path: join(frozenRoot, `${agentId}.git`),
          agentIds: [agentId],
        }));
  const workspaces = AGENT_IDS.map((agentId) => ({
    agentId,
    path: join(frozenRoot, "workspaces", agentId),
    repositoryId: artifact.communicationMode === "shared" ? ("shared" as const) : agentId,
  }));
  await Promise.all([
    mkdir(buildRoot),
    ...repositories.map(({ path }) => runGit(["init", "--bare", "--initial-branch=main", path])),
    ...workspaces.map(({ path }) => mkdir(path, { recursive: true })),
  ]);
  await Promise.all(
    repositories.map(async (repository) => {
      const seed = join(root, `.seed-${repository.repositoryId}`);
      await runGit(["clone", repository.path, seed]);
      await runGit(["config", "user.name", "Palimpsest Test"], seed);
      await runGit(["config", "user.email", "test@palimpsest.invalid"], seed);
      await writeFile(join(seed, "solver.py"), "print('fixture')\n", "utf8");
      await runGit(["add", "solver.py"], seed);
      await runGit(["commit", "-m", "Publish solver"], seed);
      await runGit(["push", "origin", "HEAD:main"], seed);
    }),
  );
  const tracePath = join(attemptRoot, "trace.jsonl");
  const traceMetadataPath = join(attemptRoot, "trace.meta.json");
  await Promise.all([
    writeFile(
      traceMetadataPath,
      `${JSON.stringify({ schemaVersion: 1, startedAt: new Date(0).toISOString() })}\n`,
      "utf8",
    ),
    writeFile(
      tracePath,
      `${JSON.stringify({ sequence: 1, atMs: 0, kind: "attempt.frozen", data: {} })}\n`,
      "utf8",
    ),
    writeFile(join(workspaces[0]!.path, "frozen-input.txt"), "still here\n", "utf8"),
  ]);

  return {
    attemptRoot,
    buildRoot,
    result: {
      attemptId: "attempt-durable",
      studyPhase: "standalone",
      monetaryAuthorizationCeilingCents: 0,
      blockId: artifact.blockId,
      condition: artifact.condition,
      communicationMode: artifact.communicationMode,
      keyRegime: artifact.keyRegime,
      variantId: artifact.variantId,
      buildId: artifact.buildId,
      buildRoot,
      agentIds: AGENT_IDS,
      releaseOffsetsMs: artifact.releaseOffsetsMs,
      cutoffMs: artifact.cutoffMs,
      tokenBudgetPerAgent: artifact.tokenBudgetPerAgent,
      protocolDigest: artifact.protocolDigest,
      protocol: artifact.protocol,
      sessions: artifact.sessions,
      frozen: {
        root: frozenRoot,
        communicationMode: artifact.communicationMode,
        repositories,
        workspaces,
        frozen: true,
        treeSeal: TEST_TREE_SEAL,
      },
      tracePath,
      traceMetadataPath,
      sandbox: {
        imageTag: "palimpsest-puzzle-sandbox:0.1.0",
        imageId: `sha256:${"1".repeat(64)}`,
        sourceDigest: "2".repeat(64),
        profileVersion: 1,
      },
    },
  };
}

async function commandBoundary(operation: Promise<unknown>) {
  try {
    const result = await operation;
    return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${detail}\n` };
  }
}

async function readSummary(path: string): Promise<AttemptSummary> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  return decodeAttemptSummary(value);
}

describe("post-freeze attempt durability", () => {
  it.each([
    ["CR", "shared", 1],
    ["IR", "isolated", 3],
  ] as const)(
    "keeps a frozen %s attempt evaluatable when optional overlap observation fails",
    async (condition, communicationMode, repositoryCount) => {
      const fixture = await frozenFixture(condition);
      const primary = new Error("injected overlap observation failure");
      let overlapStarted = 0;

      const command = await commandBoundary(
        finalizeAttempt({
          attemptRoot: fixture.attemptRoot,
          buildRoot: fixture.buildRoot,
          buildTreeSeal: await sealTree(fixture.buildRoot),
          result: fixture.result,
          publishSummary: publishAttemptSummary,
          observeOverlap: async () => {
            overlapStarted += 1;
            const inputRoot = join(fixture.attemptRoot, "overlap-input");
            await mkdir(inputRoot);
            await writeFile(join(inputRoot, "request.json"), '{"partial":true}\n', "utf8");
            throw primary;
          },
          appendTrace: appendTraceEvent,
        }),
      );

      expect(command).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "injected overlap observation failure\n",
      });
      expect(overlapStarted).toBe(1);

      const summary = await readSummary(join(fixture.attemptRoot, "attempt.json"));
      expect(summary).toMatchObject({
        schemaVersion: 6,
        attemptId: fixture.result.attemptId,
        studyPhase: "standalone",
        monetaryAuthorizationCeilingCents: 0,
        infrastructureClassification: "none",
        buildRoot: fixture.buildRoot,
        condition,
        communicationMode,
        frozen: {
          root: fixture.result.frozen.root,
          communicationMode,
        },
      });
      expect(summary.frozen.repositories).toHaveLength(repositoryCount);
      expect(summary).not.toHaveProperty("studyRootId");
      expect(summary).not.toHaveProperty("conditionOrderPosition");
      expect(summary).not.toHaveProperty("designDigest");
      expect(summary).not.toHaveProperty("replacementOfAttemptId");
      const selectedWorkspace = summary.frozen.workspaces.find(
        ({ agentId }) => agentId === "agent-1",
      );
      const selectedRepository = summary.frozen.repositories.find(
        ({ repositoryId }) => repositoryId === selectedWorkspace?.repositoryId,
      );
      if (selectedWorkspace === undefined || selectedRepository === undefined) {
        throw new Error("The durable attempt is missing agent-1's frozen Git assignment.");
      }
      await expect(
        readFile(join(selectedWorkspace.path, "frozen-input.txt"), "utf8"),
      ).resolves.toBe("still here\n");
      expect((await stat(selectedRepository.path)).isDirectory()).toBe(true);
      await expect(readFile(summary.tracePath, "utf8")).resolves.toContain(
        '"kind":"overlap.failed"',
      );
      await expect(stat(join(fixture.attemptRoot, "overlap.json"))).rejects.toThrow();
      expect(
        (await readdir(fixture.attemptRoot)).filter((name) => /overlap.*failed/i.test(name)),
      ).toEqual([]);

      await expect(
        readFile(join(selectedWorkspace.path, "frozen-input.txt"), "utf8"),
      ).resolves.toBe("still here\n");
    },
  );

  it("classifies a frozen infrastructure session during durable finalization", async () => {
    const fixture = await frozenFixture();
    const result: AttemptResult = {
      ...fixture.result,
      sessions: fixture.result.sessions.map((session) =>
        session.agentId === "agent-1"
          ? {
              ...session,
              state: "infrastructure-error",
              terminationReason: "provider unavailable",
            }
          : session,
      ),
    };

    await finalizeAttempt({
      attemptRoot: fixture.attemptRoot,
      buildRoot: fixture.buildRoot,
      buildTreeSeal: await sealTree(fixture.buildRoot),
      result,
      publishSummary: publishAttemptSummary,
      observeOverlap: async () => EMPTY_OVERLAP,
      appendTrace: appendTraceEvent,
    });

    const summary = await readSummary(join(fixture.attemptRoot, "attempt.json"));
    expect(summary).toMatchObject({
      studyPhase: "standalone",
      infrastructureClassification: "session-infrastructure-error",
    });
    expect(summary.sessions.find(({ agentId }) => agentId === "agent-1")).toMatchObject({
      state: "infrastructure-error",
      terminationReason: "provider unavailable",
    });
  });

  it("does not begin overlap or expose a partial summary when attempt publication fails", async () => {
    const fixture = await frozenFixture();
    let overlapStarted = 0;

    const operation = finalizeAttempt({
      attemptRoot: fixture.attemptRoot,
      buildRoot: fixture.buildRoot,
      buildTreeSeal: await sealTree(fixture.buildRoot),
      result: fixture.result,
      publishSummary: async (attemptRoot: string) => {
        await writeFile(join(attemptRoot, ".attempt.json.incomplete"), '{"attemptId":', "utf8");
        throw new Error("injected attempt publication failure");
      },
      observeOverlap: async () => {
        overlapStarted += 1;
        return EMPTY_OVERLAP;
      },
      appendTrace: appendTraceEvent,
    });

    await expect(operation).rejects.toThrow("injected attempt publication failure");
    expect(overlapStarted).toBe(0);
    await expect(stat(join(fixture.attemptRoot, "attempt.json"))).rejects.toThrow();
    await expect(readFile(fixture.result.tracePath, "utf8")).resolves.not.toContain(
      "overlap.observed",
    );
    await expect(stat(join(fixture.attemptRoot, "overlap.json"))).rejects.toThrow();
  });

  it("keeps the original overlap error primary when the diagnostic append also fails", async () => {
    const fixture = await frozenFixture();
    const primary = new Error("primary overlap failure");
    const operation = finalizeAttempt({
      attemptRoot: fixture.attemptRoot,
      buildRoot: fixture.buildRoot,
      buildTreeSeal: await sealTree(fixture.buildRoot),
      result: fixture.result,
      publishSummary: publishAttemptSummary,
      observeOverlap: async () => {
        throw primary;
      },
      appendTrace: async () => {
        throw new Error("secondary trace append failure");
      },
    });

    await expect(operation).rejects.toBe(primary);
    await expect(readSummary(join(fixture.attemptRoot, "attempt.json"))).resolves.toMatchObject({
      attemptId: fixture.result.attemptId,
    });
    await expect(readFile(fixture.result.tracePath, "utf8")).resolves.not.toContain(
      "secondary trace append failure",
    );
    await expect(stat(join(fixture.attemptRoot, "overlap.json"))).rejects.toThrow();
  });

  it("rejects build drift before durable publication or optional overlap", async () => {
    const fixture = await frozenFixture();
    const buildTreeSeal = await sealTree(fixture.buildRoot);
    await writeFile(join(fixture.buildRoot, "drifted.txt"), "changed during attempt\n", "utf8");
    let publications = 0;
    let overlapStarted = 0;

    await expect(
      finalizeAttempt({
        attemptRoot: fixture.attemptRoot,
        buildRoot: fixture.buildRoot,
        buildTreeSeal,
        result: fixture.result,
        publishSummary: async () => {
          publications += 1;
        },
        observeOverlap: async () => {
          overlapStarted += 1;
          return EMPTY_OVERLAP;
        },
        appendTrace: appendTraceEvent,
      }),
    ).rejects.toThrow(/Attempt build tree has drifted/);

    expect(publications).toBe(0);
    expect(overlapStarted).toBe(0);
    await expect(stat(join(fixture.attemptRoot, "attempt.json"))).rejects.toThrow();
  });
});
