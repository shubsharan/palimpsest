import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { canonicalJsonBytes, sha256Hex, validateValue } from "@palimpsest/contracts";
import {
  VisibilityJournal,
  buildLogicalTransaction,
  encodeGitAccountingFrame,
  gitAccountingCharge,
  refOperations,
} from "@palimpsest/git-accounting";
import { EventChain } from "@palimpsest/run-control";

import { verifyTerminalAttempt } from "./artifacts.js";
import { attemptPath, HARNESS_ROOT, type HarnessAttemptIdentity } from "./config.js";
import { identityFromArgs } from "./grade.js";
import {
  PUBLICATION_SLOTS,
  attemptPublicationPaths,
  type GatewayPublicationEvidence,
  type PublicationSlot,
} from "./publication-slots.js";

const execFileAsync = promisify(execFile);

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export interface PublicationReplayEvidence {
  slot: PublicationSlot;
  publication: {
    schemaVersion: 1;
    contractId: "published-snapshot";
    runId: string;
    snapshotId: string;
    ordinal: number;
    predecessorSnapshotId: string | null;
    snapshotDigest: string;
    refMapDigest: string;
    visibilityJournalDigest: string;
    eventSequence: number;
  };
  fetchPublication: GatewayPublicationEvidence;
}

export function verifyPublicationEventSequence(evidence: PublicationReplayEvidence): void {
  const { slot, publication, fetchPublication } = evidence;
  const publicationValidation = validateValue("published-snapshot", publication);
  const fetchSnapshotValidation = validateValue("published-snapshot", fetchPublication.snapshot);
  if (
    !publicationValidation.accepted ||
    !fetchSnapshotValidation.accepted ||
    !Number.isSafeInteger(publication.eventSequence) ||
    publication.eventSequence < 0 ||
    fetchPublication.snapshot.eventSequence !== publication.eventSequence ||
    publication.ordinal !== PUBLICATION_SLOTS[slot] ||
    fetchPublication.slot !== slot ||
    !canonicalJsonBytes(fetchPublication.snapshot).equals(canonicalJsonBytes(publication))
  ) {
    throw new Error(
      `Replay ${slot} publication does not bind its authoritative event sequence and ordinal.`,
    );
  }
}

export function verifyPublicationSequence(
  publications: readonly PublicationReplayEvidence[],
): void {
  if (
    publications.length !== 2 ||
    publications[0]?.slot !== "collaboration" ||
    publications[1]?.slot !== "final"
  ) {
    throw new Error("Replay requires collaboration and final publication slots in order.");
  }
  for (const evidence of publications) {
    verifyPublicationEventSequence(evidence);
  }
  const collaboration = publications[0].publication;
  const final = publications[1].publication;
  const { snapshotDigest: collaborationDigest, ...collaborationIdentity } = collaboration;
  const { snapshotDigest: finalDigest, ...finalIdentity } = final;
  if (
    collaboration.runId !== final.runId ||
    collaboration.predecessorSnapshotId !== null ||
    final.predecessorSnapshotId !== collaboration.snapshotId ||
    collaborationDigest !== sha256Hex(canonicalJsonBytes(collaborationIdentity)) ||
    finalDigest !== sha256Hex(canonicalJsonBytes(finalIdentity)) ||
    collaboration.eventSequence >= final.eventSequence
  ) {
    throw new Error("Replay publication lineage must form one digest-bound chain within one run.");
  }
}

const trustedArtifacts = [
  ["run-manifest.json", "run-manifest"],
  ["live.jsonl", "run-event-stream"],
  ["git/drain.json", "git-drain-evidence"],
  ["git/fetch-publication-001.json", "git-fetch-publication"],
  ["git/fetch-publication-002.json", "git-fetch-publication"],
  ["git/fetches.json", "git-fetch-evidence"],
  ["git/publication-001.json", "published-snapshot"],
  ["git/publication-002.json", "published-snapshot"],
  ["git/ledgers.json", "git-ledgers"],
  ["git/freeze.json", "freeze-snapshot"],
  ["git/frozen.bundle", "git-bundle"],
  ["agents/agent-1/events.json", "agent-event-stream"],
  ["agents/agent-2/events.json", "agent-event-stream"],
  ["agents/agent-3/events.json", "agent-event-stream"],
  ["submissions.json", "private-submissions"],
  ["grading/solver-executions.json", "solver-executions"],
  ["grading/score-report.json", "score-report"],
] as const;

const publicArtifacts = [
  ["public/metrics.json", "aggregate-score-report"],
  ["public/events.json", "sanitized-event-trace"],
  ["public/implementation.json", "implementation-status"],
  ["public/environment.json", "environment-versions"],
  ["public/claims.json", "claim-scope"],
  ["public/plots/aggregate-metrics.svg", "aggregate-score-plot"],
] as const;

async function artifact(path: string, artifactType: string): Promise<Record<string, unknown>> {
  const bytes = await readFile(path);
  return { artifactType, byteLength: bytes.byteLength, sha256: sha256Hex(bytes) };
}

async function git(repository: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function verifyGitAccountingReplay(attempt: string): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "palimpsest-accounting-replay-"));
  const repository = join(temporary, "repository.git");
  try {
    await execFileAsync("git", [
      "clone",
      "--quiet",
      "--bare",
      resolve(attempt, "git/frozen.bundle"),
      repository,
    ]);
    const refOutput = await git(repository, [
      "for-each-ref",
      "--format=%(refname) %(objectname)",
      "refs/heads",
    ]);
    const refs = Object.fromEntries(
      refOutput
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf(" ");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    const publications = await Promise.all(
      (Object.keys(PUBLICATION_SLOTS) as PublicationSlot[]).map(async (slot) => {
        const paths = attemptPublicationPaths(attempt, slot);
        return {
          slot,
          publication: JSON.parse(
            await readFile(paths.publication, "utf8"),
          ) as PublicationReplayEvidence["publication"],
          fetchPublication: JSON.parse(
            await readFile(paths.fetchPublication, "utf8"),
          ) as GatewayPublicationEvidence,
        };
      }),
    );
    verifyPublicationSequence(publications);
    const eventLines = (await readFile(resolve(attempt, "live.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(
        (line) => JSON.parse(line) as { eventType?: unknown; payload?: Record<string, unknown> },
      );
    for (const evidence of publications) {
      const { publication, fetchPublication } = evidence;
      const publicationEvent = eventLines[publication.eventSequence];
      if (
        Object.keys(fetchPublication).sort().join(",") !==
          "allowedOidCount,allowedOidsDigest,maxFetchesPerAgent,refs,schemaVersion,slot,snapshot" ||
        fetchPublication.snapshot.runId !== publication.runId ||
        fetchPublication.snapshot.snapshotId !== publication.snapshotId ||
        fetchPublication.snapshot.ordinal !== publication.ordinal ||
        fetchPublication.snapshot.refMapDigest !== publication.refMapDigest ||
        fetchPublication.snapshot.visibilityJournalDigest !== publication.visibilityJournalDigest ||
        sha256Hex(canonicalJsonBytes(fetchPublication.refs)) !== publication.refMapDigest ||
        publicationEvent?.eventType !== "git.publication" ||
        publicationEvent.payload?.snapshotId !== publication.snapshotId
      ) {
        throw new Error(`Replay ${evidence.slot} publication evidence is not internally bound.`);
      }
    }
    const finalEvidence = publications.find((evidence) => evidence.slot === "final");
    if (!finalEvidence) {
      throw new Error("Replay final publication evidence is missing.");
    }
    const publication = finalEvidence.publication;
    const fetchPublication = finalEvidence.fetchPublication;
    const freeze = JSON.parse(await readFile(resolve(attempt, "git/freeze.json"), "utf8")) as {
      refMapDigest: string;
      visibilityJournalDigest: string;
    };
    if (
      sha256Hex(canonicalJsonBytes(refs)) !== publication.refMapDigest ||
      publication.refMapDigest !== freeze.refMapDigest
    ) {
      throw new Error("Replay Git ref map does not match publication and freeze evidence.");
    }
    const mainOids = (await git(repository, ["rev-list", "--objects", "--no-object-names", "main"]))
      .split("\n")
      .filter(Boolean);
    const allowedOidsBySnapshot = new Map<string, string[]>();
    for (const evidence of publications) {
      const allowedOids = [
        ...new Set(
          (
            await git(repository, [
              "rev-list",
              "--objects",
              "--no-object-names",
              ...Object.values(evidence.fetchPublication.refs),
            ])
          )
            .split("\n")
            .filter(Boolean),
        ),
      ].sort();
      allowedOidsBySnapshot.set(evidence.publication.snapshotId, allowedOids);
      if (
        evidence.fetchPublication.allowedOidCount !== allowedOids.length ||
        evidence.fetchPublication.allowedOidsDigest !==
          sha256Hex(canonicalJsonBytes(allowedOids)) ||
        evidence.fetchPublication.maxFetchesPerAgent !== 2
      ) {
        throw new Error(`Replay ${evidence.slot} fetch publication has invalid object evidence.`);
      }
    }
    if (
      sha256Hex(canonicalJsonBytes(fetchPublication.refs)) !== freeze.refMapDigest ||
      sha256Hex(canonicalJsonBytes(refs)) !== freeze.refMapDigest
    ) {
      throw new Error("Replay immutable fetch publication does not match the frozen Git bundle.");
    }
    const fetchEvidence = JSON.parse(
      await readFile(resolve(attempt, "git/fetches.json"), "utf8"),
    ) as {
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
    if (
      fetchEvidence.maxFetchesPerAgent !== 2 ||
      fetchEvidence.fetches.length !== 6 ||
      !["agent-1", "agent-2", "agent-3"].every(
        (agentId) => fetchEvidence.admittedFetchCounts[agentId] === 2,
      ) ||
      new Set(fetchEvidence.fetches.map((fetch) => `${fetch.agentId}:${fetch.tuple.snapshotId}`))
        .size !== 6 ||
      fetchEvidence.fetches.some((fetch, index) => {
        const { digest, ...tupleBody } = fetch.tuple;
        const slot = publications.find(
          (candidate) => candidate.publication.snapshotId === fetch.tuple.snapshotId,
        );
        const visible = allowedOidsBySnapshot.get(fetch.tuple.snapshotId);
        return (
          !slot ||
          !visible ||
          fetch.sequence !== index + 1 ||
          fetch.tuple.wants.length < 1 ||
          fetch.tuple.wants.some(
            (oid) => !Object.values(slot.fetchPublication.refs).includes(oid),
          ) ||
          fetch.tuple.haves.some((oid) => !new Set(visible).has(oid)) ||
          digest !== sha256Hex(canonicalJsonBytes(tupleBody))
        );
      })
    ) {
      throw new Error("Replay canonical fetch evidence does not match the frozen Git snapshot.");
    }
    let slotStartJournal = new VisibilityJournal(mainOids);
    const ledgers = JSON.parse(
      await readFile(resolve(attempt, "git/ledgers.json"), "utf8"),
    ) as Array<{
      agentId: string;
      transactionId: string;
      frameDigest: string;
      chargeBytes: number;
      result: string;
    }>;
    const matchedLedgerDigests = new Set<string>();
    let priorRefs: Record<string, string> = {};
    for (const evidence of publications) {
      const frames = await Promise.all(
        ["agent-1", "agent-2", "agent-3"].map(async (agentId, index) => {
          const refName = `refs/heads/agents/${agentId}/work`;
          const newOid = evidence.fetchPublication.refs[refName];
          const oldOid = priorRefs[refName];
          if (!newOid) throw new Error(`Replay publication is missing ${refName}.`);
          const frame = await buildLogicalTransaction({
            authenticatedAgent: index + 1,
            newOid,
            ...(oldOid ? { oldOid } : {}),
            operation: oldOid ? refOperations.update : refOperations.create,
            publicationSlot: evidence.publication.ordinal,
            refName,
            repository,
            slotStartJournal,
          });
          const digest = sha256Hex(encodeGitAccountingFrame(frame));
          const ledger = ledgers.find(
            (entry) => entry.agentId === agentId && entry.frameDigest === digest,
          );
          if (
            !ledger ||
            ledger.result !== "accepted" ||
            ledger.chargeBytes !== gitAccountingCharge(frame) ||
            ledger.transactionId !== `${agentId}-push-${digest}`
          ) {
            throw new Error(
              `Replay Git accounting frame does not match ledger for ${agentId} in ${evidence.slot}.`,
            );
          }
          matchedLedgerDigests.add(digest);
          return frame;
        }),
      );
      slotStartJournal = slotStartJournal.withAcceptedObjects(frames.map((frame) => frame.objects));
      if (slotStartJournal.digest() !== evidence.publication.visibilityJournalDigest) {
        throw new Error(`Replay ${evidence.slot} visibility journal does not match publication.`);
      }
      priorRefs = evidence.fetchPublication.refs;
    }
    if (
      ledgers.length !== 6 ||
      matchedLedgerDigests.size !== 6 ||
      slotStartJournal.digest() !== freeze.visibilityJournalDigest
    ) {
      throw new Error("Replay Git ledgers do not cover both immutable publication slots.");
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function validateReplayArtifacts(
  identity: HarnessAttemptIdentity,
  root = ".",
): Promise<Record<string, unknown>> {
  const attempt = attemptPath(resolve(root, HARNESS_ROOT), identity);
  const replay = JSON.parse(await readFile(resolve(attempt, "replay/trusted-replay.json"), "utf8"));
  const verdict = JSON.parse(await readFile(resolve(attempt, "replay/verdict.json"), "utf8"));
  const publicReport = JSON.parse(await readFile(resolve(attempt, "public/report.json"), "utf8"));
  for (const [contractId, value] of [
    ["trusted-replay-bundle", replay],
    ["public-report-bundle", publicReport],
  ] as const) {
    const validation = validateValue(contractId, value);
    if (!validation.accepted) {
      throw new Error(`${contractId} is invalid: ${validation.reason} at ${validation.pointer}`);
    }
  }
  if (
    replay.runId !== identity.runId ||
    verdict.runId !== identity.runId ||
    publicReport.runId !== identity.runId
  ) {
    throw new Error("Replay artifacts do not match the explicit attempt identity.");
  }
  const expectedTrusted = await Promise.all(
    trustedArtifacts.map(([path, type]) => artifact(resolve(attempt, path), type)),
  );
  if (!canonicalJsonBytes(replay.artifacts).equals(canonicalJsonBytes(expectedTrusted))) {
    throw new Error("TypeScript replay digest projection disagrees with trusted attempt files.");
  }
  const replayDigest = sha256Hex(canonicalJsonBytes(replay));
  if (verdict.replayDigest !== replayDigest || publicReport.replayDigest !== replayDigest) {
    throw new Error("Replay digest does not bind the verdict and public report.");
  }
  const expectedPublic = await Promise.all(
    publicArtifacts.map(([path, type]) => artifact(resolve(attempt, path), type)),
  );
  if (!canonicalJsonBytes(publicReport.artifacts).equals(canonicalJsonBytes(expectedPublic))) {
    throw new Error("Public report digest projection disagrees with redacted files.");
  }
  return replay as Record<string, unknown>;
}

export async function replayAttempt(
  identity: HarnessAttemptIdentity,
  root = ".",
): Promise<Record<string, unknown>> {
  const attempt = attemptPath(resolve(root, HARNESS_ROOT), identity);
  const sealed = await pathExists(resolve(attempt, "terminal.json"));
  if (sealed) {
    await verifyTerminalAttempt({ root: resolve(root, HARNESS_ROOT), identity });
  }
  const events = await EventChain.resume(identity.runId, resolve(attempt, "live.jsonl"));
  await verifyGitAccountingReplay(attempt);
  const replayed = events.events.find((event) => event.effectId === "lifecycle-replayed");
  const nextElapsedNs = () => String(BigInt(events.events.at(-1)?.monotonicElapsedNs ?? "0") + 1n);
  await events.append({
    producer: "replay",
    effectId: "lifecycle-replayed",
    eventType: "lifecycle.transition",
    monotonicElapsedNs: replayed?.monotonicElapsedNs ?? nextElapsedNs(),
    payload: { state: "REPLAYED" },
  });
  const scored = events.events.find((event) => event.effectId === "lifecycle-scored");
  await events.append({
    producer: "grading",
    effectId: "lifecycle-scored",
    eventType: "lifecycle.transition",
    monotonicElapsedNs: scored?.monotonicElapsedNs ?? nextElapsedNs(),
    payload: { state: "SCORED" },
  });
  await execFileAsync(
    "uv",
    [
      "run",
      "--offline",
      "--frozen",
      "--project",
      "python",
      "python",
      "-m",
      "palimpsest.replay.harness",
      "--run-id",
      identity.runId,
      "--attempt",
      attempt,
    ],
    { cwd: resolve(root), maxBuffer: 32 * 1024 * 1024 },
  );
  const replay = await validateReplayArtifacts(identity, root);
  if (sealed) {
    await verifyTerminalAttempt({ root: resolve(root, HARNESS_ROOT), identity });
  }
  return replay;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${canonicalJsonBytes(await replayAttempt(identityFromArgs())).toString("utf8")}\n`,
  );
}
