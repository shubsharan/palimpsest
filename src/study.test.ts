import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  decodeAttemptSummary,
  publishAttemptSummary,
  readDesignReceipt,
  readPhaseSummary,
  type AttemptSummary,
} from "./artifacts.js";
import { hashProtocolSnapshot, resolveCondition } from "./condition.js";
import { loadStudyManifest, resolveStudy, type ResolvedStudy } from "./config.js";
import type { ModelBinding } from "./model.js";
import { SANDBOX_POLICY } from "./sandbox/contracts.js";
import {
  executeStudyPhase,
  prepareStudyDesign,
  StudyPhaseStoppedError,
  type StudyCellLaunch,
} from "./study.js";
import { TEST_SANDBOX_IDENTITY, testAttemptSummary } from "./test-helpers.js";

const root = resolve(".");
const sourceRevision = "1".repeat(40);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "palimpsest-study-state-"));
  temporaryRoots.push(path);
  return path;
}

async function prepareFixture(): Promise<{
  studyRoot: string;
  study: ResolvedStudy;
  receipt: Awaited<ReturnType<typeof prepareStudyDesign>>;
}> {
  const studyRoot = await temporaryRoot();
  const study = await resolveStudy(await loadStudyManifest("experiments/config.yaml"), root);
  const receipt = await prepareStudyDesign({
    root,
    studyRoot,
    study,
    phase: "calibration",
    dependencies: {
      sourceRevision: async () => sourceRevision,
      sandboxIdentity: async () => TEST_SANDBOX_IDENTITY,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    },
  });
  return { studyRoot, study, receipt };
}

function modelBindings(study: ResolvedStudy): readonly ModelBinding[] {
  return study.assignment.map((assignment) => {
    const profile = study.models[assignment.modelProfileId];
    if (profile === undefined) {
      throw new Error(`Missing fixture model ${assignment.modelProfileId}.`);
    }
    const provider = study.providers[profile.provider];
    if (provider === undefined) {
      throw new Error(`Missing fixture provider ${profile.provider}.`);
    }
    return {
      profile: assignment.modelProfileId,
      provider: profile.provider,
      driver: provider.driver,
      requestedModel: profile.model,
      settings: profile.settings,
      providerOptions: profile.providerOptions,
    };
  });
}

async function publishLaunchAttempt(
  launch: StudyCellLaunch,
  study: ResolvedStudy,
  infrastructureFailure: boolean,
): Promise<AttemptSummary> {
  const condition = resolveCondition(launch.cell.condition);
  const base = testAttemptSummary({
    condition: condition.id,
    studyPhase: launch.cell.phase,
    ...(infrastructureFailure ? { infrastructureAgentId: "agent-1" } : {}),
    ...(launch.replacementOfAttemptId === undefined
      ? {}
      : { replacementOfAttemptId: launch.replacementOfAttemptId }),
  });
  const models = modelBindings(study);
  const protocolModels = study.assignment.map((assignment, index) => ({
    agentId: assignment.agentId,
    model: models[index]!,
  }));
  const protocol = {
    ...(base.protocol as Record<string, unknown>),
    blockId: launch.cell.blockId,
    condition: condition.id,
    communicationMode: condition.communicationMode,
    keyRegime: condition.keyRegime,
    variantId: condition.variantId,
    buildId: launch.cell.buildId,
    tokenBudgetPerAgent: launch.tokenBudgetPerAgent,
    models: protocolModels,
    sandbox: { ...TEST_SANDBOX_IDENTITY, ...SANDBOX_POLICY },
  };
  const frozenRoot = join(launch.attemptRoot, "frozen");
  const agentIds = study.assignment.map(({ agentId }) => agentId);
  const repositories =
    condition.communicationMode === "shared"
      ? [
          {
            repositoryId: "shared",
            path: join(frozenRoot, "shared.git"),
            agentIds,
          },
        ]
      : agentIds.map((agentId) => ({
          repositoryId: agentId,
          path: join(frozenRoot, `${agentId}.git`),
          agentIds: [agentId],
        }));
  const summary = decodeAttemptSummary({
    ...base,
    attemptId: launch.attemptId,
    studyPhase: launch.cell.phase,
    studyRootId: launch.studyRootId,
    conditionOrderPosition: launch.cell.conditionOrderPosition,
    designDigest: launch.designDigest,
    monetaryAuthorizationCeilingCents: launch.monetaryAuthorizationCeilingCents,
    ...(launch.replacementOfAttemptId === undefined
      ? {}
      : { replacementOfAttemptId: launch.replacementOfAttemptId }),
    blockId: launch.cell.blockId,
    condition: condition.id,
    communicationMode: condition.communicationMode,
    keyRegime: condition.keyRegime,
    variantId: condition.variantId,
    buildId: launch.cell.buildId,
    buildRoot: launch.cell.buildRoot,
    tokenBudgetPerAgent: launch.tokenBudgetPerAgent,
    protocolDigest: hashProtocolSnapshot(protocol),
    protocol,
    tracePath: join(launch.attemptRoot, "trace.jsonl"),
    traceMetadataPath: join(launch.attemptRoot, "trace.meta.json"),
    frozen: {
      root: frozenRoot,
      communicationMode: condition.communicationMode,
      repositories,
      workspaces: agentIds.map((agentId) => ({
        agentId,
        path: join(frozenRoot, "workspaces", agentId),
        repositoryId: condition.communicationMode === "shared" ? "shared" : agentId,
      })),
    },
    sandbox: { ...TEST_SANDBOX_IDENTITY, ...SANDBOX_POLICY },
    sessions: study.assignment.map((assignment, index) => ({
      agentId: assignment.agentId,
      model: models[index]!,
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
  await publishAttemptSummary(launch.attemptRoot, summary);
  return summary;
}

describe("frozen study state", () => {
  it("binds five build bytes and accepts only declared validation budget changes", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    expect(receipt.builds).toHaveLength(5);
    expect(await readDesignReceipt(studyRoot)).toEqual(receipt);

    const adjustedManifest = await loadStudyManifest("experiments/config.yaml");
    adjustedManifest.budgets.tokenBudgetPerAgent = 150_000;
    adjustedManifest.budgets.perAttemptMonetaryCeilingCents = 8_000;
    const adjusted = await resolveStudy(adjustedManifest, root);
    const reused = await prepareStudyDesign({
      root,
      studyRoot,
      study: adjusted,
      phase: "validation",
      dependencies: {
        sourceRevision: async () => sourceRevision,
        sandboxIdentity: async () => TEST_SANDBOX_IDENTITY,
      },
    });
    expect(reused.designDigest).toBe(receipt.designDigest);

    const immutableDrift = await loadStudyManifest("experiments/config.yaml");
    immutableDrift.models.gpt!.model = "different-model";
    await expect(
      prepareStudyDesign({
        root,
        studyRoot,
        study: await resolveStudy(immutableDrift, root),
        phase: "validation",
        dependencies: {
          sourceRevision: async () => sourceRevision,
          sandboxIdentity: async () => TEST_SANDBOX_IDENTITY,
        },
      }),
    ).rejects.toThrow(/immutable manifest/);

    const manifestPath = join(studyRoot, "builds", study.blocks[0]!.blockId, "puzzle-build.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.seed = Number(manifest.seed) + 1;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(
      prepareStudyDesign({
        root,
        studyRoot,
        study,
        phase: "calibration",
        dependencies: {
          sourceRevision: async () => sourceRevision,
          sandboxIdentity: async () => TEST_SANDBOX_IDENTITY,
        },
      }),
    ).rejects.toThrow(/drifted/);
  }, 60_000);

  it("freezes an infrastructure failure and permits only cited replacements within ceilings", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    let launches = 0;
    const dependencies = {
      beforeLaunch: async () => {},
      runCell: async (launch: StudyCellLaunch) => {
        launches += 1;
        return publishLaunchAttempt(launch, study, true);
      },
    };

    await expect(
      executeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
        dependencies,
      }),
    ).rejects.toBeInstanceOf(StudyPhaseStoppedError);
    let phase = await readPhaseSummary(studyRoot, "calibration");
    expect(phase.state).toBe("blocked");
    expect(phase.attempts).toHaveLength(1);
    expect(phase.reservations[0]).toMatchObject({
      kind: "primary",
      state: "resolved",
    });

    await expect(
      executeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
        dependencies,
      }),
    ).rejects.toThrow(/explicit --replace/);
    await expect(
      executeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
        replaceAttemptId: "attempt-not-current",
        dependencies,
      }),
    ).rejects.toThrow(/current frozen infrastructure failure/);

    for (let replacement = 0; replacement < 5; replacement += 1) {
      const sourceAttemptId = phase.failure?.attemptId;
      if (sourceAttemptId === undefined) {
        throw new Error("Fixture phase did not cite its infrastructure failure.");
      }
      await expect(
        executeStudyPhase({
          studyRoot,
          study,
          receipt,
          phase: "calibration",
          replaceAttemptId: sourceAttemptId,
          dependencies,
        }),
      ).rejects.toBeInstanceOf(StudyPhaseStoppedError);
      phase = await readPhaseSummary(studyRoot, "calibration");
      expect(phase.attempts.at(-1)?.replacementOfAttemptId).toBe(sourceAttemptId);
    }

    const finalSource = phase.failure?.attemptId;
    if (finalSource === undefined) {
      throw new Error("Fixture phase did not retain its last failed replacement.");
    }
    await expect(
      executeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
        replaceAttemptId: finalSource,
        dependencies,
      }),
    ).rejects.toThrow(/ceiling/);
    expect(launches).toBe(6);
    expect(phase.attempts).toHaveLength(6);
    expect(phase.reservations.filter(({ kind }) => kind === "replacement")).toHaveLength(5);
  }, 60_000);

  it("never relaunches an unresolved reservation", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    let launches = 0;
    const dependencies = {
      beforeLaunch: async () => {},
      runCell: async () => {
        launches += 1;
        throw new Error("fixture died before durable publication");
      },
    };
    await expect(
      executeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
        dependencies,
      }),
    ).rejects.toThrow(/fixture died/);
    expect((await readPhaseSummary(studyRoot, "calibration")).failure?.kind).toBe(
      "unresolved-reservation",
    );
    await expect(
      executeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
        dependencies,
      }),
    ).rejects.toThrow(/use a new study root/);
    expect(launches).toBe(1);
  }, 60_000);
});
