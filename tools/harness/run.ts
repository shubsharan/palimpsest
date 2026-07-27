import { execFile } from "node:child_process";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  VisibilityJournal,
  buildLogicalTransaction,
  encodeGitAccountingFrame,
  gitAccountingCharge,
  refOperations,
} from "@palimpsest/git-accounting";
import {
  createFreeze,
  publishSnapshot,
  type LedgerEntry,
  type RefMap,
} from "@palimpsest/git-gateway";
import {
  AbsoluteSchedule,
  CommonBarrierCoordinator,
  EventChain,
  SystemMonotonicClock,
  releaseAgentShard,
  runBridgeProcess,
  sealPrivateSubmission,
  type AgentInvocationRequest,
  type HarnessSchedule,
  type MonotonicClock,
} from "@palimpsest/run-control";
import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import { createAttempt, sealCurrentAttemptFailure } from "./artifacts.js";
import { startContainerRuntime } from "./container-runtime.js";
import {
  AGENT_IDS,
  FIXTURE_ADAPTER_ID,
  HARNESS_ROOT,
  RETAINED_COMMUNICATION_BUDGET_BYTES,
  type HarnessAttemptIdentity,
} from "./config.js";
import {
  attemptPublicationPaths,
  type GatewayPublicationEvidence,
  type PublicationSlot,
} from "./publication-slots.js";
import { checkPredeclaration } from "./report.js";

const execFileAsync = promisify(execFile);
const OFFLINE_SCHEDULE = {
  revealOffsetsMs: [0, 3_000],
  publicationOffsetsMs: [2_500, 8_500],
  pushCloseOffsetMs: 6_500,
  freezeOffsetMs: 10_000,
  finalizationOffsetMs: 12_000,
  toleranceMs: 2_000,
  stabilizationIntervalMs: 1_000,
} as const satisfies HarnessSchedule;

async function git(repository: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

async function refMap(repository: string): Promise<RefMap> {
  const output = await git(repository, [
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    "refs/heads",
  ]);
  return Object.fromEntries(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, oid] = line.split(" ");
        return [name!, oid!];
      }),
  );
}

async function buildAdmissionCandidates(options: {
  repository: string;
  refs: RefMap;
  priorRefs?: RefMap;
  publicationSlot: number;
  slotStartJournal: VisibilityJournal;
}) {
  return Promise.all(
    AGENT_IDS.map(async (agentId, index) => {
      const refName = `refs/heads/agents/${agentId}/work`;
      const newOid = options.refs[refName];
      const oldOid = options.priorRefs?.[refName];
      if (!newOid) {
        throw new Error(`Authoritative Git ref is missing for ${agentId}.`);
      }
      const frame = await buildLogicalTransaction({
        authenticatedAgent: index + 1,
        newOid,
        ...(oldOid ? { oldOid } : {}),
        operation: oldOid ? refOperations.update : refOperations.create,
        publicationSlot: options.publicationSlot,
        refName,
        repository: options.repository,
        slotStartJournal: options.slotStartJournal,
      });
      return { agentId, frame };
    }),
  );
}

async function appendVerifiedAdmissions(options: {
  candidates: Awaited<ReturnType<typeof buildAdmissionCandidates>>;
  ledgers: LedgerEntry[];
  events: EventChain;
  clock: MonotonicClock;
}): Promise<void> {
  for (const { agentId, frame } of options.candidates) {
    const frameDigest = sha256Hex(encodeGitAccountingFrame(frame));
    const chargeBytes = gitAccountingCharge(frame);
    const transactionId = `${agentId}-push-${frameDigest}`;
    const entry = options.ledgers.find(
      (candidate) => candidate.agentId === agentId && candidate.transactionId === transactionId,
    );
    if (
      !entry ||
      entry.frameDigest !== frameDigest ||
      entry.chargeBytes !== chargeBytes ||
      entry.result !== "accepted"
    ) {
      throw new Error(`Git Gateway ledger does not match the exact admitted frame for ${agentId}.`);
    }
    await options.events.append({
      producer: "git-gateway",
      effectId: `admission-${transactionId}`,
      eventType: "git.admission",
      monotonicElapsedNs: monotonicElapsedNs(options.clock),
      payload: {
        agentId,
        transactionId,
        frameDigest,
        chargeBytes,
        result: entry.result,
      },
    });
  }
}

function verifyGatewayPublication(options: {
  bytes: Buffer;
  slot: PublicationSlot;
  snapshot: ReturnType<typeof publishSnapshot>;
  refs: RefMap;
}): GatewayPublicationEvidence {
  const evidence = JSON.parse(options.bytes.toString("utf8")) as GatewayPublicationEvidence;
  if (
    evidence.schemaVersion !== 1 ||
    evidence.slot !== options.slot ||
    !canonicalJsonBytes(evidence.snapshot).equals(canonicalJsonBytes(options.snapshot)) ||
    !canonicalJsonBytes(evidence.refs).equals(canonicalJsonBytes(options.refs)) ||
    !Number.isSafeInteger(evidence.allowedOidCount) ||
    evidence.allowedOidCount < 1 ||
    !/^[0-9a-f]{64}$/.test(evidence.allowedOidsDigest) ||
    evidence.maxFetchesPerAgent !== 2
  ) {
    throw new Error(`Materialized ${options.slot} Git snapshot is not authoritative.`);
  }
  return evidence;
}

async function initializeRepository(attempt: string, bundleRoot: string): Promise<string> {
  const genesis = join(attempt, "git", "genesis");
  const bare = join(attempt, "git", "repository.git");
  await mkdir(genesis, { recursive: true });
  await execFileAsync("git", ["init", "--quiet", "--object-format=sha256", genesis]);
  await git(genesis, ["config", "user.name", "Palimpsest Harness"]);
  await git(genesis, ["config", "user.email", "harness@palimpsest.invalid"]);
  await cp(join(bundleRoot, "public"), join(genesis, "public"), { recursive: true });
  await cp(join(bundleRoot, "reference"), join(genesis, "reference"), { recursive: true });
  await git(genesis, ["add", "public", "reference"]);
  await git(genesis, ["commit", "--quiet", "-m", "Palimpsest genesis"]);
  await git(genesis, ["branch", "-M", "main"]);
  await execFileAsync("git", ["clone", "--quiet", "--bare", genesis, bare]);
  return bare;
}

async function appendState(
  coordinator: CommonBarrierCoordinator,
  events: EventChain,
  clock: MonotonicClock,
  next: Parameters<CommonBarrierCoordinator["advance"]>[0],
): Promise<void> {
  coordinator.advance(next);
  await events.append({
    producer: "run-control",
    effectId: `lifecycle-${next.toLowerCase()}`,
    eventType: "lifecycle.transition",
    monotonicElapsedNs: monotonicElapsedNs(clock),
    payload: { state: next },
  });
}

function monotonicElapsedNs(clock: MonotonicClock): string {
  return String(Math.floor(clock.nowMs() * 1_000_000));
}

async function waitForFiles(paths: readonly string[], timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const ready = await Promise.all(
      paths.map((path) =>
        access(path).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        ),
      ),
    );
    if (ready.every(Boolean)) return;
    if (performance.now() >= deadline) {
      throw new Error(`Fixture workers did not reach the launch barrier within ${timeoutMs} ms.`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
}

async function waitForWorkerMarkers(
  paths: readonly string[],
  timeoutMs: number,
  workers: Promise<unknown>,
): Promise<void> {
  await Promise.race([
    waitForFiles(paths, timeoutMs),
    workers.then(() => {
      throw new Error("Fixture workers exited before writing all expected coordination markers.");
    }),
  ]);
}

function runIdFromArgs(): string {
  const index = process.argv.indexOf("--run-id");
  if (index >= 0) {
    const value = process.argv[index + 1];
    if (!value) throw new Error("--run-id requires a value.");
    return value;
  }
  return `offline-${Date.now().toString(36)}`;
}

async function executeOfflineHarness(options: {
  root?: string;
  runId: string;
}): Promise<HarnessAttemptIdentity> {
  const root = resolve(options.root ?? ".");
  const predeclaration = await checkPredeclaration(root);
  const declarationDigest = String(predeclaration.declarationDigest);
  const identity = { declarationDigest, runId: options.runId };
  const attempt = await createAttempt({
    root: resolve(root, HARNESS_ROOT),
    identity,
    startedAt: new Date().toISOString(),
  });
  process.stdout.write(`Offline attempt: ${attempt}\n`);
  const events = new EventChain(options.runId, join(attempt, "live.jsonl"));
  const clock = new SystemMonotonicClock();
  const coordinator = new CommonBarrierCoordinator(AGENT_IDS, clock);
  const bundleRoot = resolve(root, HARNESS_ROOT, "declared");

  const bundleManifestBytes = await readFile(join(bundleRoot, "bundle-manifest.json"));
  const runManifest = {
    schemaVersion: 1,
    contractId: "run-manifest",
    runId: options.runId,
    declarationDigest,
    instance: {
      artifactType: "instance-bundle",
      byteLength: bundleManifestBytes.byteLength,
      sha256: sha256Hex(bundleManifestBytes),
    },
    adapterId: FIXTURE_ADAPTER_ID,
    agentIds: [...AGENT_IDS],
    accountingVersion: "GitAccountingFrameV1",
    communicationBudgetBytes: RETAINED_COMMUNICATION_BUDGET_BYTES,
  };
  await writeFile(join(attempt, "run-manifest.json"), canonicalJsonBytes(runManifest));
  await appendState(coordinator, events, clock, "STARTING");
  const repository = await initializeRepository(attempt, bundleRoot);
  await git(repository, ["config", "http.receivepack", "true"]);
  const containerRuntime = await startContainerRuntime({
    identity,
    repository,
  });
  try {
    const agentDomains = await Promise.all(
      AGENT_IDS.map(async (agentId) => {
        const agentRoot = join(attempt, "agents", agentId);
        const inputRoot = join(agentRoot, "input");
        const outputRoot = join(agentRoot, "private-output");
        const workspaceRoot = join(agentRoot, "workspace");
        await Promise.all(
          [inputRoot, outputRoot, workspaceRoot].map((path) => mkdir(path, { recursive: true })),
        );
        await cp(join(bundleRoot, "public"), join(inputRoot, "public"), { recursive: true });
        await cp(join(bundleRoot, "reference"), join(inputRoot, "reference"), {
          recursive: true,
        });
        return { agentId, agentRoot, inputRoot, outputRoot, workspaceRoot };
      }),
    );
    const invocations = await Promise.all(
      agentDomains.map(async ({ agentId, agentRoot, inputRoot, outputRoot, workspaceRoot }) => {
        const releasedInputManifestPath = join(inputRoot, "released", "release-manifest.json");
        const invocation: AgentInvocationRequest = {
          schemaVersion: 1,
          runId: options.runId,
          agentId,
          invocationId: `${agentId}-fixture-001`,
          adapterId: FIXTURE_ADAPTER_ID,
          lifecycleState: "RUNNING",
          monotonicDeadlineMs: 60_000,
          releasedInputManifestPath,
          publishedSnapshotId: "publication-000",
          gitEndpoint: containerRuntime.endpoint(agentId),
          gitRefNamespace: `refs/heads/quarantine/${agentId}`,
          workspacePath: workspaceRoot,
          privateOutputPath: outputRoot,
        };
        const requestPath = join(agentRoot, "invocation.json");
        await writeFile(requestPath, canonicalJsonBytes(invocation));
        const containerRequestPath = join(agentRoot, "container-invocation.json");
        await writeFile(
          containerRequestPath,
          canonicalJsonBytes({
            ...invocation,
            releasedInputManifestPath: "/input/released/release-manifest.json",
            workspacePath: "/workspace",
            privateOutputPath: "/output",
          }),
        );
        return {
          agentId,
          invocation,
          containerRequestPath,
          inputRoot,
          outputRoot,
          readyPath: join(workspaceRoot, ".launch-ready"),
          containerIdPath: join(agentRoot, "container.id"),
          releasePath: join(inputRoot, ".launch-release"),
          initialPushCompletePath: join(workspaceRoot, ".initial-push-complete"),
          collaborationPath: join(inputRoot, ".collaboration-release"),
          finalPushCompletePath: join(workspaceRoot, ".final-push-complete"),
          finalizationPath: join(inputRoot, ".finalization-release"),
        };
      }),
    );

    let schedule: AbsoluteSchedule | null = null;
    let launchEpochMs: number | null = null;
    const workerPromise = Promise.all(
      invocations.map(
        async ({
          agentId,
          invocation,
          containerRequestPath,
          inputRoot,
          outputRoot,
          containerIdPath,
        }) => {
          const result = await runBridgeProcess({
            command: "docker",
            args: [
              "run",
              "--rm",
              "--cidfile",
              containerIdPath,
              "--network",
              containerRuntime.agentNetwork(agentId),
              "--read-only",
              "--cap-drop",
              "ALL",
              "--security-opt",
              "no-new-privileges",
              "--pids-limit",
              "128",
              "--memory",
              "512m",
              "--cpus",
              "1",
              "--env-file",
              containerRuntime.credentialEnvFile(agentId),
              "--tmpfs",
              "/tmp:rw,noexec,nosuid,size=32m",
              "--volume",
              `${containerRequestPath}:/request/invocation.json:ro`,
              "--volume",
              `${inputRoot}:/input:ro`,
              "--volume",
              `${invocation.workspacePath}:/workspace:rw`,
              "--volume",
              `${outputRoot}:/output:rw`,
              "--env",
              "PALIMPSEST_FIXTURE_READY_PATH=/workspace/.launch-ready",
              "--env",
              "PALIMPSEST_FIXTURE_RELEASE_PATH=/input/.launch-release",
              "--env",
              "PALIMPSEST_FIXTURE_BARRIER_TIMEOUT_MS=30000",
              "--env",
              "PALIMPSEST_FIXTURE_INITIAL_PUSH_COMPLETE_PATH=/workspace/.initial-push-complete",
              "--env",
              "PALIMPSEST_FIXTURE_COLLABORATION_PATH=/input/.collaboration-release",
              "--env",
              "PALIMPSEST_FIXTURE_FINAL_PUSH_COMPLETE_PATH=/workspace/.final-push-complete",
              "--env",
              "PALIMPSEST_FIXTURE_FINALIZATION_PATH=/input/.finalization-release",
              containerRuntime.fixtureImageId,
              "/request/invocation.json",
            ],
            adapterId: FIXTURE_ADAPTER_ID,
            runId: options.runId,
            agentId,
            invocationId: invocation.invocationId,
            timeoutMs: 60_000,
          });
          await writeFile(
            join(attempt, "agents", agentId, "events.json"),
            canonicalJsonBytes(result.events),
          );
          return { agentId, result };
        },
      ),
    );
    void workerPromise.catch(() => undefined);
    await waitForWorkerMarkers(
      invocations.map(({ readyPath }) => readyPath),
      30_000,
      workerPromise,
    );
    const agentContainers = Object.fromEntries(
      await Promise.all(
        invocations.map(async ({ agentId, containerIdPath }) => {
          const containerId = (await readFile(containerIdPath, "utf8")).trim();
          if (!/^[0-9a-f]{64}$/.test(containerId)) {
            throw new Error(`Fixture worker container ID is invalid: ${agentId}.`);
          }
          return [agentId, containerId];
        }),
      ),
    ) as Record<(typeof AGENT_IDS)[number], string>;
    const agentNetworkIsolation = await containerRuntime.inspectAgentIsolation(agentContainers);
    await Promise.all(
      invocations.map(async ({ agentId, readyPath }) => {
        if ((await readFile(readyPath, "utf8")) !== "ready\n") {
          throw new Error(`Fixture worker readiness marker is invalid: ${agentId}.`);
        }
        await events.append({
          producer: "model-bridge",
          effectId: `worker-${agentId}-ready`,
          eventType: "worker.ready",
          monotonicElapsedNs: monotonicElapsedNs(clock),
          payload: { agentId },
        });
      }),
    );
    await Promise.all(agentDomains.map(({ agentId }) => coordinator.arriveAtLaunch(agentId)));
    await appendState(coordinator, events, clock, "RUNNING");
    launchEpochMs = coordinator.launchEpochMs;
    if (launchEpochMs === null) {
      throw new Error("Common launch barrier did not establish a monotonic epoch.");
    }
    schedule = new AbsoluteSchedule(clock, OFFLINE_SCHEDULE, launchEpochMs);
    const firstReveal = await schedule.waitFor({ kind: "reveal", ordinal: 1 });
    await Promise.all(
      agentDomains.map(async ({ agentId, inputRoot }) => {
        await releaseAgentShard({
          bundleRoot,
          agentId,
          destination: inputRoot,
          ordinal: 1,
        });
        await events.append({
          producer: "reveal-control",
          effectId: `reveal-${agentId}-1`,
          eventType: "reveal.release",
          monotonicElapsedNs: monotonicElapsedNs(clock),
          payload: { agentId, ordinal: 1, ...firstReveal },
        });
      }),
    );
    await Promise.all(
      invocations.map(({ releasePath }) => writeFile(releasePath, "release\n", { flag: "wx" })),
    );
    await waitForWorkerMarkers(
      invocations.map(({ initialPushCompletePath }) => initialPushCompletePath),
      30_000,
      workerPromise,
    );
    const mainOids = (await git(repository, ["rev-list", "--objects", "--no-object-names", "main"]))
      .split("\n")
      .filter(Boolean);
    const initialJournal = new VisibilityJournal(mainOids);
    const collaborationRefs = await refMap(repository);
    const collaborationCandidates = await buildAdmissionCandidates({
      repository,
      refs: collaborationRefs,
      publicationSlot: 1,
      slotStartJournal: initialJournal,
    });
    const collaborationLedgers = JSON.parse(
      await readFile(join(repository, "gateway-ledgers.json"), "utf8"),
    ) as LedgerEntry[];
    if (
      collaborationLedgers.length !== AGENT_IDS.length ||
      collaborationLedgers.some((entry) => entry.result !== "accepted") ||
      !AGENT_IDS.every(
        (agentId) => collaborationLedgers.filter((entry) => entry.agentId === agentId).length === 1,
      )
    ) {
      throw new Error("Collaboration slot requires one accepted Git admission per agent.");
    }
    await appendVerifiedAdmissions({
      candidates: collaborationCandidates,
      ledgers: collaborationLedgers,
      events,
      clock,
    });
    const collaborationJournal = initialJournal.withAcceptedObjects(
      collaborationCandidates.map((candidate) => candidate.frame.objects),
    );
    const collaborationObservation = await schedule.waitFor({
      kind: "publication",
      ordinal: 1,
    });
    const collaborationEventSequence = events.events.length;
    const collaborationGatewayBytes = await containerRuntime.publishSnapshot({
      slot: "collaboration",
      eventSequence: collaborationEventSequence,
    });
    const collaborationSnapshot = publishSnapshot({
      runId: options.runId,
      ordinal: 1,
      refs: collaborationRefs,
      predecessorSnapshotId: null,
      visibilityJournalDigest: collaborationJournal.digest(),
      eventSequence: collaborationEventSequence,
    });
    verifyGatewayPublication({
      bytes: collaborationGatewayBytes,
      slot: "collaboration",
      snapshot: collaborationSnapshot,
      refs: collaborationRefs,
    });
    const collaborationPaths = attemptPublicationPaths(attempt, "collaboration");
    await writeFile(collaborationPaths.fetchPublication, collaborationGatewayBytes, {
      flag: "wx",
    });
    await writeFile(collaborationPaths.publication, canonicalJsonBytes(collaborationSnapshot), {
      flag: "wx",
    });
    await events.append({
      producer: "git-gateway",
      effectId: "publication-001",
      eventType: "git.publication",
      monotonicElapsedNs: monotonicElapsedNs(clock),
      payload: {
        snapshotId: collaborationSnapshot.snapshotId,
        refMapDigest: collaborationSnapshot.refMapDigest,
        ...collaborationObservation,
      },
    });
    await Promise.all(
      invocations.map(({ collaborationPath }) =>
        writeFile(collaborationPath, "collaborate\n", { flag: "wx" }),
      ),
    );

    const secondReveal = await schedule.waitFor({ kind: "reveal", ordinal: 2 });
    await Promise.all(
      agentDomains.map(async ({ agentId, inputRoot }) => {
        await releaseAgentShard({
          bundleRoot,
          agentId,
          destination: inputRoot,
          ordinal: 2,
        });
        await events.append({
          producer: "reveal-control",
          effectId: `reveal-${agentId}-2`,
          eventType: "reveal.release",
          monotonicElapsedNs: monotonicElapsedNs(clock),
          payload: { agentId, ordinal: 2, ...secondReveal },
        });
      }),
    );
    await waitForWorkerMarkers(
      invocations.map(({ finalPushCompletePath }) => finalPushCompletePath),
      30_000,
      workerPromise,
    );
    await schedule.waitFor({ kind: "push-close" });
    await containerRuntime.closeAdmission();
    await appendState(coordinator, events, clock, "PUSH_CLOSED");
    await appendState(coordinator, events, clock, "DRAINING");
    const drainEvidenceBytes = await readFile(join(repository, "gateway-drained.json"));
    const drainEvidence = JSON.parse(drainEvidenceBytes.toString("utf8")) as {
      runId: string;
      pendingReceives: number;
      pendingReservations: number;
      ledgerEntryCount: number;
    };
    if (
      drainEvidence.runId !== options.runId ||
      drainEvidence.pendingReceives !== 0 ||
      drainEvidence.pendingReservations !== 0 ||
      drainEvidence.ledgerEntryCount !== AGENT_IDS.length * 2
    ) {
      throw new Error("Git Gateway drain evidence does not prove a complete closed admission set.");
    }
    await writeFile(join(attempt, "git", "drain.json"), drainEvidenceBytes);
    if (!schedule || launchEpochMs === null) {
      throw new Error("Offline run ended before the common launch schedule was established.");
    }

    const refs = await refMap(repository);
    const finalCandidates = await buildAdmissionCandidates({
      repository,
      refs,
      priorRefs: collaborationRefs,
      publicationSlot: 2,
      slotStartJournal: collaborationJournal,
    });
    const ledgers = JSON.parse(
      await readFile(join(repository, "gateway-ledgers.json"), "utf8"),
    ) as LedgerEntry[];
    if (
      ledgers.length !== AGENT_IDS.length * 2 ||
      ledgers.some((entry) => entry.result !== "accepted") ||
      !AGENT_IDS.every(
        (agentId) => ledgers.filter((entry) => entry.agentId === agentId).length === 2,
      )
    ) {
      throw new Error("Offline run requires two accepted Git admissions per agent.");
    }
    await appendVerifiedAdmissions({
      candidates: finalCandidates,
      ledgers,
      events,
      clock,
    });
    const journal = collaborationJournal.withAcceptedObjects(
      finalCandidates.map((candidate) => candidate.frame.objects),
    );
    await writeFile(join(attempt, "git", "ledgers.json"), canonicalJsonBytes(ledgers));
    const gatewayPolicy = JSON.parse(
      await readFile(join(repository, "gateway-policy.json"), "utf8"),
    ) as {
      schemaVersion: number;
      perAgentPrivateObjectDatabases: boolean;
      inspectedRepositories: Record<
        string,
        {
          gitDirectory: string;
          objectDirectory: string;
          alternates: string[];
          receiveHiddenRefs: string[];
          uploadHiddenRefs: string[];
          quarantineRefCount: number;
        }
      >;
    };
    const repositoryEvidence = Object.values(gatewayPolicy.inspectedRepositories);
    const receiveHiddenRefs = [
      ...new Set(repositoryEvidence.flatMap((entry) => entry.receiveHiddenRefs)),
    ].sort();
    const uploadHiddenRefs = [
      ...new Set(repositoryEvidence.flatMap((entry) => entry.uploadHiddenRefs)),
    ].sort();
    const stagingRefCount = repositoryEvidence.reduce(
      (total, entry) => total + entry.quarantineRefCount,
      0,
    );
    if (
      gatewayPolicy.schemaVersion !== 2 ||
      !gatewayPolicy.perAgentPrivateObjectDatabases ||
      repositoryEvidence.length !== AGENT_IDS.length ||
      new Set(repositoryEvidence.map((entry) => entry.gitDirectory)).size !== AGENT_IDS.length ||
      new Set(repositoryEvidence.map((entry) => entry.objectDirectory)).size !== AGENT_IDS.length ||
      repositoryEvidence.some((entry) => entry.alternates.length !== 0) ||
      repositoryEvidence.some(
        (entry) =>
          !canonicalJsonBytes(entry.receiveHiddenRefs).equals(
            canonicalJsonBytes(["refs/heads/agents", "refs/heads/quarantine"]),
          ),
      ) ||
      repositoryEvidence.some(
        (entry) =>
          !canonicalJsonBytes(entry.uploadHiddenRefs).equals(
            canonicalJsonBytes(["refs/heads/agents", "refs/heads/quarantine"]),
          ),
      ) ||
      !canonicalJsonBytes(receiveHiddenRefs).equals(
        canonicalJsonBytes(["refs/heads/agents", "refs/heads/quarantine"]),
      ) ||
      !canonicalJsonBytes(uploadHiddenRefs).equals(
        canonicalJsonBytes(["refs/heads/agents", "refs/heads/quarantine"]),
      ) ||
      stagingRefCount !== 0
    ) {
      throw new Error("Git Gateway did not preserve hidden, empty quarantine state at drain.");
    }
    const publicationObservation = await schedule.waitFor({ kind: "publication", ordinal: 2 });
    const finalEventSequence = events.events.length;
    const gatewayPublicationBytes = await containerRuntime.publishSnapshot({
      slot: "final",
      eventSequence: finalEventSequence,
    });
    const snapshot = publishSnapshot({
      runId: options.runId,
      ordinal: 2,
      refs,
      predecessorSnapshotId: collaborationSnapshot.snapshotId,
      visibilityJournalDigest: journal.digest(),
      eventSequence: finalEventSequence,
    });
    verifyGatewayPublication({
      bytes: gatewayPublicationBytes,
      slot: "final",
      snapshot,
      refs,
    });
    const finalPaths = attemptPublicationPaths(attempt, "final");
    await writeFile(finalPaths.fetchPublication, gatewayPublicationBytes, { flag: "wx" });
    await writeFile(finalPaths.publication, canonicalJsonBytes(snapshot), { flag: "wx" });
    await events.append({
      producer: "git-gateway",
      effectId: "publication-002",
      eventType: "git.publication",
      monotonicElapsedNs: monotonicElapsedNs(clock),
      payload: {
        snapshotId: snapshot.snapshotId,
        refMapDigest: snapshot.refMapDigest,
        ...publicationObservation,
      },
    });

    await schedule.waitFor({ kind: "freeze" });
    const finalReleasedShards = await Promise.all(
      agentDomains.map(async ({ agentId, inputRoot }) => {
        const bytes = await readFile(join(inputRoot, "released", "release-manifest.json"));
        return {
          agentId,
          manifest: {
            artifactType: "released-shard-manifest",
            byteLength: bytes.byteLength,
            sha256: sha256Hex(bytes),
          },
        };
      }),
    );
    const eventChainHead = events.head;
    if (!eventChainHead) throw new Error("Cannot freeze an empty event chain.");
    const freeze = await createFreeze({
      repository,
      bundlePath: join(attempt, "git", "frozen.bundle"),
      runId: options.runId,
      refs,
      visibilityJournalDigest: journal.digest(),
      ledgers,
      finalEventSequence: events.events.length,
      eventChainHead,
      finalReleasedShards,
    });
    await writeFile(join(attempt, "git", "freeze.json"), canonicalJsonBytes(freeze));
    await appendState(coordinator, events, clock, "FROZEN");
    await schedule.waitFor({ kind: "finalization" });
    await appendState(coordinator, events, clock, "FINALIZING");
    await Promise.all(
      invocations.map(({ finalizationPath }) =>
        writeFile(finalizationPath, "finalize\n", { flag: "wx" }),
      ),
    );
    const workerResults = await workerPromise;
    const gatewayFetchBytes = await readFile(join(repository, "gateway-fetches.json"));
    const gatewayFetches = JSON.parse(gatewayFetchBytes.toString("utf8")) as {
      runId: string;
      maxFetchesPerAgent: number;
      admittedFetchCounts: Record<string, number>;
      fetches: Array<{
        agentId: string;
        sequence: number;
        tuple: {
          snapshotId: string;
          wants: string[];
          haves: string[];
          capabilityProfile: string[];
          digest: string;
        };
      }>;
    };
    const fetchSnapshots = new Map([
      [
        collaborationSnapshot.snapshotId,
        { refs: collaborationRefs, journal: collaborationJournal },
      ],
      [snapshot.snapshotId, { refs, journal }],
    ]);
    if (
      gatewayFetches.runId !== options.runId ||
      gatewayFetches.maxFetchesPerAgent !== 2 ||
      gatewayFetches.fetches.length !== AGENT_IDS.length * 2 ||
      !AGENT_IDS.every((agentId) => gatewayFetches.admittedFetchCounts[agentId] === 2) ||
      new Set(gatewayFetches.fetches.map((fetch) => fetch.agentId)).size !== AGENT_IDS.length ||
      gatewayFetches.fetches.some((fetch, index) => {
        const { digest, ...tupleBody } = fetch.tuple;
        const captured = fetchSnapshots.get(fetch.tuple.snapshotId);
        return (
          !AGENT_IDS.includes(fetch.agentId as (typeof AGENT_IDS)[number]) ||
          fetch.sequence !== index + 1 ||
          !captured ||
          fetch.tuple.wants.length < 1 ||
          fetch.tuple.wants.some((oid) => !Object.values(captured.refs).includes(oid)) ||
          fetch.tuple.haves.some((oid) => !captured.journal.has(oid)) ||
          digest !== sha256Hex(canonicalJsonBytes(tupleBody))
        );
      }) ||
      !AGENT_IDS.every((agentId) => {
        const snapshots = gatewayFetches.fetches
          .filter((fetch) => fetch.agentId === agentId)
          .sort((left, right) => left.sequence - right.sequence)
          .map((fetch) => fetch.tuple.snapshotId);
        return canonicalJsonBytes(snapshots).equals(
          canonicalJsonBytes([collaborationSnapshot.snapshotId, snapshot.snapshotId]),
        );
      })
    ) {
      throw new Error("Git Gateway did not record canonical collaboration and final fetches.");
    }
    await writeFile(join(attempt, "git", "fetches.json"), gatewayFetchBytes);
    for (const { agentId, result } of workerResults) {
      const finalFetchEvents = result.events.filter(
        (event) => event.type === "git.fetch" && event.payload.snapshot === "frozen",
      );
      if (
        finalFetchEvents.length !== 1 ||
        finalFetchEvents[0]?.payload.snapshot !== "frozen" ||
        finalFetchEvents[0]?.payload.refNamespace !== "refs/heads/agents"
      ) {
        throw new Error(`Fixture worker did not complete the required final pull: ${agentId}.`);
      }
      const gatewayFetch = gatewayFetches.fetches.find(
        (fetch) => fetch.agentId === agentId && fetch.tuple.snapshotId === snapshot.snapshotId,
      );
      if (!gatewayFetch) {
        throw new Error(`Git Gateway did not bind the final fetch for ${agentId}.`);
      }
      await events.append({
        producer: "model-bridge",
        effectId: `worker-${agentId}-final-fetch`,
        eventType: "worker.final-fetch",
        monotonicElapsedNs: monotonicElapsedNs(clock),
        payload: {
          agentId,
          invocationId: result.events[0]?.invocationId,
          ordinal: finalFetchEvents[0].ordinal,
          snapshotId: gatewayFetch.tuple.snapshotId,
          tupleDigest: gatewayFetch.tuple.digest,
        },
      });
      await events.append({
        producer: "model-bridge",
        effectId: `worker-${agentId}-completed`,
        eventType: "worker.completed",
        monotonicElapsedNs: monotonicElapsedNs(clock),
        payload: { agentId, eventCount: result.events.length, exitCode: result.exitCode },
      });
    }
    const submissions = [];
    for (const invocation of invocations) {
      const releasedShardDigest = finalReleasedShards.find(
        (binding) => binding.agentId === invocation.agentId,
      )?.manifest.sha256;
      if (!releasedShardDigest) {
        throw new Error(`Missing final released-shard binding for ${invocation.agentId}.`);
      }
      submissions.push(
        await sealPrivateSubmission({
          root: invocation.outputRoot,
          agentId: invocation.agentId,
          runId: options.runId,
          freezeId: String(freeze.freezeId),
          releasedShardDigest,
        }),
      );
    }
    await writeFile(join(attempt, "submissions.json"), canonicalJsonBytes(submissions));
    for (const submission of submissions) {
      await events.append({
        producer: "submission-service",
        effectId: `submission-${String(submission.agentId)}`,
        eventType: "submission.sealed",
        monotonicElapsedNs: monotonicElapsedNs(clock),
        payload: {
          agentId: submission.agentId,
          freezeId: submission.freezeId,
          releasedShardDigest: submission.releasedShardDigest,
          manifestDigest: sha256Hex(canonicalJsonBytes(submission)),
        },
      });
    }
    await appendState(coordinator, events, clock, "SUBMITTED");
    await writeFile(
      join(attempt, "run-result.json"),
      canonicalJsonBytes({
        schemaVersion: 1,
        runId: options.runId,
        declarationDigest,
        lifecycleStates: coordinator.observedStates,
        eventChainHead: events.head,
        freezeId: freeze.freezeId,
        launchEpochMs,
        schedulePolicy: OFFLINE_SCHEDULE,
        scheduleObservations: schedule.observations,
        externalModelRequestCount: 0,
        fixtureBehaviorIsEmpiricalModelEvidence: false,
        containerEvidence: {
          gatewayImageId: containerRuntime.gatewayImageId,
          fixtureImageId: containerRuntime.fixtureImageId,
          solverImageId: containerRuntime.solverImageId,
          fixtureNetworkMode: "per-agent-internal-bridges",
          agentNetworkIsolation,
          cleanSolverNetworkMode: "none",
          authenticatedSmartHttpGateway: true,
          hiddenPerAgentQuarantineRefs: true,
          transactionalGitAdmission: true,
          receiveHiddenRefs,
          uploadHiddenRefsAtDrain: uploadHiddenRefs,
          stagingRefCountAtDrain: stagingRefCount,
          objectDatabaseMode: "per-agent-private",
          gatewayPolicyEvidenceDigest: sha256Hex(canonicalJsonBytes(gatewayPolicy)),
          trustedDrainEvidenceDigest: sha256Hex(drainEvidenceBytes),
          fetchPublicationEvidenceDigests: {
            collaboration: sha256Hex(collaborationGatewayBytes),
            final: sha256Hex(gatewayPublicationBytes),
          },
          canonicalFetchEvidenceDigest: sha256Hex(gatewayFetchBytes),
        },
      }),
    );
    return identity;
  } finally {
    await containerRuntime.close();
  }
}

export async function runOfflineHarness(options: {
  root?: string;
  runId: string;
}): Promise<HarnessAttemptIdentity> {
  try {
    return await executeOfflineHarness(options);
  } catch (error) {
    await sealCurrentAttemptFailure({
      root: resolve(options.root ?? ".", HARNESS_ROOT),
      runId: options.runId,
      phase: "run",
      error,
    });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const identity = await runOfflineHarness({ runId: runIdFromArgs() });
  process.stdout.write(`${canonicalJsonBytes(identity).toString("utf8")}\n`);
}
