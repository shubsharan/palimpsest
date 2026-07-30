import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  decodeAttemptSummary,
  decodeBuildManifest,
  publishAttemptSummary,
  readDesignReceipt,
  readPhaseSummary,
  selectBuildVariant,
  type AttemptSummary,
} from "../../src/artifacts.js";
import { hashProtocolSnapshot, resolveCondition } from "../../src/condition.js";
import { runStudyExperiment } from "../../src/experiment.js";
import type { ModelAdapter } from "../../src/model.js";
import { readSourceState } from "../../src/preflight.js";
import { buildAgentPrompt } from "../../src/prompt.js";
import { readJsonObject } from "../../src/python.js";
import type { RunPuzzleOptions } from "../../src/run.js";
import { SANDBOX_POLICY } from "../../src/sandbox/contracts.js";
import { sealTree } from "../../src/seal.js";
import { prepareStudyDesign } from "../../src/study.js";
import {
  FakeCommandSandbox,
  TEST_SANDBOX_IDENTITY,
  testAttemptSummary,
} from "../../src/test-helpers.js";

const root = resolve(".");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "palimpsest-study-acceptance-"));
  temporaryRoots.push(path);
  return path;
}

async function publishFixtureAttempt(
  request: RunPuzzleOptions,
  infrastructureFailure: boolean,
): Promise<AttemptSummary> {
  const manifest = decodeBuildManifest(
    await readJsonObject(join(request.buildRoot, "puzzle-build.json")),
  );
  const condition = resolveCondition(request.condition);
  const variant = selectBuildVariant(manifest, condition.variantId);
  const base = testAttemptSummary({
    condition: condition.id,
    studyPhase: request.studyPhase === "standalone" ? "calibration" : request.studyPhase,
    ...(infrastructureFailure ? { infrastructureAgentId: "agent-1" } : {}),
    ...(request.replacementOfAttemptId === undefined
      ? {}
      : { replacementOfAttemptId: request.replacementOfAttemptId }),
  });
  const agents = manifest.agentIds.map((agentId) => ({
    agentId,
    model: request.agents[agentId]!.model,
  }));
  const protocol = {
    ...(base.protocol as Record<string, unknown>),
    blockId: manifest.blockId,
    condition: condition.id,
    communicationMode: condition.communicationMode,
    keyRegime: condition.keyRegime,
    variantId: condition.variantId,
    buildId: variant.buildId,
    tokenBudgetPerAgent: request.tokenBudgetPerAgent,
    models: agents,
    prompts: manifest.agentIds.map((agentId) => ({
      agentId,
      prompt: buildAgentPrompt({
        agentId,
        condition: condition.id,
        tokenBudgetPerAgent: request.tokenBudgetPerAgent,
      }),
    })),
    sandbox: { ...TEST_SANDBOX_IDENTITY, ...SANDBOX_POLICY },
  };
  const attemptId = request.attemptId;
  if (attemptId === undefined) {
    throw new Error("Study fixture requires an explicit attempt ID.");
  }
  const frozenRoot = join(request.output, "frozen");
  const repositories =
    condition.communicationMode === "shared"
      ? [
          {
            repositoryId: "shared",
            path: join(frozenRoot, "shared.git"),
            agentIds: manifest.agentIds,
          },
        ]
      : manifest.agentIds.map((agentId) => ({
          repositoryId: agentId,
          path: join(frozenRoot, `${agentId}.git`),
          agentIds: [agentId],
        }));
  const workspaces = manifest.agentIds.map((agentId) => ({
    agentId,
    path: join(frozenRoot, "workspaces", agentId),
    repositoryId: condition.communicationMode === "shared" ? "shared" : agentId,
  }));
  await Promise.all(
    [...repositories.map(({ path }) => path), ...workspaces.map(({ path }) => path)].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  );
  const summary = decodeAttemptSummary({
    ...base,
    attemptId,
    studyPhase: request.studyPhase,
    studyRootId: request.studyRootId,
    conditionOrderPosition: request.conditionOrderPosition,
    designDigest: request.designDigest,
    monetaryAuthorizationCeilingCents: request.monetaryAuthorizationCeilingCents,
    ...(request.replacementOfAttemptId === undefined
      ? {}
      : { replacementOfAttemptId: request.replacementOfAttemptId }),
    blockId: manifest.blockId,
    condition: condition.id,
    communicationMode: condition.communicationMode,
    keyRegime: condition.keyRegime,
    variantId: condition.variantId,
    buildId: variant.buildId,
    buildRoot: request.buildRoot,
    buildTreeSeal: await sealTree(request.buildRoot),
    tokenBudgetPerAgent: request.tokenBudgetPerAgent,
    protocolDigest: hashProtocolSnapshot(protocol),
    protocol,
    tracePath: join(request.output, "trace.jsonl"),
    traceMetadataPath: join(request.output, "trace.meta.json"),
    frozen: {
      root: frozenRoot,
      communicationMode: condition.communicationMode,
      repositories,
      workspaces,
      treeSeal: await sealTree(frozenRoot),
    },
    sandbox: { ...TEST_SANDBOX_IDENTITY, ...SANDBOX_POLICY },
    sessions: manifest.agentIds.map((agentId, index) => ({
      agentId,
      model: request.agents[agentId]!.model,
      state: infrastructureFailure && index === 0 ? "infrastructure-error" : "finished",
      inputTokens: 1,
      outputTokens: 1,
      activityCursor: 0,
      terminationReason:
        infrastructureFailure && index === 0
          ? "fixture infrastructure failure"
          : "fixture complete",
      ...(infrastructureFailure && index === 0 ? {} : { finalResponse: "fixture complete" }),
    })),
  });
  await publishAttemptSummary(request.output, summary);
  return summary;
}

describe("frozen five-block study", () => {
  it("runs all twenty cells sequentially with one explicit replacement and no provider request", async () => {
    const studyRoot = await temporaryRoot();
    const source = await readSourceState(root);
    const sandbox = new FakeCommandSandbox();
    const launchConditions: string[] = [];
    let activeAttempts = 0;
    let maximumActiveAttempts = 0;
    let adapterCreations = 0;
    let providerRequests = 0;
    let failNextValidation = true;
    const env = {
      OPENAI_API_KEY: "secret-canary-openai",
      ANTHROPIC_API_KEY: "secret-canary-anthropic",
      GOOGLE_GENERATIVE_AI_API_KEY: "secret-canary-google",
    };

    const unusedAdapter: ModelAdapter = {
      openSession() {
        providerRequests += 1;
        throw new Error("Provider-free acceptance must not open a model session.");
      },
    };
    const dependencies = {
      createSandbox: async () => sandbox,
      prepareDesign: async (options: Parameters<typeof prepareStudyDesign>[0]) =>
        prepareStudyDesign({
          ...options,
          dependencies: {
            ...options.dependencies,
            sourceState: async () => ({
              testedCommit: source.testedCommit,
              sourceClean: true,
            }),
          },
        }),
      readPreflight: async () => ({
        schemaVersion: 1 as const,
        testedCommit: source.testedCommit,
        sourceClean: true as const,
        completedAt: "2026-07-29T12:00:00.000Z",
        sandbox: TEST_SANDBOX_IDENTITY,
      }),
      createAdapter: () => {
        adapterCreations += 1;
        return unusedAdapter;
      },
      run: async (request: RunPuzzleOptions) => {
        activeAttempts += 1;
        maximumActiveAttempts = Math.max(maximumActiveAttempts, activeAttempts);
        try {
          const receipt = await readDesignReceipt(studyRoot);
          const phase = await readPhaseSummary(
            studyRoot,
            request.studyPhase === "validation" ? "validation" : "calibration",
          );
          expect(receipt.builds).toHaveLength(5);
          expect(phase.reservations.at(-1)?.state).toBe("reserved");
          launchConditions.push(
            `${request.studyPhase}:${request.condition}:${request.replacementOfAttemptId ?? "primary"}`,
          );
          const infrastructureFailure =
            request.studyPhase === "validation" &&
            request.replacementOfAttemptId === undefined &&
            failNextValidation;
          if (infrastructureFailure) failNextValidation = false;
          return publishFixtureAttempt(request, infrastructureFailure);
        } finally {
          activeAttempts -= 1;
        }
      },
    };

    const calibration = await runStudyExperiment({
      root,
      configPath: "experiments/config.yaml",
      studyRoot,
      phase: "calibration",
      env,
      dependencies,
    });
    expect(calibration.state).toBe("complete");
    expect(calibration.attempts).toHaveLength(4);

    await expect(
      runStudyExperiment({
        root,
        configPath: "experiments/config.yaml",
        studyRoot,
        phase: "validation",
        env,
        dependencies,
      }),
    ).rejects.toThrow(/infrastructure failure/i);
    const blocked = await readPhaseSummary(studyRoot, "validation");
    const sourceAttemptId = blocked.failure?.attemptId;
    if (sourceAttemptId === undefined) {
      throw new Error("Blocked validation phase did not cite its failed attempt.");
    }

    const afterReplacement = await runStudyExperiment({
      root,
      configPath: "experiments/config.yaml",
      studyRoot,
      phase: "validation",
      replaceAttemptId: sourceAttemptId,
      env,
      dependencies,
    });
    expect(afterReplacement.state).toBe("running");
    expect(afterReplacement.attempts.at(-1)?.replacementOfAttemptId).toBe(sourceAttemptId);
    await expect(
      runStudyExperiment({
        root,
        configPath: "experiments/config.yaml",
        studyRoot,
        phase: "validation",
        replaceAttemptId: sourceAttemptId,
        env,
        dependencies,
      }),
    ).rejects.toThrow(/current frozen infrastructure failure/);

    const validation = await runStudyExperiment({
      root,
      configPath: "experiments/config.yaml",
      studyRoot,
      phase: "validation",
      env,
      dependencies,
    });
    expect(validation.state).toBe("complete");
    expect(validation.plannedCells).toHaveLength(16);
    expect(validation.attempts).toHaveLength(17);
    expect(new Set(validation.attempts.map((attempt) => attempt.cellId))).toHaveLength(16);
    expect(validation.reservations.filter(({ kind }) => kind === "replacement")).toHaveLength(1);
    expect(maximumActiveAttempts).toBe(1);
    expect(providerRequests).toBe(0);
    expect(adapterCreations).toBe(63);

    const receiptSource = await readFile(join(studyRoot, "design.json"), "utf8");
    expect(receiptSource).not.toContain("secret-canary");
    expect(JSON.parse(receiptSource)).toMatchObject({
      sourceRevision: source.testedCommit,
      builds: expect.arrayContaining([
        expect.objectContaining({ blockId: "calibration-theron-ware" }),
        expect.objectContaining({ blockId: "validation-woodlanders" }),
      ]),
    });
    expect(launchConditions.slice(0, 4)).toEqual([
      "calibration:CS:primary",
      "calibration:CR:primary",
      "calibration:IR:primary",
      "calibration:IS:primary",
    ]);
    expect(launchConditions[4]).toBe("validation:CS:primary");
    expect(launchConditions[5]).toBe(`validation:CS:${sourceAttemptId}`);
  }, 120_000);
});
