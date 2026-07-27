import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  VisibilityJournal,
  buildLogicalTransaction,
  encodeGitAccountingFrame,
  refOperations,
} from "@palimpsest/git-accounting";
import {
  CumulativeLedger,
  GitRefTransactionStore,
  SerializedAdmissionGateway,
  captureFetchSnapshot,
  materializeSnapshotRepository,
  publishSnapshot,
  validateQuarantinedFrame,
  type CanonicalFetchTuple,
  type CapturedFetch,
  type LedgerEntry,
} from "@palimpsest/git-gateway";
import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import { AGENT_IDS } from "./config.js";
import { startGitServer } from "./git-server.js";
import {
  PUBLICATION_SLOTS,
  gatewayPublicationPaths,
  publicationSlot,
  type GatewayPublicationEvidence,
  type PublicationOrdinal,
} from "./publication-slots.js";

const execFileAsync = promisify(execFile);
const repository = process.env.PALIMPSEST_GIT_REPOSITORY;
if (!repository) {
  throw new Error("PALIMPSEST_GIT_REPOSITORY is required.");
}
const runId = process.env.PALIMPSEST_RUN_ID;
if (!runId) {
  throw new Error("PALIMPSEST_RUN_ID is required.");
}
const budgetBytes = Number(process.env.PALIMPSEST_COMMUNICATION_BUDGET_BYTES);
if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0) {
  throw new Error("PALIMPSEST_COMMUNICATION_BUDGET_BYTES must be a positive safe integer.");
}
const secretText = process.env.PALIMPSEST_GIT_SECRETS_JSON;
if (!secretText) {
  throw new Error("PALIMPSEST_GIT_SECRETS_JSON is required.");
}
const secretValue = JSON.parse(secretText) as unknown;
if (!secretValue || typeof secretValue !== "object" || Array.isArray(secretValue)) {
  throw new Error("PALIMPSEST_GIT_SECRETS_JSON must contain an agent-secret object.");
}
const secrets = secretValue as Record<(typeof AGENT_IDS)[number], string>;
if (
  !canonicalJsonBytes(Object.keys(secrets).sort()).equals(
    canonicalJsonBytes([...AGENT_IDS].sort()),
  ) ||
  AGENT_IDS.some(
    (agentId) =>
      typeof secrets[agentId] !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secrets[agentId]),
  ) ||
  new Set(AGENT_IDS.map((agentId) => secrets[agentId])).size !== AGENT_IDS.length
) {
  throw new Error("Git Gateway credentials must be distinct 32-byte base64url secrets.");
}
const maxFetchesPerAgent = Object.keys(PUBLICATION_SLOTS).length;
const maxReceiveAttemptsPerAgent = Object.keys(PUBLICATION_SLOTS).length;
const maxReceiveBodyBytes = 8 * 1024 * 1024;
const receiveTimeoutMs = 30_000;
const hooksRoot = "/run/palimpsest-hooks";

async function gitAt(target: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", target, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

function git(args: string[]): Promise<string> {
  return gitAt(repository!, args);
}

const stagingRepositories = Object.fromEntries(
  await Promise.all(
    AGENT_IDS.map(async (agentId) => {
      const parent = `/tmp/staging/${agentId}`;
      const staging = `${parent}/repository.git`;
      await mkdir(parent, { recursive: true });
      await execFileAsync("git", [
        "clone",
        "--quiet",
        "--bare",
        "--no-hardlinks",
        repository!,
        staging,
      ]);
      await gitAt(staging, ["config", "http.receivepack", "true"]);
      return [agentId, staging] as const;
    }),
  ),
) as Record<(typeof AGENT_IDS)[number], string>;

const mainOids = (await git(["rev-list", "--objects", "--no-object-names", "main"]))
  .split("\n")
  .filter(Boolean);
let slotStartJournal = new VisibilityJournal(mainOids);
const ledgers = new Map(
  AGENT_IDS.map((agentId) => [
    agentId,
    new CumulativeLedger(
      runId,
      agentId,
      budgetBytes,
      `${repository}/gateway-ledger-${agentId}.json`,
    ),
  ]),
);
const refStore = new GitRefTransactionStore(repository);
const gateway = new SerializedAdmissionGateway(
  refStore,
  ledgers,
  async (frame) => {
    const agentId = AGENT_IDS[frame.authenticatedAgent - 1];
    if (!agentId) {
      throw new Error(`Unknown authenticated agent number: ${frame.authenticatedAgent}.`);
    }
    await validateQuarantinedFrame({
      agent: {
        agentId,
        refNamespace: `refs/heads/agents/${agentId}`,
        authenticatedAgent: frame.authenticatedAgent,
      },
      frame,
      quarantineRepository: stagingRepositories[agentId],
      slotStartVisibleOids: slotStartJournal.values(),
    });
  },
  async (frame) => {
    const agentId = AGENT_IDS[frame.authenticatedAgent - 1];
    if (!agentId) {
      throw new Error(`Unknown authenticated agent number: ${frame.authenticatedAgent}.`);
    }
    await git([
      "fetch",
      "--quiet",
      "--no-tags",
      stagingRepositories[agentId],
      frame.newOid.toString("hex"),
    ]);
  },
);
await gateway.recoverPending();

async function persistLedgers(): Promise<void> {
  const entries: LedgerEntry[] = [];
  for (const agentId of AGENT_IDS) entries.push(...ledgers.get(agentId)!.entries);
  await writeFile(`${repository}/gateway-ledgers.json`, canonicalJsonBytes(entries));
}

async function inspectGatewayPolicy(): Promise<Record<string, unknown>> {
  const repositories = Object.fromEntries(
    await Promise.all(
      AGENT_IDS.map(async (agentId) => {
        const staging = stagingRepositories[agentId];
        const refs = await gitAt(staging, [
          "for-each-ref",
          "--format=%(refname)",
          "refs/heads/quarantine",
        ]);
        const [gitDirectory, objectDirectory, hooksPath, receiveHiddenRefs, uploadHiddenRefs] =
          await Promise.all([
            gitAt(staging, ["rev-parse", "--absolute-git-dir"]),
            gitAt(staging, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]),
            gitAt(staging, ["config", "--get", "core.hooksPath"]),
            gitAt(staging, ["config", "--get-all", "receive.hideRefs"]).catch(() => ""),
            gitAt(staging, ["config", "--get-all", "uploadpack.hideRefs"]).catch(() => ""),
          ]);
        const alternates = await readFile(`${objectDirectory}/info/alternates`, "utf8").catch(
          () => "",
        );
        return [
          agentId,
          {
            gitDirectory,
            objectDirectory,
            hooksPath,
            alternates: alternates.split("\n").filter(Boolean),
            receiveHiddenRefs: receiveHiddenRefs.split("\n").filter(Boolean).sort(),
            uploadHiddenRefs: uploadHiddenRefs.split("\n").filter(Boolean).sort(),
            quarantineRefCount: refs.split("\n").filter(Boolean).length,
          },
        ] as const;
      }),
    ),
  );
  const evidence = Object.values(repositories);
  return {
    schemaVersion: 2,
    resourceLimits: {
      maxFetchesPerAgent,
      maxReceiveAttemptsPerAgent,
      maxReceiveBodyBytes,
      receiveTimeoutMs,
    },
    inspectedRepositories: repositories,
    perAgentPrivateObjectDatabases:
      new Set(evidence.map((entry) => entry.objectDirectory)).size === AGENT_IDS.length &&
      evidence.every((entry) => entry.alternates.length === 0),
  };
}

async function persistGatewayPolicy(): Promise<Record<string, unknown>> {
  const policy = await inspectGatewayPolicy();
  await writeFile(`${repository}/gateway-policy.json`, canonicalJsonBytes(policy));
  return policy;
}
await persistLedgers();

let publishedFetch: CapturedFetch | undefined;
const fetchEvidence: Array<{
  schemaVersion: 1;
  agentId: (typeof AGENT_IDS)[number];
  sequence: number;
  tuple: CanonicalFetchTuple;
}> = [];
const admittedFetchCounts = Object.fromEntries(AGENT_IDS.map((agentId) => [agentId, 0])) as Record<
  (typeof AGENT_IDS)[number],
  number
>;
let fetchEvidenceTail: Promise<void> = Promise.resolve();
let nextPublicationOrdinal: number = 1;
let previousPublishedSnapshotId: string | null = null;

function pendingPublicationOrdinal(): PublicationOrdinal {
  publicationSlot(nextPublicationOrdinal);
  return nextPublicationOrdinal as PublicationOrdinal;
}

async function writeFetchEvidence(): Promise<void> {
  await writeFile(
    `${repository}/gateway-fetches.json`,
    canonicalJsonBytes({
      schemaVersion: 1,
      runId,
      maxFetchesPerAgent,
      admittedFetchCounts,
      fetches: fetchEvidence,
    }),
  );
}

function persistFetchEvidence(
  agentId: (typeof AGENT_IDS)[number],
  tuple: CanonicalFetchTuple,
): Promise<void> {
  const operation = fetchEvidenceTail.then(async () => {
    fetchEvidence.push({
      schemaVersion: 1,
      agentId,
      sequence: fetchEvidence.length + 1,
      tuple,
    });
    admittedFetchCounts[agentId] += 1;
    await writeFetchEvidence();
  });
  fetchEvidenceTail = operation.catch(() => undefined);
  return operation;
}

async function publishAuthoritativeSnapshot(): Promise<void> {
  const ordinal = pendingPublicationOrdinal();
  const slot = publicationSlot(ordinal);
  const paths = gatewayPublicationPaths(repository!, slot);
  const publicationRequest = JSON.parse(await readFile(paths.request, "utf8")) as Record<
    string,
    unknown
  >;
  if (
    Object.keys(publicationRequest).sort().join(",") !==
      "eventSequence,ordinal,runId,schemaVersion,slot" ||
    publicationRequest.schemaVersion !== 1 ||
    publicationRequest.runId !== runId ||
    publicationRequest.slot !== slot ||
    publicationRequest.ordinal !== ordinal ||
    !Number.isSafeInteger(publicationRequest.eventSequence) ||
    (publicationRequest.eventSequence as number) < 0
  ) {
    throw new Error("Git publication request does not bind a valid host event sequence.");
  }
  const refs = Object.fromEntries(
    Object.entries(await refStore.snapshot()).filter(
      ([refName]) => refName === "refs/heads/main" || refName.startsWith("refs/heads/agents/"),
    ),
  );
  const view = await materializeSnapshotRepository({
    sourceRepository: repository!,
    destination: `/tmp/publications/publication-${String(ordinal).padStart(3, "0")}/repository.git`,
    refs,
  });
  const snapshot = publishSnapshot({
    runId: runId!,
    ordinal,
    refs,
    predecessorSnapshotId: previousPublishedSnapshotId,
    visibilityJournalDigest: new VisibilityJournal(view.allowedOids).digest(),
    eventSequence: publicationRequest.eventSequence as number,
  });
  publishedFetch = captureFetchSnapshot(snapshot, view);
  await writeFetchEvidence();
  const evidence: GatewayPublicationEvidence = {
    schemaVersion: 1,
    slot,
    snapshot,
    refs,
    allowedOidCount: view.allowedOids.length,
    allowedOidsDigest: sha256Hex(canonicalJsonBytes(view.allowedOids)),
    maxFetchesPerAgent,
  };
  await writeFile(paths.evidence, canonicalJsonBytes(evidence), { flag: "wx" });
  await writeFile(paths.marker, "published\n", { flag: "wx" });
  slotStartJournal = new VisibilityJournal(view.allowedOids);
  previousPublishedSnapshotId = snapshot.snapshotId;
  nextPublicationOrdinal += 1;
}

const server = await startGitServer({
  repository,
  repositories: stagingRepositories,
  stagingRefMode: true,
  hooksRoot,
  host: "0.0.0.0",
  port: 8080,
  maxFetchesPerAgent,
  maxReceiveAttemptsPerAgent,
  maxReceiveBodyBytes,
  receiveTimeoutMs,
  secrets,
  captureFetch() {
    return publishedFetch
      ? captureFetchSnapshot(publishedFetch.snapshot, publishedFetch.view)
      : undefined;
  },
  onFetch({ agentId, tuple }) {
    return persistFetchEvidence(agentId, tuple);
  },
  async onReceive({ agentId, arrivalSequence }) {
    const stagingRef = `refs/heads/quarantine/${agentId}/work`;
    const stagingRepository = stagingRepositories[agentId];
    try {
      const tip = await gitAt(stagingRepository, ["rev-parse", stagingRef]);
      const authoritativeRef = `refs/heads/agents/${agentId}/work`;
      const refs = await refStore.snapshot();
      const oldOid = refs[authoritativeRef];
      const frame = await buildLogicalTransaction({
        authenticatedAgent: AGENT_IDS.indexOf(agentId) + 1,
        newOid: tip,
        ...(oldOid ? { oldOid } : {}),
        operation: oldOid ? refOperations.update : refOperations.create,
        publicationSlot: pendingPublicationOrdinal(),
        refName: authoritativeRef,
        repository: stagingRepository,
        slotStartJournal,
      });
      const result = await gateway.admit({
        agent: {
          agentId,
          refNamespace: `refs/heads/agents/${agentId}`,
          authenticatedAgent: AGENT_IDS.indexOf(agentId) + 1,
        },
        frame,
        transactionId: `${agentId}-push-${sha256Hex(encodeGitAccountingFrame(frame))}`,
      });
      await persistLedgers();
      if (!result.refCommitted || result.entry.result !== "accepted") {
        throw new Error(`Git admission rejected ${agentId} receive ${arrivalSequence}.`);
      }
    } finally {
      await gitAt(stagingRepository, ["update-ref", "-d", stagingRef]).catch(() => undefined);
      await persistGatewayPolicy();
    }
  },
});
await persistGatewayPolicy();
process.stdout.write("ready\n");

process.on("SIGUSR1", () => {
  server.closeAdmission();
  void (async () => {
    try {
      await server.drainAdmission(30_000);
      const pendingReservations = [...ledgers.values()].flatMap(
        (ledger) => ledger.pendingReservations,
      );
      if (pendingReservations.length !== 0) {
        throw new Error("Git Gateway drained with unresolved ledger reservations.");
      }
      await persistLedgers();
      const policy = await persistGatewayPolicy();
      await writeFile(
        `${repository}/gateway-drained.json`,
        canonicalJsonBytes({
          schemaVersion: 1,
          runId,
          pendingReceives: 0,
          pendingReservations: 0,
          ledgerEntryCount: [...ledgers.values()].reduce(
            (count, ledger) => count + ledger.entries.length,
            0,
          ),
          policy,
        }),
        { flag: "wx" },
      );
    } catch (error) {
      await writeFile(
        `${repository}/gateway-drain-error`,
        error instanceof Error ? error.message : String(error),
      );
    }
  })();
});
process.on("SIGUSR2", () => {
  const slot = publicationSlot(nextPublicationOrdinal);
  const paths = gatewayPublicationPaths(repository!, slot);
  void publishAuthoritativeSnapshot().catch(async (error: unknown) => {
    await writeFile(paths.error, error instanceof Error ? error.message : String(error), {
      flag: "wx",
    });
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
await new Promise(() => {});
