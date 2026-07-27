import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";
import { publishSnapshot } from "@palimpsest/git-gateway";
import { describe, expect, test } from "vitest";

import { evaluateCompletionEvidence } from "../../tools/harness/report.js";

const agents = ["agent-1", "agent-2", "agent-3"] as const;
const runId = "run-1";

function fixture() {
  const policy = {
    schemaVersion: 2,
    perAgentPrivateObjectDatabases: true,
    resourceLimits: {
      maxFetchesPerAgent: 2,
      maxReceiveAttemptsPerAgent: 2,
      maxReceiveBodyBytes: 8_388_608,
      receiveTimeoutMs: 30_000,
    },
    inspectedRepositories: Object.fromEntries(
      agents.map((agentId) => [
        agentId,
        {
          gitDirectory: `/git/${agentId}`,
          objectDirectory: `/objects/${agentId}`,
          hooksPath: `/run/palimpsest-hooks/${agentId}`,
          alternates: [],
          receiveHiddenRefs: ["refs/heads/agents", "refs/heads/quarantine"],
          uploadHiddenRefs: ["refs/heads/agents", "refs/heads/quarantine"],
          quarantineRefCount: 0,
        },
      ]),
    ),
  };
  const drain = {
    schemaVersion: 1,
    runId,
    pendingReceives: 0,
    pendingReservations: 0,
    ledgerEntryCount: 6,
    policy,
  };
  const drainBytes = canonicalJsonBytes(drain);
  const ledgers = agents.flatMap((agentId, agentIndex) =>
    [0, 1].map((pushIndex) => {
      const frameDigest = String(agentIndex * 2 + pushIndex + 1).repeat(64);
      return {
        runId,
        agentId,
        transactionId: `${agentId}-push-${frameDigest}`,
        frameDigest,
        chargeBytes: agentIndex * 2 + pushIndex + 10,
        result: "accepted",
      };
    }),
  );
  const collaborationRefs = Object.fromEntries([
    ["refs/heads/main", "a".repeat(40)],
    ...agents.map((agentId, index) => [
      `refs/heads/agents/${agentId}/work`,
      String(index + 1).repeat(40),
    ]),
  ]);
  const finalRefs = Object.fromEntries([
    ["refs/heads/main", "a".repeat(40)],
    ...agents.map((agentId, index) => [
      `refs/heads/agents/${agentId}/work`,
      String(index + 4).repeat(40),
    ]),
  ]);
  const collaborationPublication = {
    ...publishSnapshot({
      runId,
      ordinal: 1,
      refs: collaborationRefs,
      predecessorSnapshotId: null,
      visibilityJournalDigest: "5".repeat(64),
      eventSequence: 7,
    }),
  };
  const publication = {
    ...publishSnapshot({
      runId,
      ordinal: 2,
      refs: finalRefs,
      predecessorSnapshotId: collaborationPublication.snapshotId,
      visibilityJournalDigest: "7".repeat(64),
      eventSequence: 14,
    }),
  };
  const fetchPublicationWrapper = (
    slot: "collaboration" | "final",
    snapshot: typeof collaborationPublication,
    refs: Record<string, string>,
  ) => ({
    schemaVersion: 1,
    slot,
    maxFetchesPerAgent: 2,
    refs,
    snapshot,
  });
  const collaborationFetchPublication = fetchPublicationWrapper(
    "collaboration",
    collaborationPublication,
    collaborationRefs,
  );
  const collaborationFetchPublicationBytes = canonicalJsonBytes(collaborationFetchPublication);
  const fetchPublication = fetchPublicationWrapper("final", publication, finalRefs);
  const fetchPublicationBytes = canonicalJsonBytes(fetchPublication);
  const fetchRecords = agents.flatMap((agentId, agentIndex) =>
    [collaborationPublication, publication].map((snapshot, snapshotIndex) => {
      const tupleBody = {
        snapshotId: snapshot.snapshotId,
        wants: [String(agentIndex * 2 + snapshotIndex + 1).repeat(64)],
        haves: [],
        capabilityProfile: [],
      };
      return {
        agentId,
        sequence: agentIndex * 2 + snapshotIndex + 1,
        tuple: { ...tupleBody, digest: sha256Hex(canonicalJsonBytes(tupleBody)) },
      };
    }),
  );
  const fetches = {
    runId,
    maxFetchesPerAgent: 2,
    admittedFetchCounts: Object.fromEntries(agents.map((agentId) => [agentId, 2])),
    fetches: fetchRecords,
  };
  const fetchBytes = canonicalJsonBytes(fetches);
  const freeze = {
    runId,
    freezeId: "freeze-001",
    refMapDigest: publication.refMapDigest,
    visibilityJournalDigest: publication.visibilityJournalDigest,
    finalEventSequence: 15,
    finalReleasedShards: agents.map((agentId, index) => ({
      agentId,
      manifest: {
        artifactType: "released-shard-manifest",
        byteLength: index + 1,
        sha256: String(index + 6).repeat(64),
      },
    })),
  };
  const submissions = agents.map((agentId, index) => ({
    schemaVersion: 1,
    contractId: "private-deliverable-manifest",
    runId,
    agentId,
    freezeId: freeze.freezeId,
    releasedShardDigest: freeze.finalReleasedShards[index]!.manifest.sha256,
    outputs: [],
  }));
  const agentEvents = Object.fromEntries(
    agents.map((agentId, agentIndex) => {
      const firstTip = String(agentIndex + 1).repeat(64);
      const secondTip = String(agentIndex + 4).repeat(64);
      const peerSnapshotDigest = String(agentIndex + 7).repeat(64);
      const invocationId = `invocation-${agentId}`;
      const events = [
        {
          schemaVersion: 1,
          runId,
          agentId,
          invocationId,
          ordinal: 1,
          type: "file.read",
          payload: {
            path: "input/released/release-manifest.json",
            releaseOrdinal: 1,
            chapters: [{ chapterIndex: agentIndex, byteLength: 10, sha256: "a".repeat(64) }],
          },
        },
        {
          schemaVersion: 1,
          runId,
          agentId,
          invocationId,
          ordinal: 2,
          type: "git.commit",
          payload: { phase: "release-1", tip: firstTip },
        },
        {
          schemaVersion: 1,
          runId,
          agentId,
          invocationId,
          ordinal: 3,
          type: "git.push",
          payload: {
            phase: "release-1",
            ref: `refs/heads/quarantine/${agentId}/work`,
            tip: firstTip,
          },
        },
        {
          schemaVersion: 1,
          runId,
          agentId,
          invocationId,
          ordinal: 4,
          type: "git.fetch",
          payload: {
            snapshot: "collaboration",
            refNamespace: "refs/heads/agents",
            refCount: agents.length,
            refDigest: peerSnapshotDigest,
          },
        },
        {
          schemaVersion: 1,
          runId,
          agentId,
          invocationId,
          ordinal: 5,
          type: "file.read",
          payload: {
            path: "input/released/release-manifest.json",
            releaseOrdinal: 2,
            chapters: [
              { chapterIndex: agentIndex, byteLength: 10, sha256: "a".repeat(64) },
              { chapterIndex: agentIndex + 3, byteLength: 12, sha256: "b".repeat(64) },
            ],
          },
        },
        {
          schemaVersion: 1,
          runId,
          agentId,
          invocationId,
          ordinal: 6,
          type: "git.commit",
          payload: {
            phase: "release-2-peer-revision",
            predecessor: firstTip,
            peerSnapshotDigest,
            tip: secondTip,
          },
        },
        {
          schemaVersion: 1,
          runId,
          agentId,
          invocationId,
          ordinal: 7,
          type: "git.push",
          payload: {
            phase: "release-2-peer-revision",
            ref: `refs/heads/quarantine/${agentId}/work`,
            tip: secondTip,
          },
        },
        {
          schemaVersion: 1,
          runId,
          agentId,
          invocationId,
          ordinal: 8,
          type: "git.fetch",
          payload: {
            snapshot: "frozen",
            refNamespace: "refs/heads/agents",
          },
        },
      ];
      return [agentId, events];
    }),
  );
  const revealObservation = (ordinal: 1 | 2) => ({
    boundary: { kind: "reveal", ordinal },
    scheduledOffsetMs: ordinal === 1 ? 0 : 100,
    actualOffsetMs: ordinal === 1 ? 1 : 101,
    driftMs: 1,
  });
  const eventRecords: Record<string, unknown>[] = [
    {
      sequence: 1,
      eventType: "lifecycle.transition",
      payload: { state: "RUNNING" },
    },
    ...agents.map((agentId, index) => ({
      runId,
      sequence: index + 2,
      producer: "reveal-control",
      effectId: `reveal-${agentId}-1`,
      eventType: "reveal.release",
      payload: { agentId, ordinal: 1, ...revealObservation(1) },
    })),
    ...ledgers
      .filter((_, index) => index % 2 === 0)
      .map((ledger, index) => ({
        sequence: index + 5,
        eventType: "git.admission",
        payload: {
          agentId: ledger.agentId,
          transactionId: ledger.transactionId,
          frameDigest: ledger.frameDigest,
          chargeBytes: ledger.chargeBytes,
          result: ledger.result,
        },
      })),
    {
      sequence: 8,
      producer: "git-gateway",
      effectId: "publication-001",
      eventType: "git.publication",
      payload: {
        snapshotId: collaborationPublication.snapshotId,
        refMapDigest: collaborationPublication.refMapDigest,
        boundary: { kind: "publication", ordinal: 1 },
      },
    },
    ...agents.map((agentId, index) => ({
      runId,
      sequence: index + 9,
      producer: "reveal-control",
      effectId: `reveal-${agentId}-2`,
      eventType: "reveal.release",
      payload: { agentId, ordinal: 2, ...revealObservation(2) },
    })),
    ...ledgers
      .filter((_, index) => index % 2 === 1)
      .map((ledger, index) => ({
        sequence: index + 12,
        eventType: "git.admission",
        payload: {
          agentId: ledger.agentId,
          transactionId: ledger.transactionId,
          frameDigest: ledger.frameDigest,
          chargeBytes: ledger.chargeBytes,
          result: ledger.result,
        },
      })),
    {
      sequence: 15,
      producer: "git-gateway",
      effectId: "publication-002",
      eventType: "git.publication",
      payload: {
        snapshotId: publication.snapshotId,
        refMapDigest: publication.refMapDigest,
        boundary: { kind: "publication", ordinal: 2 },
      },
    },
    { sequence: 16, eventType: "lifecycle.transition", payload: { state: "FROZEN" } },
    { sequence: 17, eventType: "lifecycle.transition", payload: { state: "FINALIZING" } },
    ...agents.map((agentId, index) => {
      const fetchRecord = fetchRecords.find(
        (record) =>
          record.agentId === agentId && record.tuple.snapshotId === publication.snapshotId,
      )!;
      return {
        sequence: index + 18,
        eventType: "worker.final-fetch",
        payload: {
          agentId,
          invocationId: `invocation-${agentId}`,
          ordinal: 8,
          snapshotId: fetchRecord.tuple.snapshotId,
          tupleDigest: fetchRecord.tuple.digest,
        },
      };
    }),
    ...submissions.map((submission, index) => ({
      sequence: index + 21,
      eventType: "submission.sealed",
      payload: {
        agentId: submission.agentId,
        freezeId: submission.freezeId,
        releasedShardDigest: submission.releasedShardDigest,
        manifestDigest: sha256Hex(canonicalJsonBytes(submission)),
      },
    })),
    { sequence: 24, eventType: "lifecycle.transition", payload: { state: "SUBMITTED" } },
  ];
  const run = {
    runId,
    freezeId: freeze.freezeId,
    schedulePolicy: {
      revealOffsetsMs: [0, 100],
      toleranceMs: 2_000,
    },
    scheduleObservations: [revealObservation(1), revealObservation(2)],
    containerEvidence: {
      gatewayPolicyEvidenceDigest: sha256Hex(canonicalJsonBytes(policy)),
      trustedDrainEvidenceDigest: sha256Hex(drainBytes),
      fetchPublicationEvidenceDigests: {
        collaboration: sha256Hex(collaborationFetchPublicationBytes),
        final: sha256Hex(fetchPublicationBytes),
      },
      canonicalFetchEvidenceDigest: sha256Hex(fetchBytes),
      hiddenPerAgentQuarantineRefs: true,
      transactionalGitAdmission: true,
      objectDatabaseMode: "per-agent-private",
    },
  };
  return {
    run,
    drain,
    drainBytes,
    ledgers,
    collaborationPublication,
    collaborationFetchPublication,
    collaborationFetchPublicationBytes,
    publication,
    fetchPublication,
    fetchPublicationBytes,
    fetches,
    fetchBytes,
    freeze,
    submissions,
    eventRecords,
    agentEvents,
  };
}

describe("offline harness completion evidence", () => {
  test("accepts only the inspected drain, exact collaboration events, and bound submissions", () => {
    expect(evaluateCompletionEvidence(fixture())).toEqual({
      trustedGitAdmission: true,
      publishedCollaborationSnapshot: true,
      progressiveRevealEvidence: true,
      finalFetchAndSubmissionEvidence: true,
    });
  });

  test("does not substitute self-declared gateway flags for inspected policy evidence", () => {
    const evidence = fixture();
    evidence.drain.policy.inspectedRepositories["agent-2"]!.quarantineRefCount = 1;
    evidence.drainBytes = canonicalJsonBytes(evidence.drain);
    const container = evidence.run.containerEvidence;
    container.trustedDrainEvidenceDigest = sha256Hex(evidence.drainBytes);
    container.gatewayPolicyEvidenceDigest = sha256Hex(canonicalJsonBytes(evidence.drain.policy));

    expect(evaluateCompletionEvidence(evidence).trustedGitAdmission).toBe(false);

    const unbounded = fixture();
    unbounded.drain.policy.resourceLimits.maxReceiveBodyBytes = 16_777_216;
    unbounded.drainBytes = canonicalJsonBytes(unbounded.drain);
    unbounded.run.containerEvidence.trustedDrainEvidenceDigest = sha256Hex(unbounded.drainBytes);
    unbounded.run.containerEvidence.gatewayPolicyEvidenceDigest = sha256Hex(
      canonicalJsonBytes(unbounded.drain.policy),
    );
    expect(evaluateCompletionEvidence(unbounded).trustedGitAdmission).toBe(false);

    const repositoryHooks = fixture();
    repositoryHooks.drain.policy.inspectedRepositories["agent-1"]!.hooksPath = "/git/agent-1/hooks";
    repositoryHooks.drainBytes = canonicalJsonBytes(repositoryHooks.drain);
    repositoryHooks.run.containerEvidence.trustedDrainEvidenceDigest = sha256Hex(
      repositoryHooks.drainBytes,
    );
    repositoryHooks.run.containerEvidence.gatewayPolicyEvidenceDigest = sha256Hex(
      canonicalJsonBytes(repositoryHooks.drain.policy),
    );
    expect(evaluateCompletionEvidence(repositoryHooks).trustedGitAdmission).toBe(false);
  });

  test("requires two matching admissions per agent and one final-fetch observation", () => {
    const extraAdmission = fixture();
    extraAdmission.eventRecords.push({
      ...extraAdmission.eventRecords.find((event) => event.eventType === "git.admission")!,
      sequence: 21,
    });
    expect(evaluateCompletionEvidence(extraAdmission).trustedGitAdmission).toBe(false);

    const missingFetch = fixture();
    missingFetch.eventRecords = missingFetch.eventRecords.filter(
      (event) =>
        event.eventType !== "worker.final-fetch" ||
        (event.payload as Record<string, unknown>).agentId !== "agent-3",
    );
    expect(evaluateCompletionEvidence(missingFetch).finalFetchAndSubmissionEvidence).toBe(false);
  });

  test("requires two ordered trusted reveals per agent with valid schedule observations", () => {
    const missingReveal = fixture();
    missingReveal.eventRecords = missingReveal.eventRecords.filter(
      (event) =>
        event.eventType !== "reveal.release" ||
        (event.payload as Record<string, unknown>).agentId !== "agent-3" ||
        (event.payload as Record<string, unknown>).ordinal !== 2,
    );
    expect(evaluateCompletionEvidence(missingReveal).progressiveRevealEvidence).toBe(false);

    const timingDrift = fixture();
    const reveal = timingDrift.eventRecords.find(
      (event) =>
        event.eventType === "reveal.release" &&
        (event.payload as Record<string, unknown>).agentId === "agent-2" &&
        (event.payload as Record<string, unknown>).ordinal === 2,
    )!;
    (reveal.payload as Record<string, unknown>).actualOffsetMs = 102;
    expect(evaluateCompletionEvidence(timingDrift).progressiveRevealEvidence).toBe(false);
  });

  test("binds each agent to ordered reads, initial analysis, revision, and push evidence", () => {
    const missingRead = fixture();
    missingRead.agentEvents["agent-1"] = missingRead.agentEvents["agent-1"]!.filter(
      (event) =>
        event.type !== "file.read" ||
        (event.payload as Record<string, unknown>).releaseOrdinal !== 1,
    );
    expect(evaluateCompletionEvidence(missingRead).progressiveRevealEvidence).toBe(false);

    const brokenRevision = fixture();
    const revision = brokenRevision.agentEvents["agent-2"]!.find(
      (event) =>
        event.type === "git.commit" &&
        (event.payload as Record<string, unknown>).phase === "release-2-peer-revision",
    )!;
    (revision.payload as Record<string, unknown>).predecessor = "f".repeat(64);
    expect(evaluateCompletionEvidence(brokenRevision).progressiveRevealEvidence).toBe(false);

    const replacedEvidence = fixture();
    const secondRead = replacedEvidence.agentEvents["agent-2"]!.find(
      (event) =>
        event.type === "file.read" &&
        (event.payload as Record<string, unknown>).releaseOrdinal === 2,
    )!;
    const chapters = (secondRead.payload as Record<string, unknown>).chapters as Record<
      string,
      unknown
    >[];
    chapters[0] = { chapterIndex: 99, byteLength: 10, sha256: "c".repeat(64) };
    expect(evaluateCompletionEvidence(replacedEvidence).progressiveRevealEvidence).toBe(false);

    const earlyPush = fixture();
    const trace = earlyPush.agentEvents["agent-3"]!;
    [trace[5], trace[6]] = [trace[6]!, trace[5]!];
    trace.forEach((event, index) => {
      event.ordinal = index + 1;
    });
    expect(evaluateCompletionEvidence(earlyPush).progressiveRevealEvidence).toBe(false);
  });

  test("rejects publication and sealed-submission binding mismatches", () => {
    const publicationMismatch = fixture();
    publicationMismatch.publication.snapshotId = "publication-untrusted";
    expect(evaluateCompletionEvidence(publicationMismatch).publishedCollaborationSnapshot).toBe(
      false,
    );

    const fetchPublicationMismatch = fixture();
    fetchPublicationMismatch.run.containerEvidence.fetchPublicationEvidenceDigests.collaboration =
      "f".repeat(64);
    expect(
      evaluateCompletionEvidence(fetchPublicationMismatch).finalFetchAndSubmissionEvidence,
    ).toBe(false);

    const submissionMismatch = fixture();
    submissionMismatch.submissions[1]!.releasedShardDigest = "f".repeat(64);
    expect(evaluateCompletionEvidence(submissionMismatch).finalFetchAndSubmissionEvidence).toBe(
      false,
    );

    const missingSeal = fixture();
    missingSeal.eventRecords = missingSeal.eventRecords.filter(
      (event) =>
        event.eventType !== "submission.sealed" ||
        (event.payload as Record<string, unknown>).agentId !== "agent-1",
    );
    expect(evaluateCompletionEvidence(missingSeal).finalFetchAndSubmissionEvidence).toBe(false);
  });
});
