import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  decodeAttemptSummary,
  decodeBuildManifest,
  publishAttemptSummary,
  type AttemptSummary,
  type BuildPuzzleResult,
} from "../../src/artifacts.js";
import { hashProtocolSnapshot, resolveCondition } from "../../src/condition.js";
import { runExperiment, type ExperimentRunRequest } from "../../src/experiment.js";
import type { ModelAdapter } from "../../src/model.js";
import { testAttemptSummary, testBuildManifest } from "../../src/test-helpers.js";

const BUILD_ID = `build-${"a".repeat(64)}`;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

async function fixtureAttempt(
  request: ExperimentRunRequest,
  build: BuildPuzzleResult,
): Promise<AttemptSummary> {
  await mkdir(request.output, { recursive: true });
  const agentIds = Object.keys(request.agents).sort() as Array<keyof typeof request.agents>;
  const base = testAttemptSummary({ condition: request.condition });
  const condition = resolveCondition(request.condition);
  const protocol = {
    ...(base.protocol as Record<string, unknown>),
    buildId: build.variants[condition.variantId],
    tokenBudgetPerAgent: request.tokenBudgetPerAgent,
    models: agentIds.map((agentId) => ({
      agentId,
      model: request.agents[agentId]!.model,
    })),
  };
  const frozenRoot = join(request.output, "frozen");
  const summary = decodeAttemptSummary({
    ...base,
    attemptId: `attempt-${request.runName}-${String(request.repetition)}`,
    runName: request.runName,
    repetition: request.repetition,
    buildId: build.variants[condition.variantId],
    buildRoot: build.buildPath,
    agentIds,
    tokenBudgetPerAgent: request.tokenBudgetPerAgent,
    protocolDigest: hashProtocolSnapshot(protocol),
    protocol,
    tracePath: join(request.output, "trace.jsonl"),
    traceMetadataPath: join(request.output, "trace.meta.json"),
    frozen: {
      root: frozenRoot,
      communicationMode: condition.communicationMode,
      repositories:
        condition.communicationMode === "shared"
          ? [{ repositoryId: "shared", path: join(frozenRoot, "shared.git"), agentIds }]
          : agentIds.map((agentId) => ({
              repositoryId: agentId,
              path: join(frozenRoot, `${agentId}.git`),
              agentIds: [agentId],
            })),
      workspaces: agentIds.map((agentId) => ({
        agentId,
        path: join(frozenRoot, "workspaces", agentId),
        repositoryId: condition.communicationMode === "shared" ? "shared" : agentId,
      })),
    },
    sessions: agentIds.map((agentId) => ({
      agentId,
      model: request.agents[agentId]!.model,
      state: "finished",
      inputTokens: 1,
      outputTokens: 1,
      activityCursor: 0,
      terminationReason: "fixture complete",
    })),
  });
  await publishAttemptSummary(request.output, summary);
  return summary;
}

describe("puzzle experiment", () => {
  it("runs the checked-in multi-provider manifest through one provider-neutral pipeline", async () => {
    const root = resolve(".");
    const temporary = await mkdtemp(join(tmpdir(), "palimpsest-puzzle-experiment-"));
    temporaryRoots.push(temporary);
    const experimentRoot = join(temporary, "baseline");
    const build: BuildPuzzleResult = {
      pairedBuildId: `paired-${"a".repeat(64)}`,
      blockId: "calibration-theron-ware",
      buildPath: join(experimentRoot, "build"),
      agentIds: ["agent-1", "agent-2", "agent-3"],
      stageCount: 6,
      variants: { stationary: BUILD_ID, rekey: BUILD_ID },
    };
    const requestedModels: string[] = [];
    let builds = 0;
    const unusedAdapter: ModelAdapter = {
      openSession() {
        throw new Error("Acceptance fixture must not make provider calls.");
      },
    };

    const summary = await runExperiment({
      root,
      configPath: "experiments/config.yaml",
      output: experimentRoot,
      condition: "CR",
      env: {
        OPENAI_API_KEY: "secret-canary-openai",
        ANTHROPIC_API_KEY: "secret-canary-anthropic",
        GOOGLE_GENERATIVE_AI_API_KEY: "secret-canary-google",
      },
      dependencies: {
        createAdapter: (options) => {
          requestedModels.push(options.model);
          return unusedAdapter;
        },
        build: async (options) => {
          builds += 1;
          expect(options.output).toBe(build.buildPath);
          return build;
        },
        readBuildManifest: async () => decodeBuildManifest(testBuildManifest()),
        run: async (request) => {
          const attempt = await fixtureAttempt(request, build);
          return {
            attemptId: attempt.attemptId,
            attemptRoot: request.output,
            sessions: attempt.sessions,
          };
        },
      },
    });

    expect(builds).toBe(1);
    expect(requestedModels).toEqual(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"]);
    expect(summary.attempts.map((attempt) => attempt.runName)).toEqual([
      "gpt-only",
      "claude-only",
      "gemini-only",
      "mixed",
    ]);
    expect(summary.attempts.map((attempt) => attempt.attemptRoot)).toEqual([
      join(experimentRoot, "attempts/gpt-only/001"),
      join(experimentRoot, "attempts/claude-only/001"),
      join(experimentRoot, "attempts/gemini-only/001"),
      join(experimentRoot, "attempts/mixed/001"),
    ]);

    const published = await readFile(join(experimentRoot, "experiment.json"), "utf8");
    expect(published).not.toContain("secret-canary");
    expect(JSON.parse(published)).toEqual(summary);
  });
});
