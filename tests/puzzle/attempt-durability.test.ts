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
import { evaluateFrozenAttempt } from "../../src/evaluate.js";
import { appendTraceEvent } from "../../src/python.js";
import { finalizeAttempt } from "../../src/run.js";
import { FakeCommandSandbox } from "../../src/test-helpers.js";
import type { AttemptResult } from "../../src/run.js";
import type { AgentId, ModelBinding } from "../../src/model.js";

const SUCCESS = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  outputExceeded: false,
} as const;

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
const BUILD_ID = `build-${"a".repeat(64)}`;
const AGENT_IDS = ["agent-1", "agent-2", "agent-3"] as const satisfies readonly AgentId[];
const MODEL: ModelBinding = {
  profile: "fixture",
  provider: "fixture",
  driver: "openai-compatible",
  requestedModel: "durability-fixture",
  settings: {},
  providerOptions: {},
};

interface FrozenFixture {
  attemptRoot: string;
  buildRoot: string;
  result: AttemptResult;
}

async function frozenFixture(): Promise<FrozenFixture> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-attempt-durability-"));
  const attemptRoot = join(root, "attempt");
  const buildRoot = join(root, "build");
  const frozenRoot = join(attemptRoot, "frozen");
  const workspaces = AGENT_IDS.map((agentId) => ({
    agentId,
    path: join(frozenRoot, "workspaces", agentId),
  }));
  await Promise.all([
    mkdir(buildRoot),
    mkdir(join(frozenRoot, "shared.git"), { recursive: true }),
    ...workspaces.map(({ path }) => mkdir(path, { recursive: true })),
  ]);
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
      buildId: BUILD_ID,
      buildRoot,
      runName: "durability",
      repetition: 1,
      agentIds: AGENT_IDS,
      sessions: AGENT_IDS.map((agentId) => ({
        agentId,
        model: MODEL,
        state: "finished" as const,
        inputTokens: 1,
        outputTokens: 1,
        activityCursor: 0,
        terminationReason: "finished",
        finalResponse: "done",
      })),
      frozen: {
        root: frozenRoot,
        barePath: join(frozenRoot, "shared.git"),
        workspaces,
        frozen: true,
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
  it("keeps a frozen attempt evaluatable when optional overlap observation fails", async () => {
    const fixture = await frozenFixture();
    const primary = new Error("injected overlap observation failure");
    let overlapStarted = 0;

    const command = await commandBoundary(
      finalizeAttempt({
        attemptRoot: fixture.attemptRoot,
        buildRoot: fixture.buildRoot,
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
      attemptId: fixture.result.attemptId,
      buildRoot: fixture.buildRoot,
      frozenRoot: fixture.result.frozen.root,
    });
    await expect(
      readFile(join(summary.frozenRoot, "workspaces", "agent-1", "frozen-input.txt"), "utf8"),
    ).resolves.toBe("still here\n");
    expect((await stat(join(summary.frozenRoot, "shared.git"))).isDirectory()).toBe(true);
    await expect(readFile(summary.tracePath, "utf8")).resolves.toContain('"kind":"overlap.failed"');
    await expect(stat(join(fixture.attemptRoot, "overlap.json"))).rejects.toThrow();
    expect(
      (await readdir(fixture.attemptRoot)).filter((name) => /overlap.*failed/i.test(name)),
    ).toEqual([]);

    const sandbox = new FakeCommandSandbox(async (request) => {
      if (request.profile !== "evaluation") throw new Error("Expected evaluation profile.");
      await writeFile(join(request.workspacePath, request.outputPath), "reconstruction\n", "utf8");
      return SUCCESS;
    });
    const evaluation = await evaluateFrozenAttempt({
      frozenWorkspacePath: join(summary.frozenRoot, "workspaces", "agent-1"),
      frozenGitPath: join(summary.frozenRoot, "shared.git"),
      evaluationRoot: join(fixture.attemptRoot, "evaluation"),
      ciphertextPath: join(fixture.buildRoot, "ciphertext.txt"),
      sandbox,
      selection: { command: "sh solve.sh", outputPath: "reconstruction.txt" },
      score: async () => ({ matchedWords: 1, totalWords: 1, coverage: 1, accuracy: 1 }),
    });
    expect(evaluation).toMatchObject({ status: "scored" });
  });

  it("does not begin overlap or expose a partial summary when attempt publication fails", async () => {
    const fixture = await frozenFixture();
    let overlapStarted = 0;

    const operation = finalizeAttempt({
      attemptRoot: fixture.attemptRoot,
      buildRoot: fixture.buildRoot,
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
});
