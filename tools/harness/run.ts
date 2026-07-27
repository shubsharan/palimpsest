import { execFile } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  VisibilityJournal,
  buildLogicalTransaction,
  refOperations,
} from "@palimpsest/git-accounting";
import {
  CumulativeLedger,
  admitFrame,
  createFreeze,
  publishSnapshot,
  type LedgerEntry,
  type RefMap,
} from "@palimpsest/git-gateway";
import {
  CommonBarrierCoordinator,
  EventChain,
  releaseAgentShard,
  runBridgeProcess,
  sealPrivateSubmission,
  type AgentInvocationRequest,
} from "@palimpsest/run-control";
import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import { createAttempt } from "./artifacts.js";
import { startContainerRuntime } from "./container-runtime.js";
import {
  AGENT_IDS,
  FIXTURE_ADAPTER_ID,
  HARNESS_ROOT,
  type HarnessAttemptIdentity,
} from "./config.js";
import { checkPredeclaration } from "./report.js";

const execFileAsync = promisify(execFile);

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
  next: Parameters<CommonBarrierCoordinator["advance"]>[0],
): Promise<void> {
  coordinator.advance(next);
  await events.append({
    producer: "run-control",
    effectId: `lifecycle-${next.toLowerCase()}`,
    eventType: "lifecycle.transition",
    monotonicElapsedNs: String(events.events.length * 1_000_000),
    payload: { state: next },
  });
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

export async function runOfflineHarness(options: {
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
  const coordinator = new CommonBarrierCoordinator();
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
    communicationBudgetBytes: 65_536,
  };
  await writeFile(join(attempt, "run-manifest.json"), canonicalJsonBytes(runManifest));
  await appendState(coordinator, events, "STARTING");
  const repository = await initializeRepository(attempt, bundleRoot);
  await git(repository, ["config", "http.receivepack", "true"]);
  const containerRuntime = await startContainerRuntime({ identity, repository });
  await appendState(coordinator, events, "RUNNING");

  const invocations = await Promise.all(
    AGENT_IDS.map(async (agentId, index) => {
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
        monotonicElapsedNs: String((index + 1) * 2_000_000),
        payload: { agentId, ordinal: 1 },
      });
      const releasedInputManifestPath = await releaseAgentShard({
        bundleRoot,
        agentId,
        destination: inputRoot,
        ordinal: 2,
      });
      await events.append({
        producer: "reveal-control",
        effectId: `reveal-${agentId}-2`,
        eventType: "reveal.release",
        monotonicElapsedNs: String((index + 1) * 3_000_000),
        payload: { agentId, ordinal: 2 },
      });
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
        gitRefNamespace: `refs/heads/agents/${agentId}`,
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
      };
    }),
  );

  let workerResults;
  try {
    workerResults = await Promise.all(
      invocations.map(
        async ({ agentId, invocation, containerRequestPath, inputRoot, outputRoot }) => {
          const result = await runBridgeProcess({
            command: "docker",
            args: [
              "run",
              "--rm",
              "--network",
              containerRuntime.network,
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
  } finally {
    await containerRuntime.close();
  }
  for (const { agentId, result } of workerResults) {
    await events.append({
      producer: "model-bridge",
      effectId: `worker-${agentId}-completed`,
      eventType: "worker.completed",
      monotonicElapsedNs: String(events.events.length * 1_000_000),
      payload: { agentId, eventCount: result.events.length, exitCode: result.exitCode },
    });
  }

  await appendState(coordinator, events, "PUSH_CLOSED");
  await appendState(coordinator, events, "DRAINING");
  const mainOids = (await git(repository, ["rev-list", "--objects", "--no-object-names", "main"]))
    .split("\n")
    .filter(Boolean);
  let journal = new VisibilityJournal(mainOids);
  const ledgers: LedgerEntry[] = [];
  for (const [index, agentId] of AGENT_IDS.entries()) {
    const refName = `refs/heads/agents/${agentId}/work`;
    const tip = await git(repository, ["rev-parse", refName]);
    const frame = await buildLogicalTransaction({
      authenticatedAgent: index + 1,
      newOid: tip,
      operation: refOperations.create,
      publicationSlot: 1,
      refName,
      repository,
      slotStartJournal: journal,
    });
    const ledger = new CumulativeLedger(options.runId, agentId, 65_536);
    const entry = admitFrame({
      agent: { agentId, refNamespace: `refs/heads/agents/${agentId}` },
      frame,
      ledger,
      transactionId: `${agentId}-push-001`,
    });
    if (entry.result !== "accepted") {
      throw new Error(`Fixture push exceeded communication budget: ${agentId}`);
    }
    ledgers.push(entry);
    journal = journal.withAcceptedObjects([frame.objects]);
  }
  await writeFile(join(attempt, "git", "ledgers.json"), canonicalJsonBytes(ledgers));
  const refs = await refMap(repository);
  const snapshot = publishSnapshot({
    runId: options.runId,
    ordinal: 1,
    refs,
    visibilityJournalDigest: journal.digest(),
    eventSequence: events.events.length,
  });
  await writeFile(join(attempt, "git", "publication.json"), canonicalJsonBytes(snapshot));
  await events.append({
    producer: "git-gateway",
    effectId: "publication-001",
    eventType: "git.publication",
    monotonicElapsedNs: String(events.events.length * 1_000_000),
    payload: { snapshotId: snapshot.snapshotId, refMapDigest: snapshot.refMapDigest },
  });

  const freeze = await createFreeze({
    repository,
    bundlePath: join(attempt, "git", "frozen.bundle"),
    runId: options.runId,
    refs,
    visibilityJournalDigest: journal.digest(),
    ledgers,
    finalEventSequence: events.events.length,
    eventChainHead: events.head!,
  });
  await writeFile(join(attempt, "git", "freeze.json"), canonicalJsonBytes(freeze));
  await appendState(coordinator, events, "FROZEN");
  await appendState(coordinator, events, "FINALIZING");
  const releasedShardDigest = sha256Hex(bundleManifestBytes);
  const submissions = [];
  for (const invocation of invocations) {
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
  await appendState(coordinator, events, "SUBMITTED");
  await writeFile(
    join(attempt, "run-result.json"),
    canonicalJsonBytes({
      schemaVersion: 1,
      runId: options.runId,
      declarationDigest,
      lifecycleStates: coordinator.observedStates,
      eventChainHead: events.head,
      freezeId: freeze.freezeId,
      externalModelRequestCount: 0,
      fixtureBehaviorIsEmpiricalModelEvidence: false,
      containerEvidence: {
        fixtureImageId: containerRuntime.fixtureImageId,
        solverImageId: containerRuntime.solverImageId,
        fixtureNetworkMode: "internal",
        cleanSolverNetworkMode: "none",
        authenticatedSmartHttpGateway: true,
      },
    }),
  );
  return identity;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const identity = await runOfflineHarness({ runId: runIdFromArgs() });
  process.stdout.write(`${canonicalJsonBytes(identity).toString("utf8")}\n`);
}
