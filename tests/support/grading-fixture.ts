import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { computeFixturePackageContentDigest } from "../../src/fixture/package.js";
import {
  createGitEnvironment,
  freezeGitEnvironment,
  listRemoteRefs,
  type GitCommunicationMode,
} from "../../src/git.js";
import type { AgentId, JsonValue, ModelBinding } from "../../src/model/contracts.js";
import {
  freezeRunConfiguration,
  publishRunRecord,
  type RunEvaluation,
  type RunRecord,
} from "../../src/run/record.js";
import { JsonlObservationLog } from "../../src/trace.js";

const FIXTURE_BYTES = "synthetic grading fixture\n";
const FILE_DIGEST = createHash("sha256").update(FIXTURE_BYTES).digest("hex");
const STARTED_AT = "2026-08-02T00:00:00.000Z";
const FROZEN_AT = "2026-08-02T00:01:00.000Z";
const PUBLISHED_AT = "2026-08-02T00:01:01.000Z";

export interface GradingFixtureObservation {
  readonly kind: string;
  readonly data: JsonValue;
  readonly agentId?: AgentId;
  readonly atMs?: number;
}

export interface CompletedGradingFixtureOptions {
  readonly root?: string;
  readonly configurationRoot?: string;
  readonly runId?: string;
  readonly communicationMode?: GitCommunicationMode;
  readonly agentIds?: readonly AgentId[];
  readonly observations?: readonly GradingFixtureObservation[];
  readonly evaluationStatus?: RunEvaluation["status"];
}

export interface GradingRunFixture {
  readonly root: string;
  readonly runRoot: string;
  readonly fixtureRoot: string;
  readonly tracePath: string;
  readonly metadataPath: string;
  readonly textPath: string;
  readonly record?: RunRecord;
}

function binding(): ModelBinding {
  return {
    profile: "synthetic-fixture",
    provider: "fixture",
    driver: "openai-compatible",
    requestedModel: "synthetic-review-neutral-model",
    settings: {},
    providerOptions: {},
  };
}

async function writeSyntheticFixturePackage(
  fixtureRoot: string,
  agentIds: readonly AgentId[],
): Promise<{ contentDigest: string; constructionId: string; buildId: string }> {
  const paths = new Set([
    "oracle/plaintext.txt",
    "oracle/allocation.json",
    "oracle/design.json",
    "oracle/manipulation-check.json",
    "oracle/keys/base.json",
    "complete/ciphertext.txt",
    ...agentIds.map((agentId) => `private/${agentId}/stages/stage-1.txt`),
  ]);
  await Promise.all(
    [...paths].map(async (path) => {
      const target = join(fixtureRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, FIXTURE_BYTES, "utf8");
    }),
  );
  const constructionId = `construction-${"c".repeat(64)}`;
  const buildId = `build-${"b".repeat(64)}`;
  const manifest = {
    schemaVersion: 2,
    fixtureId: "synthetic-grading-fixture",
    constructionId,
    contentDigest: "0".repeat(64),
    source: { sourceId: "synthetic", sha256: FILE_DIGEST },
    window: { sha256: FILE_DIGEST },
    agentIds,
    stageCount: 1,
    allocation: { path: "oracle/allocation.json", sha256: FILE_DIGEST },
    oracleDesign: { path: "oracle/design.json", sha256: FILE_DIGEST },
    baseKeyPath: "oracle/keys/base.json",
    manipulationCheck: { path: "oracle/manipulation-check.json", sha256: FILE_DIGEST },
    rekeyAtStage: null,
    buildId,
    publicCiphertextPath: "complete/ciphertext.txt",
    publicCiphertextSha256: FILE_DIGEST,
    stages: agentIds.map((agentId) => ({
      agentId,
      ordinal: 1,
      sourcePath: `private/${agentId}/stages/stage-1.txt`,
      sha256: FILE_DIGEST,
    })),
  };
  manifest.contentDigest = await computeFixturePackageContentDigest(fixtureRoot, manifest);
  await writeFile(join(fixtureRoot, "fixture.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  return { contentDigest: manifest.contentDigest, constructionId, buildId };
}

async function createTrace(
  runRoot: string,
  observations: readonly GradingFixtureObservation[],
): Promise<JsonlObservationLog> {
  let atMs = 0;
  const log = await JsonlObservationLog.create(join(runRoot, "trace.jsonl"), {
    startedAtMs: Date.parse(STARTED_AT),
    nowMs: () => atMs,
  });
  for (const observation of observations) {
    atMs = observation.atMs ?? atMs + 1;
    await log.append(observation.kind, observation.data, observation.agentId);
  }
  await log.flush();
  return log;
}

function defaultObservations(agentIds: readonly AgentId[]): GradingFixtureObservation[] {
  const first = agentIds[0];
  if (first === undefined) throw new Error("A grading fixture requires agents.");
  return [
    { kind: "stage.released", agentId: first, data: { ordinal: 1, activitySequence: 1 } },
    {
      kind: "model.response",
      agentId: first,
      data: { text: "I will test the repeated-token hypothesis against the released stage." },
    },
  ];
}

export async function createCompletedRunFixture(
  options: CompletedGradingFixtureOptions = {},
): Promise<GradingRunFixture & { readonly record: RunRecord }> {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), "palimpsest-grading-fixture-")));
  const configurationRoot = options.configurationRoot ?? root;
  const runId = options.runId ?? "synthetic-run";
  const communicationMode = options.communicationMode ?? "shared";
  const agentIds = options.agentIds ?? (["agent-1", "agent-2"] as const);
  if (agentIds.length < 2 || new Set(agentIds).size !== agentIds.length) {
    throw new Error("A completed grading fixture requires at least two unique agents.");
  }
  const runRoot = join(root, "artifacts", runId);
  const fixtureRoot = join(root, "fixtures", "synthetic-grading-fixture");
  await Promise.all([mkdir(runRoot, { recursive: true }), mkdir(fixtureRoot, { recursive: true })]);
  const fixture = await writeSyntheticFixturePackage(fixtureRoot, agentIds);
  const trace = await createTrace(runRoot, options.observations ?? defaultObservations(agentIds));
  const activeGit = await createGitEnvironment(
    join(root, ".active-git", runId),
    communicationMode,
    agentIds,
  );
  const frozen = await freezeGitEnvironment(activeGit, join(runRoot, "frozen"));
  const assignments = Object.fromEntries(
    agentIds.map((agentId) => [agentId, "synthetic-fixture"]),
  ) as Record<AgentId, string>;
  const model = binding();
  const configuration = freezeRunConfiguration({
    manifestPath: "experiments/synthetic-grading.yaml",
    manifestDigest: "a".repeat(64),
    run: {
      id: runId,
      fixture: {
        id: "synthetic-grading-fixture",
        constructionId: fixture.constructionId,
        buildId: fixture.buildId,
        packagePath: relative(configurationRoot, fixtureRoot),
        digest: fixture.contentDigest,
        variant: "stationary",
      },
      assignment: assignments,
      capabilities: {
        git: communicationMode,
        teamRoom: communicationMode === "shared" ? "enabled" : "disabled",
        checker: true,
      },
      schedule: { releaseOffsetsMs: [0], cutoffMs: 60_000 },
      limits: { tokenLimitPerAgent: 10_000, spendCeilingCents: 0 },
      labels: { fixture: "synthetic-grading" },
    },
    models: agentIds.map((agentId) => ({ agentId, binding: model })),
    validation: {
      manifestPath: "experiments/synthetic-grading.yaml",
      manifestDigest: "a".repeat(64),
      fixture: {
        packagePath: relative(configurationRoot, fixtureRoot),
        fixtureId: "synthetic-grading-fixture",
        contentDigest: fixture.contentDigest,
      },
      sandbox: {
        imageTag: "palimpsest-synthetic-fixture",
        imageId: `sha256:${"d".repeat(64)}`,
        sourceDigest: "e".repeat(64),
        profileVersion: 1,
      },
      smoke: {
        sourceRunId: runId,
        runId: `${runId}-validation`,
        fixtureId: "synthetic-grading-fixture",
        variantId: "stationary",
        fixtureDigest: fixture.contentDigest,
        agentIds,
        stageCount: 1,
      },
      validatedAt: STARTED_AT,
      spendAuthorized: true,
    },
  });
  const origins = await Promise.all(
    frozen.repositories.map(async (repository) => {
      const refs = await listRemoteRefs(repository.path);
      const mainCommit = refs["refs/heads/main"] ?? null;
      return {
        originId: repository.repositoryId,
        path: relative(runRoot, repository.path),
        agentIds: repository.agentIds,
        mainCommit,
      };
    }),
  );
  const evaluationStatus = options.evaluationStatus ?? "scored";
  const evaluationResults: RunEvaluation[] = origins.map((origin) => ({
    originId: origin.originId,
    agentIds: origin.agentIds,
    status: evaluationStatus,
    ...(origin.mainCommit === null ? {} : { commit: origin.mainCommit }),
    ...(evaluationStatus === "scored"
      ? {
          outputPath: `evaluations/${origin.originId}/reconstruction.txt`,
          score: { matchedWords: 6, totalWords: 10, coverage: 0.8, accuracy: 0.75 },
        }
      : evaluationStatus === "no-output"
        ? { error: "Synthetic solver produced no output." }
        : { error: "Synthetic solver was not runnable." }),
  }));
  const record: RunRecord = {
    schemaVersion: 1,
    manifestDigest: "a".repeat(64),
    runId,
    status: "completed",
    startedAt: STARTED_AT,
    frozenAt: FROZEN_AT,
    publishedAt: PUBLISHED_AT,
    configuration,
    trace: { path: "trace.jsonl", metadataPath: "trace.meta.json" },
    releases: agentIds.map((agentId) => ({
      agentId,
      ordinal: 1,
      variantId: "stationary",
      releasedAt: STARTED_AT,
      visiblePath: `evidence/${agentId}/stage-01.txt`,
      sha256: FILE_DIGEST,
    })),
    sessions: agentIds.map((agentId) => ({
      agentId,
      model,
      state: "finished",
      inputTokens: 100,
      outputTokens: 50,
      activityCursor: 1,
      terminationReason: "final-response",
    })),
    topology: {
      root: relative(runRoot, frozen.root),
      communicationMode,
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
        evaluationId: "automatic-synthetic",
        kind: "automatic",
        evaluatedAt: FROZEN_AT,
        results: evaluationResults,
      },
    ],
    analyses: [],
    sessionInfrastructureFailures: [],
  };
  await publishRunRecord(runRoot, record);
  return {
    root,
    runRoot,
    fixtureRoot,
    tracePath: trace.path,
    metadataPath: trace.metadataPath,
    textPath: trace.textPath,
    record,
  };
}

export async function createInterruptedRunFixture(
  options: Omit<CompletedGradingFixtureOptions, "evaluationStatus"> = {},
): Promise<GradingRunFixture> {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), "palimpsest-interrupted-fixture-")));
  const runRoot = join(root, "artifacts", options.runId ?? "interrupted-run");
  await mkdir(runRoot, { recursive: true });
  const agentIds = options.agentIds ?? (["agent-1", "agent-2"] as const);
  const trace = await createTrace(runRoot, options.observations ?? defaultObservations(agentIds));
  return {
    root,
    runRoot,
    fixtureRoot: join(root, "fixtures", "synthetic-grading-fixture"),
    tracePath: trace.path,
    metadataPath: trace.metadataPath,
    textPath: trace.textPath,
  };
}

export function createSharedRunFixture(
  options: Omit<CompletedGradingFixtureOptions, "communicationMode"> = {},
): Promise<GradingRunFixture & { readonly record: RunRecord }> {
  return createCompletedRunFixture({ ...options, communicationMode: "shared" });
}

export function createIsolatedRunFixture(
  options: Omit<CompletedGradingFixtureOptions, "communicationMode"> = {},
): Promise<GradingRunFixture & { readonly record: RunRecord }> {
  return createCompletedRunFixture({ ...options, communicationMode: "isolated" });
}
