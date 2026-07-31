import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  decodeAttemptSummary,
  publishAttemptSummary,
  readDesignReceipt,
  readPhaseSummary,
  type AttemptSummary,
} from "./artifacts.js";
import type { BuildPuzzleOptions } from "./build.js";
import { hashProtocolSnapshot, resolveCondition } from "./condition.js";
import { loadStudyManifest, resolveStudy, type ResolvedStudy } from "./config.js";
import type { ModelBinding } from "./model.js";
import type { SourceState } from "./preflight.js";
import { buildAgentPrompt } from "./prompt.js";
import { SANDBOX_POLICY } from "./sandbox/contracts.js";
import { sealTree } from "./seal.js";
import {
  executeStudyPhase,
  initializeStudyPhase,
  prepareStudyDesign,
  StudyPhaseStoppedError,
  type StudyCellLaunch,
} from "./study.js";
import { TEST_SANDBOX_IDENTITY, testAttemptSummary, testBuildManifest } from "./test-helpers.js";
import { JsonlObservationLog } from "./trace.js";

const root = resolve(".");
const sourceRevision = "1".repeat(40);
const temporaryRoots: string[] = [];

function cleanSourceState(testedCommit = sourceRevision): SourceState {
  return { testedCommit, sourceClean: true };
}

async function publishFixtureBuild(options: BuildPuzzleOptions): Promise<void> {
  const manifest = testBuildManifest();
  const digest = (suffix: string) =>
    createHash("sha256").update(`${options.block}:${suffix}`).digest("hex");
  const digestBytes = (value: string): string => createHash("sha256").update(value).digest("hex");
  manifest.blockId = options.block;
  manifest.pairedBuildId = `paired-${digest("paired")}`;
  const variants = manifest.variants as Record<"stationary" | "rekey", Record<string, unknown>>;
  await mkdir(options.output, { recursive: true });
  const writeArtifact = async (path: string, content: string): Promise<string> => {
    await mkdir(dirname(join(options.output, path)), { recursive: true });
    await writeFile(join(options.output, path), content);
    return digestBytes(content);
  };
  const allocation = manifest.allocation as Record<string, unknown>;
  const oracleDesign = manifest.oracleDesign as Record<string, unknown>;
  const manipulationCheck = manifest.manipulationCheck as Record<string, unknown>;
  allocation.sha256 = await writeArtifact(String(allocation.path), `allocation:${options.block}\n`);
  oracleDesign.sha256 = await writeArtifact(String(oracleDesign.path), `oracle:${options.block}\n`);
  manipulationCheck.sha256 = await writeArtifact(
    String(manipulationCheck.path),
    `manipulation:${options.block}\n`,
  );
  await writeArtifact("oracle/plaintext.txt", `plaintext:${options.block}\n`);
  for (const stage of variants.stationary.stages as Array<Record<string, unknown>>) {
    await writeArtifact(
      `oracle/checker/${String(stage.agentId)}/${basename(String(stage.sourcePath))}`,
      `checker:${options.block}:${String(stage.agentId)}:${String(stage.ordinal)}\n`,
    );
  }
  for (const variant of Object.values(variants)) {
    const ciphertext = `ciphertext:${options.block}:${String(variant.variantId)}\n`;
    await writeArtifact(String(variant.publicCiphertextPath), ciphertext);
    const stages = variant.stages as Array<Record<string, unknown>>;
    for (const stage of stages) {
      const content = `stage:${options.block}:${String(stage.agentId)}:${String(stage.ordinal)}\n`;
      stage.sha256 = await writeArtifact(String(stage.sourcePath), content);
    }
    variant.buildId = `build-${hashProtocolSnapshot({
      schemaVersion: 1,
      blockId: manifest.blockId,
      variantId: variant.variantId,
      allocationId: allocation.allocationId,
      windowSha256: (manifest.window as Record<string, unknown>).sha256,
      complete: {
        byteLength: Buffer.byteLength(ciphertext),
        sha256: digestBytes(ciphertext),
      },
      stages,
      keyTransitions: variant.keyTransitions,
    })}`;
  }
  await writeFile(
    join(options.output, "puzzle-build.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "palimpsest-study-state-"));
  temporaryRoots.push(path);
  return path;
}

async function prepareFixture(options: { disableTokenLimit?: boolean } = {}): Promise<{
  studyRoot: string;
  study: ResolvedStudy;
  receipt: Awaited<ReturnType<typeof prepareStudyDesign>>;
}> {
  const studyRoot = await temporaryRoot();
  const manifest = await loadStudyManifest("experiments/config.yaml");
  if (options.disableTokenLimit === true) {
    manifest.budgets.tokenBudgetPerAgent = null;
    manifest.budgets.totalTokenCeiling = null;
  }
  const study = await resolveStudy(manifest, root);
  const receipt = await prepareStudyDesign({
    root,
    studyRoot,
    study,
    phase: "calibration",
    dependencies: {
      sourceState: async () => cleanSourceState(),
      sandboxIdentity: async () => TEST_SANDBOX_IDENTITY,
      build: publishFixtureBuild,
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
    releaseOffsetsMs: study.schedule.releaseOffsetsMs,
    cutoffMs: study.schedule.cutoffMs,
    tokenBudgetPerAgent: launch.tokenBudgetPerAgent,
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
    teamChannel: study.communication.teamChannel,
    models: protocolModels,
    prompts: study.assignment.map(({ agentId }) => ({
      agentId,
      prompt: buildAgentPrompt({
        agentId,
        condition: condition.id,
        cutoffMs: study.schedule.cutoffMs,
        tokenBudgetPerAgent: launch.tokenBudgetPerAgent,
        teamChannel: study.communication.teamChannel,
      }),
    })),
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
  const workspaces = agentIds.map((agentId) => ({
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
    buildTreeSeal: await sealTree(launch.cell.buildRoot),
    tokenBudgetPerAgent: launch.tokenBudgetPerAgent,
    protocolDigest: hashProtocolSnapshot(protocol),
    protocol,
    tracePath: join(launch.attemptRoot, "trace.jsonl"),
    traceMetadataPath: join(launch.attemptRoot, "trace.meta.json"),
    frozen: {
      root: frozenRoot,
      communicationMode: condition.communicationMode,
      repositories,
      workspaces,
      treeSeal: await sealTree(frozenRoot),
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
  const trace = await JsonlObservationLog.create(summary.tracePath, {
    startedAtMs: 0,
    nowMs: () => 0,
  });
  await trace.append("attempt.frozen", { fixture: true });
  await trace.flush();
  await publishAttemptSummary(launch.attemptRoot, summary);
  return summary;
}

describe("frozen study state", () => {
  it("freezes and accounts a time-only phase without inventing token authorization", async () => {
    const { studyRoot, study, receipt } = await prepareFixture({ disableTokenLimit: true });

    const phase = await executeStudyPhase({
      studyRoot,
      study,
      receipt,
      phase: "calibration",
      dependencies: {
        beforeLaunch: async () => {},
        runCell: async (launch) => {
          expect(launch.tokenBudgetPerAgent).toBeNull();
          await publishLaunchAttempt(launch, study, false);
        },
      },
    });

    expect(receipt.baselineBudgets.tokenBudgetPerAgent).toBeNull();
    expect(receipt.totalCeilings.tokens).toBeNull();
    expect(phase.cumulativeAuthorizedTokens).toBeNull();
    expect(phase.reservations).toHaveLength(4);
    expect(phase.reservations.every(({ authorizedTokens }) => authorizedTokens === null)).toBe(
      true,
    );
    expect(phase.attempts).toHaveLength(4);
  }, 60_000);

  it("binds five build bytes and rejects validation without separate authorization", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    expect(receipt.builds).toHaveLength(1);
    expect(await readDesignReceipt(studyRoot)).toEqual(receipt);

    const adjustedManifest = await loadStudyManifest("experiments/config.yaml");
    adjustedManifest.budgets.perAttemptMonetaryCeilingCents = 800;
    const adjusted = await resolveStudy(adjustedManifest, root);
    await expect(
      prepareStudyDesign({
        root,
        studyRoot,
        study: adjusted,
        phase: "validation",
        dependencies: {
          sourceState: async () => cleanSourceState(),
          sandboxIdentity: async () => TEST_SANDBOX_IDENTITY,
        },
      }),
    ).rejects.toThrow(/monetary ceiling/);

    const immutableDrift = await loadStudyManifest("experiments/config.yaml");
    immutableDrift.models.sol!.model = "different-model";
    await expect(
      prepareStudyDesign({
        root,
        studyRoot,
        study: await resolveStudy(immutableDrift, root),
        phase: "calibration",
        dependencies: {
          sourceState: async () => cleanSourceState(),
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
          sourceState: async () => cleanSourceState(),
          sandboxIdentity: async () => TEST_SANDBOX_IDENTITY,
        },
      }),
    ).rejects.toThrow(/drifted/);
  }, 60_000);

  it("rejects any receipt-bound build tree drift, including checker and scoring truth", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    const binding = receipt.builds[0]!;
    const variant = binding.manifest.variants.stationary;
    const stage = variant.stages[0]!;
    const paths = [
      stage.sourcePath,
      variant.publicCiphertextPath,
      "oracle/plaintext.txt",
      `oracle/checker/${stage.agentId}/${basename(stage.sourcePath)}`,
    ];
    for (const path of paths) {
      const absolute = join(binding.buildRoot, path);
      const original = await readFile(absolute);
      await writeFile(absolute, `tampered ${path}\n`);
      await expect(
        prepareStudyDesign({
          root,
          studyRoot,
          study,
          phase: "validation",
          dependencies: {
            sourceState: async () => cleanSourceState(),
            sandboxIdentity: async () => TEST_SANDBOX_IDENTITY,
          },
        }),
      ).rejects.toThrow(/Receipt-bound build .* has drifted/);
      await writeFile(absolute, original);
    }
  }, 60_000);

  it("recomputes the receipt baseline manifest digest during validation", async () => {
    const { studyRoot, study } = await prepareFixture();
    const path = join(studyRoot, "design.json");
    const receipt = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    receipt.manifestDigest = "f".repeat(64);
    await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);

    await expect(
      prepareStudyDesign({
        root,
        studyRoot,
        study,
        phase: "validation",
        dependencies: {
          sourceState: async () => cleanSourceState(),
          sandboxIdentity: async () => TEST_SANDBOX_IDENTITY,
        },
      }),
    ).rejects.toThrow(/manifestDigest.*baseline manifest/);
  }, 60_000);

  it("requires a clean source before touching construction dependencies", async () => {
    const studyRoot = await temporaryRoot();
    const study = await resolveStudy(await loadStudyManifest("experiments/config.yaml"), root);
    let builds = 0;
    let sandboxReads = 0;

    await expect(
      prepareStudyDesign({
        root,
        studyRoot,
        study,
        phase: "calibration",
        dependencies: {
          sourceState: async () => ({ testedCommit: sourceRevision, sourceClean: false }),
          build: async () => {
            builds += 1;
          },
          sandboxIdentity: async () => {
            sandboxReads += 1;
            return TEST_SANDBOX_IDENTITY;
          },
        },
      }),
    ).rejects.toThrow(/clean committed source checkout/);
    expect(builds).toBe(0);
    expect(sandboxReads).toBe(0);
    await expect(readDesignReceipt(studyRoot)).rejects.toThrow();
  });

  it("rejects unreceipted study-root residue without reusing builds", async () => {
    const studyRoot = await temporaryRoot();
    const study = await resolveStudy(await loadStudyManifest("experiments/config.yaml"), root);
    await writeFile(join(studyRoot, "orphaned-build.json"), "{}\n");
    let builds = 0;
    let sandboxReads = 0;

    await expect(
      prepareStudyDesign({
        root,
        studyRoot,
        study,
        phase: "calibration",
        dependencies: {
          sourceState: async () => cleanSourceState(),
          build: async () => {
            builds += 1;
          },
          sandboxIdentity: async () => {
            sandboxReads += 1;
            return TEST_SANDBOX_IDENTITY;
          },
        },
      }),
    ).rejects.toThrow(/unreceipted artifacts.*new study root/);
    expect(builds).toBe(0);
    expect(sandboxReads).toBe(0);
  });

  it("constructs the requested phase build and rechecks the source before publishing", async () => {
    const studyRoot = await temporaryRoot();
    const study = await resolveStudy(await loadStudyManifest("experiments/config.yaml"), root);
    let sourceReads = 0;
    let builds = 0;

    const receipt = await prepareStudyDesign({
      root,
      studyRoot,
      study,
      phase: "calibration",
      dependencies: {
        sourceState: async () => {
          sourceReads += 1;
          return cleanSourceState();
        },
        build: async (options) => {
          builds += 1;
          await publishFixtureBuild(options);
        },
        sandboxIdentity: async () => TEST_SANDBOX_IDENTITY,
        now: () => new Date("2026-07-29T12:00:00.000Z"),
      },
    });

    expect(sourceReads).toBe(2);
    expect(builds).toBe(1);
    expect(receipt.sourceRevision).toBe(sourceRevision);
    expect(receipt.builds).toHaveLength(1);
  });

  it.each([
    [
      "becomes dirty",
      { testedCommit: sourceRevision, sourceClean: false },
      /clean committed source checkout/,
    ],
    ["changes commits", cleanSourceState("2".repeat(40)), /source revision changed/i],
  ] as const)(
    "does not publish a receipt when the source %s during construction",
    async (_name, finalSource, expectedError) => {
      const studyRoot = await temporaryRoot();
      const study = await resolveStudy(await loadStudyManifest("experiments/config.yaml"), root);
      let sourceReads = 0;
      let builds = 0;

      await expect(
        prepareStudyDesign({
          root,
          studyRoot,
          study,
          phase: "calibration",
          dependencies: {
            sourceState: async () => {
              sourceReads += 1;
              return sourceReads === 1 ? cleanSourceState() : finalSource;
            },
            build: async (options) => {
              builds += 1;
              await publishFixtureBuild(options);
            },
            sandboxIdentity: async () => TEST_SANDBOX_IDENTITY,
          },
        }),
      ).rejects.toThrow(expectedError);
      expect(sourceReads).toBe(2);
      expect(builds).toBe(1);
      await expect(readDesignReceipt(studyRoot)).rejects.toThrow();
    },
  );

  it("stops without indexing when post-freeze work fails", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    let launches = 0;

    await expect(
      executeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
        dependencies: {
          beforeLaunch: async () => {},
          runCell: async (launch) => {
            launches += 1;
            await publishLaunchAttempt(launch, study, false);
            throw new Error("injected post-freeze failure");
          },
        },
      }),
    ).rejects.toThrow("injected post-freeze failure");

    expect(launches).toBe(1);
    const phase = await readPhaseSummary(studyRoot, "calibration");
    expect(phase.state).toBe("blocked");
    expect(phase.attempts).toEqual([]);
    expect(phase.reservations[0]?.state).toBe("reserved");
    expect(phase.failure?.kind).toBe("unresolved-reservation");
    await expect(
      access(
        join(studyRoot, "calibration", "attempts", "attempt-calibration-01-001", "attempt.json"),
      ),
    ).resolves.toBeUndefined();
    await expect(access(join(studyRoot, "calibration", ".execution.lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 60_000);

  it("allows only one coordinator to execute a phase", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    let releaseFirst!: () => void;
    let firstReached!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const reachedFirst = new Promise<void>((resolve) => {
      firstReached = resolve;
    });
    let firstLaunches = 0;
    let competingPreflights = 0;
    let competingLaunches = 0;

    const first = executeStudyPhase({
      studyRoot,
      study,
      receipt,
      phase: "calibration",
      dependencies: {
        beforeLaunch: async () => {
          firstReached();
          await holdFirst;
        },
        runCell: async () => {
          firstLaunches += 1;
          throw new Error("fixture stopped after claiming the phase");
        },
      },
    });
    await reachedFirst;

    await expect(
      executeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
        dependencies: {
          beforeLaunch: async () => {
            competingPreflights += 1;
            throw new Error("competing coordinator reached preflight");
          },
          runCell: async () => {
            competingLaunches += 1;
          },
        },
      }),
    ).rejects.toThrow(/phase execution lock.*new study root/i);

    releaseFirst();
    await expect(first).rejects.toThrow("fixture stopped after claiming the phase");
    expect(firstLaunches).toBe(1);
    expect(competingPreflights).toBe(0);
    expect(competingLaunches).toBe(0);
    const phase = await readPhaseSummary(studyRoot, "calibration");
    expect(phase.reservations).toHaveLength(1);
    expect(phase.failure?.kind).toBe("unresolved-reservation");
    await expect(access(join(studyRoot, "calibration", ".execution.lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 60_000);

  it("fails closed on an abandoned phase execution lock", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    const lockPath = join(studyRoot, "calibration", ".execution.lock");
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "", { flag: "wx" });
    let preflights = 0;

    await expect(
      executeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
        dependencies: {
          beforeLaunch: async () => {
            preflights += 1;
          },
          runCell: async () => {},
        },
      }),
    ).rejects.toThrow(/phase execution lock.*new study root/i);

    expect(preflights).toBe(0);
    await expect(access(lockPath)).resolves.toBeUndefined();
    await expect(readPhaseSummary(studyRoot, "calibration")).rejects.toThrow(
      /missing or unreadable/,
    );
  }, 60_000);

  it("revalidates indexed attempts before returning a completed phase", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    const phase = await executeStudyPhase({
      studyRoot,
      study,
      receipt,
      phase: "calibration",
      dependencies: {
        beforeLaunch: async () => {},
        runCell: async (launch) => {
          await publishLaunchAttempt(launch, study, false);
        },
      },
    });
    const firstAttempt = phase.attempts[0];
    if (firstAttempt === undefined) {
      throw new Error("Fixture phase did not publish a durable attempt.");
    }
    await rm(join(firstAttempt.attemptRoot, "attempt.json"), { force: true });

    await expect(
      executeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
        dependencies: {
          beforeLaunch: async () => {},
          runCell: async () => {},
        },
      }),
    ).rejects.toThrow(/missing its durable attempt\.json/);
  }, 60_000);

  it("requires canonical, structurally valid traces when reloading indexed attempts", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    const phase = await executeStudyPhase({
      studyRoot,
      study,
      receipt,
      phase: "calibration",
      dependencies: {
        beforeLaunch: async () => {},
        runCell: async (launch) => {
          await publishLaunchAttempt(launch, study, false);
        },
      },
    });
    const firstAttempt = phase.attempts[0];
    if (firstAttempt === undefined) {
      throw new Error("Fixture phase did not publish a durable attempt.");
    }
    const attemptPath = join(firstAttempt.attemptRoot, "attempt.json");
    const tracePath = join(firstAttempt.attemptRoot, "trace.jsonl");
    const traceMetadataPath = join(firstAttempt.attemptRoot, "trace.meta.json");
    const [attemptSource, traceSource, traceMetadataSource] = await Promise.all([
      readFile(attemptPath, "utf8"),
      readFile(tracePath, "utf8"),
      readFile(traceMetadataPath, "utf8"),
    ]);
    const reload = () =>
      initializeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
      });

    await rm(tracePath);
    await expect(reload()).rejects.toThrow(/trace is missing or invalid/i);
    await writeFile(tracePath, traceSource);

    await rm(traceMetadataPath);
    await expect(reload()).rejects.toThrow(/trace is missing or invalid/i);
    await writeFile(traceMetadataPath, traceMetadataSource);

    await writeFile(
      tracePath,
      `${JSON.stringify({ sequence: 2, atMs: 0, kind: "tampered", data: {} })}\n`,
    );
    await expect(reload()).rejects.toThrow(/sequence 2 instead of 1/i);
    await writeFile(tracePath, traceSource);

    const redirected = JSON.parse(attemptSource) as Record<string, unknown>;
    redirected.tracePath = join(studyRoot, "other-trace.jsonl");
    redirected.traceMetadataPath = join(studyRoot, "trace.meta.json");
    await writeFile(attemptPath, `${JSON.stringify(redirected)}\n`);
    await expect(reload()).rejects.toThrow(/canonical trace files/i);
    await writeFile(attemptPath, attemptSource);

    const trace = await JsonlObservationLog.open(tracePath);
    await trace.append("overlap.observed", { findings: [] });
    await expect(reload()).resolves.toMatchObject({ state: "complete" });
  }, 60_000);

  it("revalidates the complete protocol and frozen tree of indexed attempts", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    const phase = await executeStudyPhase({
      studyRoot,
      study,
      receipt,
      phase: "calibration",
      dependencies: {
        beforeLaunch: async () => {},
        runCell: async (launch) => {
          await publishLaunchAttempt(launch, study, false);
        },
      },
    });
    const firstAttempt = phase.attempts[0];
    if (firstAttempt === undefined) {
      throw new Error("Fixture phase did not publish a durable attempt.");
    }
    const attemptPath = join(firstAttempt.attemptRoot, "attempt.json");
    const original = await readFile(attemptPath, "utf8");
    const mutations = [
      (attempt: Record<string, unknown>) => {
        const sessions = attempt.sessions as Array<Record<string, unknown>>;
        const sessionModel = sessions[0]!.model as Record<string, unknown>;
        sessionModel.requestedModel = "tampered/model";
        const protocol = attempt.protocol as Record<string, unknown>;
        const models = protocol.models as Array<Record<string, unknown>>;
        const protocolModel = models[0]!.model as Record<string, unknown>;
        protocolModel.requestedModel = "tampered/model";
      },
      (attempt: Record<string, unknown>) => {
        const protocol = attempt.protocol as Record<string, unknown>;
        const prompts = protocol.prompts as Array<Record<string, unknown>>;
        prompts[0]!.prompt = "tampered prompt";
      },
      (attempt: Record<string, unknown>) => {
        const imageId = `sha256:${"e".repeat(64)}`;
        (attempt.sandbox as Record<string, unknown>).imageId = imageId;
        const protocol = attempt.protocol as Record<string, unknown>;
        (protocol.sandbox as Record<string, unknown>).imageId = imageId;
      },
    ];
    for (const mutate of mutations) {
      const attempt = JSON.parse(original) as Record<string, unknown>;
      mutate(attempt);
      attempt.protocolDigest = hashProtocolSnapshot(attempt.protocol);
      await writeFile(attemptPath, `${JSON.stringify(attempt, null, 2)}\n`);
      await expect(
        initializeStudyPhase({
          studyRoot,
          study,
          receipt,
          phase: "calibration",
        }),
      ).rejects.toThrow(/does not match the frozen study protocol/);
    }
    await writeFile(attemptPath, original);
    await writeFile(
      join(firstAttempt.attemptRoot, "frozen", "workspaces", "agent-1", "tampered.txt"),
      "tampered frozen workspace\n",
    );
    await expect(
      initializeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
      }),
    ).rejects.toThrow(/frozen tree has drifted/);
  }, 60_000);

  it("revalidates selected build bytes before reserving each launch", async () => {
    const { studyRoot, study, receipt } = await prepareFixture();
    let launches = 0;

    await expect(
      executeStudyPhase({
        studyRoot,
        study,
        receipt,
        phase: "calibration",
        dependencies: {
          beforeLaunch: async () => {},
          runCell: async (launch) => {
            launches += 1;
            await publishLaunchAttempt(launch, study, false);
            if (launches === 1) {
              const nextCell = study.calibrationCells[1]!;
              const binding = receipt.builds.find(
                (candidate) => candidate.blockId === nextCell.blockId,
              )!;
              const variant = binding.manifest.variants.rekey;
              await writeFile(
                join(binding.buildRoot, variant.publicCiphertextPath),
                "tampered between launches\n",
              );
            }
          },
        },
      }),
    ).rejects.toThrow(/Receipt-bound build .* has drifted before launch/);

    expect(launches).toBe(1);
    const phase = await readPhaseSummary(studyRoot, "calibration");
    expect(phase.reservations).toHaveLength(1);
    expect(phase.reservations[0]?.state).toBe("resolved");
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
    expect(launches).toBe(1);
    expect(phase.attempts).toHaveLength(1);
    expect(phase.reservations.filter(({ kind }) => kind === "replacement")).toHaveLength(0);
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
