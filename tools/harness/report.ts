import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes, sha256Hex, validateValue } from "@palimpsest/contracts";
import { ACCOUNTING_VERSION } from "@palimpsest/git-accounting";

import { sealAttempt, verifyTerminalAttempt, type AttemptClassification } from "./artifacts.js";
import {
  AGENT_IDS,
  attemptPath,
  FIXTURE_ADAPTER_ID,
  HARNESS_ROOT,
  RETAINED_COMMUNICATION_BUDGET_BYTES,
  type HarnessAttemptIdentity,
} from "./config.js";
import { identityFromArgs } from "./grade.js";
import { preflightBundle } from "./preflight.js";
import { validateReplayArtifacts } from "./replay.js";

function declarationDigest(value: Record<string, unknown>): string {
  return sha256Hex(canonicalJsonBytes(value));
}

function validSnapshotDigest(snapshot: Record<string, unknown>): boolean {
  const { snapshotDigest, ...identity } = snapshot;
  return (
    typeof snapshotDigest === "string" && snapshotDigest === sha256Hex(canonicalJsonBytes(identity))
  );
}

interface PolicyArtifact {
  path: string;
  byteLength: number;
  sha256: string;
}

const runtimePolicyPaths = [
  "containers/fixture-agent/Dockerfile",
  "containers/git-gateway/Dockerfile",
  "packages/git-gateway/src",
  "packages/run-control/src",
  "tools/harness/config.ts",
  "tools/harness/container-runtime.ts",
  "tools/harness/fixture-worker.ts",
  "tools/harness/git-server-container.ts",
  "tools/harness/git-server.ts",
  "tools/harness/publication-slots.ts",
  "tools/harness/run.ts",
] as const;

const graderPolicyPaths = [
  "containers/clean-solver/Dockerfile",
  "python/src/palimpsest/grading",
  "python/src/palimpsest/solver",
  "tools/harness/grade.ts",
] as const;

const evidencePolicyPaths = [
  "packages/contracts/schemas",
  "packages/contracts/src",
  "python/src/palimpsest/contracts",
  "python/src/palimpsest/replay",
  "tools/harness/artifacts.ts",
  "tools/harness/build.ts",
  "tools/harness/inputs.ts",
  "tools/harness/offline.ts",
  "tools/harness/preflight.ts",
  "tools/harness/replay.ts",
  "tools/harness/report.ts",
] as const;

const dependencyPolicyPaths = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "packages/contracts/package.json",
  "packages/git-accounting/package.json",
  "packages/git-gateway/package.json",
  "packages/run-control/package.json",
  "python/pyproject.toml",
  "python/uv.lock",
] as const;

async function policyArtifacts(root: string, paths: readonly string[]): Promise<PolicyArtifact[]> {
  const artifacts: PolicyArtifact[] = [];

  async function visit(path: string): Promise<void> {
    const absolute = resolve(root, path);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Execution policy input must not be a symbolic link: ${path}`);
    }
    if (metadata.isDirectory()) {
      const names = (await readdir(absolute)).sort();
      await Promise.all(names.map((name) => visit(`${path}/${name}`)));
      return;
    }
    if (!metadata.isFile()) {
      throw new Error(`Execution policy input must be a regular file: ${path}`);
    }
    const bytes = await readFile(absolute);
    artifacts.push({
      path: relative(root, absolute).split(sep).join("/"),
      byteLength: bytes.byteLength,
      sha256: sha256Hex(bytes),
    });
  }

  for (const path of paths) await visit(path);
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

function parsePinnedToolVersions(source: string): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (line === "") continue;
    const match = /^(?<tool>[a-z][a-z0-9-]*) (?<version>[^\s]+)$/.exec(line);
    if (!match?.groups) {
      throw new Error(`Pinned tool version line ${index + 1} is invalid.`);
    }
    if (versions[match.groups.tool!] !== undefined) {
      throw new Error(`Pinned tool version is duplicated: ${match.groups.tool}.`);
    }
    versions[match.groups.tool!] = match.groups.version!;
  }
  return versions;
}

function schedulePolicySource(source: string): string {
  const start = source.indexOf("const OFFLINE_SCHEDULE =");
  const terminator = "as const satisfies HarnessSchedule;";
  const end = source.indexOf(terminator, start);
  if (start < 0 || end < 0) {
    throw new Error("Offline runtime schedule policy declaration is missing.");
  }
  return source.slice(start, end + terminator.length);
}

async function executionPolicy(root: string): Promise<Record<string, unknown>> {
  const [
    imageLockBytes,
    scoringPolicyBytes,
    toolVersionsBytes,
    runtime,
    accounting,
    grader,
    evidence,
    dependencies,
  ] = await Promise.all([
    readFile(resolve(root, "containers/images.lock.json")),
    readFile(resolve(root, HARNESS_ROOT, "declared/trusted/scoring.json")),
    readFile(resolve(root, ".tool-versions")),
    policyArtifacts(root, runtimePolicyPaths),
    policyArtifacts(root, ["packages/git-accounting/src"]),
    policyArtifacts(root, graderPolicyPaths),
    policyArtifacts(root, evidencePolicyPaths),
    policyArtifacts(root, dependencyPolicyPaths),
  ]);
  const runSource = await readFile(resolve(root, "tools/harness/run.ts"), "utf8");
  const imageLock = JSON.parse(imageLockBytes.toString("utf8")) as Record<string, unknown>;
  const scoringPolicy = JSON.parse(scoringPolicyBytes.toString("utf8")) as Record<string, unknown>;

  return {
    schemaVersion: 1,
    runtime: {
      adapterId: FIXTURE_ADAPTER_ID,
      agentIds: [...AGENT_IDS],
      communicationBudgetBytes: RETAINED_COMMUNICATION_BUDGET_BYTES,
      sourceDigest: sha256Hex(canonicalJsonBytes(runtime)),
      schedulePolicyDigest: sha256Hex(Buffer.from(schedulePolicySource(runSource))),
    },
    containers: {
      imageLockDigest: sha256Hex(canonicalJsonBytes(imageLock)),
    },
    accounting: {
      contractId: "GitAccountingFrameV1",
      wireVersion: ACCOUNTING_VERSION,
      sourceDigest: sha256Hex(canonicalJsonBytes(accounting)),
    },
    grading: {
      scoringPolicyDigest: sha256Hex(canonicalJsonBytes(scoringPolicy)),
      sourceDigest: sha256Hex(canonicalJsonBytes(grader)),
    },
    evidence: {
      replayReportingAndContractDigest: sha256Hex(canonicalJsonBytes(evidence)),
    },
    dependencies: {
      lockAndManifestDigest: sha256Hex(canonicalJsonBytes(dependencies)),
    },
    pinnedToolVersions: parsePinnedToolVersions(toolVersionsBytes.toString("utf8")),
  };
}

function validScheduleEvidence(run: Record<string, unknown>): boolean {
  const policy = run.schedulePolicy as Record<string, unknown> | undefined;
  const observations = run.scheduleObservations;
  if (
    !policy ||
    !Array.isArray(observations) ||
    !Number.isSafeInteger(policy.toleranceMs) ||
    typeof policy.toleranceMs !== "number"
  ) {
    return false;
  }
  const expected = new Set([
    "reveal:1",
    "reveal:2",
    "publication:1",
    "publication:2",
    "push-close",
    "freeze",
    "finalization",
  ]);
  for (const value of observations) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const observation = value as Record<string, unknown>;
    const boundary = observation.boundary as Record<string, unknown> | undefined;
    if (!boundary || typeof boundary.kind !== "string") return false;
    const key =
      typeof boundary.ordinal === "number" ? `${boundary.kind}:${boundary.ordinal}` : boundary.kind;
    if (
      !expected.delete(key) ||
      typeof observation.driftMs !== "number" ||
      !Number.isFinite(observation.driftMs) ||
      Math.abs(observation.driftMs) > policy.toleranceMs
    ) {
      return false;
    }
  }
  return expected.size === 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactAgentRecords(
  values: readonly Record<string, unknown>[],
  agentId: (value: Record<string, unknown>) => unknown,
): boolean {
  if (values.length !== AGENT_IDS.length) return false;
  const agents = values.map(agentId);
  return (
    agents.every((value): value is string => typeof value === "string") &&
    new Set(agents).size === AGENT_IDS.length &&
    AGENT_IDS.every((expected) => agents.includes(expected))
  );
}

function exactAgentMultiplicity(
  values: readonly Record<string, unknown>[],
  agentId: (value: Record<string, unknown>) => unknown,
  count: number,
): boolean {
  return (
    values.length === AGENT_IDS.length * count &&
    AGENT_IDS.every(
      (expected) => values.filter((value) => agentId(value) === expected).length === count,
    )
  );
}

export function validAgentNetworkIsolationEvidence(value: unknown): boolean {
  const evidence = record(value);
  const gatewayContainerId = evidence?.gatewayContainerId;
  const gatewayNetworkIds = evidence?.gatewayNetworkIds;
  const agents = evidence?.agents;
  const dockerId = /^[0-9a-f]{64}$/;
  if (
    !evidence ||
    evidence.schemaVersion !== 1 ||
    evidence.mode !== "per-agent-internal-bridges" ||
    typeof gatewayContainerId !== "string" ||
    !dockerId.test(gatewayContainerId) ||
    !Array.isArray(gatewayNetworkIds) ||
    gatewayNetworkIds.length !== AGENT_IDS.length ||
    gatewayNetworkIds.some(
      (networkId) => typeof networkId !== "string" || !dockerId.test(networkId),
    ) ||
    new Set(gatewayNetworkIds).size !== AGENT_IDS.length ||
    !Array.isArray(agents)
  ) {
    return false;
  }
  const agentRecords = agents.map(record);
  if (
    agentRecords.some((agent) => !agent) ||
    !exactAgentRecords(agentRecords as Record<string, unknown>[], (agent) => agent.agentId)
  ) {
    return false;
  }
  const inspectedAgents = agentRecords as Record<string, unknown>[];
  const agentContainerIds = inspectedAgents.map((agent) => agent.containerId);
  const agentNetworkIds = inspectedAgents.map((agent) => agent.networkId);
  const agentNetworkNames = inspectedAgents.map((agent) => agent.networkName);
  if (
    agentContainerIds.some(
      (containerId) => typeof containerId !== "string" || !dockerId.test(containerId),
    ) ||
    new Set([gatewayContainerId, ...agentContainerIds]).size !== AGENT_IDS.length + 1 ||
    agentNetworkIds.some(
      (networkId) => typeof networkId !== "string" || !dockerId.test(networkId),
    ) ||
    new Set(agentNetworkIds).size !== AGENT_IDS.length ||
    agentNetworkNames.some(
      (networkName) => typeof networkName !== "string" || networkName.length === 0,
    ) ||
    new Set(agentNetworkNames).size !== AGENT_IDS.length ||
    !canonicalJsonBytes([...agentNetworkIds].sort()).equals(
      canonicalJsonBytes([...gatewayNetworkIds].sort()),
    )
  ) {
    return false;
  }
  return inspectedAgents.every((agent) => {
    const members = agent.memberContainerIds;
    return (
      agent.internal === true &&
      Array.isArray(members) &&
      members.length === 2 &&
      members.every((member) => typeof member === "string" && dockerId.test(member)) &&
      new Set(members).size === 2 &&
      canonicalJsonBytes([...members].sort()).equals(
        canonicalJsonBytes([gatewayContainerId, String(agent.containerId)].sort()),
      )
    );
  });
}

function eventPayload(event: Record<string, unknown>): Record<string, unknown> | undefined {
  return record(event.payload);
}

function eventSequence(event: Record<string, unknown>): number | undefined {
  return Number.isSafeInteger(event.sequence) && typeof event.sequence === "number"
    ? event.sequence
    : undefined;
}

function inspectedGatewayPolicy(
  run: Record<string, unknown>,
  drain: Record<string, unknown>,
  drainBytes: Buffer,
): boolean {
  const container = record(run.containerEvidence);
  const policy = record(drain.policy);
  const repositories = record(policy?.inspectedRepositories);
  const resourceLimits = record(policy?.resourceLimits);
  if (
    !container ||
    !policy ||
    !repositories ||
    drain.schemaVersion !== 1 ||
    drain.runId !== run.runId ||
    drain.pendingReceives !== 0 ||
    drain.pendingReservations !== 0 ||
    drain.ledgerEntryCount !== AGENT_IDS.length * 2 ||
    container.trustedDrainEvidenceDigest !== sha256Hex(drainBytes) ||
    container.gatewayPolicyEvidenceDigest !== sha256Hex(canonicalJsonBytes(policy)) ||
    policy.schemaVersion !== 2 ||
    policy.perAgentPrivateObjectDatabases !== true ||
    !resourceLimits ||
    !canonicalJsonBytes(resourceLimits).equals(
      canonicalJsonBytes({
        maxFetchesPerAgent: 2,
        maxReceiveAttemptsPerAgent: 2,
        maxReceiveBodyBytes: 8_388_608,
        receiveTimeoutMs: 30_000,
      }),
    ) ||
    !exactAgentRecords(
      Object.entries(repositories).map(([agentId, value]) => ({ agentId, value })),
      (entry) => entry.agentId,
    )
  ) {
    return false;
  }
  const evidence = AGENT_IDS.map((agentId) => record(repositories[agentId]));
  if (evidence.some((entry) => !entry)) return false;
  const inspected = evidence as Record<string, unknown>[];
  return (
    new Set(inspected.map((entry) => entry.gitDirectory)).size === AGENT_IDS.length &&
    new Set(inspected.map((entry) => entry.objectDirectory)).size === AGENT_IDS.length &&
    inspected.every(
      (entry) =>
        typeof entry.gitDirectory === "string" &&
        entry.gitDirectory.length > 0 &&
        typeof entry.objectDirectory === "string" &&
        entry.objectDirectory.length > 0 &&
        typeof entry.hooksPath === "string" &&
        entry.hooksPath.startsWith("/run/palimpsest-hooks/") &&
        Array.isArray(entry.alternates) &&
        entry.alternates.length === 0 &&
        Array.isArray(entry.receiveHiddenRefs) &&
        canonicalJsonBytes(entry.receiveHiddenRefs).equals(
          canonicalJsonBytes(["refs/heads/agents", "refs/heads/quarantine"]),
        ) &&
        Array.isArray(entry.uploadHiddenRefs) &&
        canonicalJsonBytes(entry.uploadHiddenRefs).equals(
          canonicalJsonBytes(["refs/heads/agents", "refs/heads/quarantine"]),
        ) &&
        entry.quarantineRefCount === 0,
    )
  );
}

function validAgentReleaseTrace(
  runId: unknown,
  agentId: (typeof AGENT_IDS)[number],
  events: Record<string, unknown>[],
): boolean {
  if (events.length === 0) return false;
  const invocationIds = new Set<unknown>();
  for (const [index, event] of events.entries()) {
    if (
      event.schemaVersion !== 1 ||
      event.runId !== runId ||
      event.agentId !== agentId ||
      typeof event.invocationId !== "string" ||
      event.invocationId.length === 0 ||
      event.ordinal !== index + 1 ||
      !eventPayload(event)
    ) {
      return false;
    }
    invocationIds.add(event.invocationId);
  }
  if (invocationIds.size !== 1) return false;

  const reads = events.filter((event) => event.type === "file.read");
  const commits = events.filter((event) => event.type === "git.commit");
  const pushes = events.filter((event) => event.type === "git.push");
  const fetches = events.filter((event) => event.type === "git.fetch");
  if (reads.length !== 2 || commits.length !== 2 || pushes.length !== 2 || fetches.length !== 2) {
    return false;
  }
  const [firstRead, secondRead] = reads;
  const [firstCommit, secondCommit] = commits;
  const [firstPush, secondPush] = pushes;
  const [collaborationFetch, finalFetch] = fetches;
  if (
    !firstRead ||
    !secondRead ||
    !firstCommit ||
    !secondCommit ||
    !firstPush ||
    !secondPush ||
    !collaborationFetch ||
    !finalFetch
  ) {
    return false;
  }
  const firstReadPayload = eventPayload(firstRead);
  const secondReadPayload = eventPayload(secondRead);
  const firstCommitPayload = eventPayload(firstCommit);
  const secondCommitPayload = eventPayload(secondCommit);
  const firstPushPayload = eventPayload(firstPush);
  const secondPushPayload = eventPayload(secondPush);
  const collaborationFetchPayload = eventPayload(collaborationFetch);
  const finalFetchPayload = eventPayload(finalFetch);
  if (
    !firstReadPayload ||
    !secondReadPayload ||
    !firstCommitPayload ||
    !secondCommitPayload ||
    !firstPushPayload ||
    !secondPushPayload ||
    !collaborationFetchPayload ||
    !finalFetchPayload
  ) {
    return false;
  }
  const firstTip = firstCommitPayload.tip;
  const secondTip = secondCommitPayload.tip;
  const validChapter = (value: unknown): value is Record<string, unknown> => {
    const chapter = record(value);
    return (
      chapter !== undefined &&
      Number.isSafeInteger(chapter.chapterIndex) &&
      typeof chapter.chapterIndex === "number" &&
      chapter.chapterIndex >= 0 &&
      Number.isSafeInteger(chapter.byteLength) &&
      typeof chapter.byteLength === "number" &&
      chapter.byteLength >= 0 &&
      typeof chapter.sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(chapter.sha256)
    );
  };
  const firstChapters = Array.isArray(firstReadPayload.chapters)
    ? firstReadPayload.chapters.filter(validChapter)
    : [];
  const secondChapters = Array.isArray(secondReadPayload.chapters)
    ? secondReadPayload.chapters.filter(validChapter)
    : [];
  const firstReadIndex = events.indexOf(firstRead);
  const firstCommitIndex = events.indexOf(firstCommit);
  const secondReadIndex = events.indexOf(secondRead);
  const secondCommitIndex = events.indexOf(secondCommit);
  const firstPushIndex = events.indexOf(firstPush);
  const collaborationFetchIndex = events.indexOf(collaborationFetch);
  const secondPushIndex = events.indexOf(secondPush);
  const finalFetchIndex = events.indexOf(finalFetch);
  const peerSnapshotDigest = collaborationFetchPayload.refDigest;
  return (
    firstReadPayload.path === "input/released/release-manifest.json" &&
    firstReadPayload.releaseOrdinal === 1 &&
    Array.isArray(firstReadPayload.chapters) &&
    firstChapters.length > 0 &&
    firstChapters.length === firstReadPayload.chapters.length &&
    secondReadPayload.path === "input/released/release-manifest.json" &&
    secondReadPayload.releaseOrdinal === 2 &&
    Array.isArray(secondReadPayload.chapters) &&
    secondChapters.length === secondReadPayload.chapters.length &&
    secondChapters.length > firstChapters.length &&
    firstChapters.every((chapter) =>
      secondChapters.some((candidate) =>
        canonicalJsonBytes(candidate).equals(canonicalJsonBytes(chapter)),
      ),
    ) &&
    firstCommitPayload.phase === "release-1" &&
    typeof firstTip === "string" &&
    /^[0-9a-f]{64}$/.test(firstTip) &&
    firstPushPayload.phase === "release-1" &&
    firstPushPayload.ref === `refs/heads/quarantine/${agentId}/work` &&
    firstPushPayload.tip === firstTip &&
    collaborationFetchPayload.snapshot === "collaboration" &&
    collaborationFetchPayload.refNamespace === "refs/heads/agents" &&
    collaborationFetchPayload.refCount === AGENT_IDS.length &&
    typeof peerSnapshotDigest === "string" &&
    /^[0-9a-f]{64}$/.test(peerSnapshotDigest) &&
    secondCommitPayload.phase === "release-2-peer-revision" &&
    secondCommitPayload.predecessor === firstTip &&
    secondCommitPayload.peerSnapshotDigest === peerSnapshotDigest &&
    typeof secondTip === "string" &&
    /^[0-9a-f]{64}$/.test(secondTip) &&
    secondTip !== firstTip &&
    secondPushPayload.phase === "release-2-peer-revision" &&
    secondPushPayload.ref === `refs/heads/quarantine/${agentId}/work` &&
    secondPushPayload.tip === secondTip &&
    finalFetchPayload.snapshot === "frozen" &&
    finalFetchPayload.refNamespace === "refs/heads/agents" &&
    firstReadIndex < firstCommitIndex &&
    firstCommitIndex < firstPushIndex &&
    firstPushIndex < collaborationFetchIndex &&
    collaborationFetchIndex < secondReadIndex &&
    secondReadIndex < secondCommitIndex &&
    secondCommitIndex < secondPushIndex &&
    secondPushIndex < finalFetchIndex
  );
}

function progressiveRevealEvidence(options: {
  run: Record<string, unknown>;
  eventRecords: Record<string, unknown>[];
  agentEvents: Record<string, Record<string, unknown>[]>;
}): boolean {
  const { run, eventRecords, agentEvents } = options;
  const schedule = record(run.schedulePolicy);
  const scheduleObservations = Array.isArray(run.scheduleObservations)
    ? run.scheduleObservations
        .map((value) => record(value))
        .filter((value): value is Record<string, unknown> => value !== undefined)
    : [];
  const revealOffsets = schedule?.revealOffsetsMs;
  const toleranceMs = schedule?.toleranceMs;
  if (
    !Array.isArray(revealOffsets) ||
    revealOffsets.length !== 2 ||
    !revealOffsets.every(
      (offset, index) =>
        Number.isSafeInteger(offset) &&
        typeof offset === "number" &&
        offset >= 0 &&
        (index === 0 || offset > (revealOffsets[index - 1] as number)),
    ) ||
    !Number.isSafeInteger(toleranceMs) ||
    typeof toleranceMs !== "number" ||
    toleranceMs < 0
  ) {
    return false;
  }
  const runningEvents = eventRecords.filter(
    (event) =>
      event.eventType === "lifecycle.transition" && eventPayload(event)?.state === "RUNNING",
  );
  const runningSequence = runningEvents[0] ? eventSequence(runningEvents[0]) : undefined;
  const revealEvents = eventRecords.filter((event) => event.eventType === "reveal.release");
  if (runningEvents.length !== 1 || runningSequence === undefined || revealEvents.length !== 6) {
    return false;
  }

  const revealSequencesByOrdinal = new Map<number, number[]>();
  const observationsByOrdinal = new Map<number, Buffer>();
  for (const event of revealEvents) {
    const payload = eventPayload(event);
    const sequence = eventSequence(event);
    const boundary = record(payload?.boundary);
    const agentId = payload?.agentId;
    const ordinal = payload?.ordinal;
    const scheduledOffsetMs = payload?.scheduledOffsetMs;
    const actualOffsetMs = payload?.actualOffsetMs;
    const driftMs = payload?.driftMs;
    if (
      !payload ||
      sequence === undefined ||
      sequence <= runningSequence ||
      event.producer !== "reveal-control" ||
      typeof agentId !== "string" ||
      !AGENT_IDS.includes(agentId as (typeof AGENT_IDS)[number]) ||
      (ordinal !== 1 && ordinal !== 2) ||
      event.effectId !== `reveal-${agentId}-${ordinal}` ||
      boundary?.kind !== "reveal" ||
      boundary.ordinal !== ordinal ||
      typeof scheduledOffsetMs !== "number" ||
      scheduledOffsetMs !== revealOffsets[ordinal - 1] ||
      typeof actualOffsetMs !== "number" ||
      !Number.isFinite(actualOffsetMs) ||
      actualOffsetMs < 0 ||
      typeof driftMs !== "number" ||
      !Number.isFinite(driftMs) ||
      driftMs !== actualOffsetMs - scheduledOffsetMs ||
      Math.abs(driftMs) > toleranceMs
    ) {
      return false;
    }
    const sequences = revealSequencesByOrdinal.get(ordinal) ?? [];
    sequences.push(sequence);
    revealSequencesByOrdinal.set(ordinal, sequences);
    const observation = canonicalJsonBytes({
      boundary,
      scheduledOffsetMs,
      actualOffsetMs,
      driftMs,
    });
    const prior = observationsByOrdinal.get(ordinal);
    if (prior && !prior.equals(observation)) return false;
    observationsByOrdinal.set(ordinal, observation);
  }

  for (const ordinal of [1, 2]) {
    const events = revealEvents.filter((event) => eventPayload(event)?.ordinal === ordinal);
    if (!exactAgentRecords(events, (event) => eventPayload(event)?.agentId)) return false;
    const recorded = scheduleObservations.filter((observation) => {
      const boundary = record(observation.boundary);
      return boundary?.kind === "reveal" && boundary.ordinal === ordinal;
    });
    if (
      recorded.length !== 1 ||
      !observationsByOrdinal.get(ordinal)?.equals(canonicalJsonBytes(recorded[0]))
    ) {
      return false;
    }
  }
  const firstSequences = revealSequencesByOrdinal.get(1) ?? [];
  const secondSequences = revealSequencesByOrdinal.get(2) ?? [];
  if (
    firstSequences.length !== AGENT_IDS.length ||
    secondSequences.length !== AGENT_IDS.length ||
    Math.max(...firstSequences) >= Math.min(...secondSequences)
  ) {
    return false;
  }

  return (
    Object.keys(agentEvents).length === AGENT_IDS.length &&
    AGENT_IDS.every((agentId) =>
      validAgentReleaseTrace(run.runId, agentId, agentEvents[agentId] ?? []),
    )
  );
}

export function evaluateCompletionEvidence(options: {
  run: Record<string, unknown>;
  drain: Record<string, unknown>;
  drainBytes: Buffer;
  ledgers: Record<string, unknown>[];
  collaborationPublication: Record<string, unknown>;
  collaborationFetchPublication: Record<string, unknown>;
  collaborationFetchPublicationBytes: Buffer;
  publication: Record<string, unknown>;
  fetchPublication: Record<string, unknown>;
  fetchPublicationBytes: Buffer;
  fetches: Record<string, unknown>;
  fetchBytes: Buffer;
  freeze: Record<string, unknown>;
  submissions: Record<string, unknown>[];
  eventRecords: Record<string, unknown>[];
  agentEvents: Record<string, Record<string, unknown>[]>;
}): {
  trustedGitAdmission: boolean;
  publishedCollaborationSnapshot: boolean;
  progressiveRevealEvidence: boolean;
  finalFetchAndSubmissionEvidence: boolean;
} {
  const {
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
  } = options;
  const admissionEvents = eventRecords.filter((event) => event.eventType === "git.admission");
  const admissionSequences = admissionEvents
    .map(eventSequence)
    .filter((value): value is number => value !== undefined);
  const trustedGitAdmission =
    inspectedGatewayPolicy(run, drain, drainBytes) &&
    exactAgentMultiplicity(ledgers, (ledger) => ledger.agentId, 2) &&
    ledgers.every(
      (ledger) =>
        ledger.runId === run.runId &&
        ledger.result === "accepted" &&
        typeof ledger.frameDigest === "string" &&
        /^[0-9a-f]{64}$/.test(ledger.frameDigest) &&
        typeof ledger.transactionId === "string" &&
        ledger.transactionId === `${String(ledger.agentId)}-push-${ledger.frameDigest}` &&
        Number.isSafeInteger(ledger.chargeBytes) &&
        typeof ledger.chargeBytes === "number" &&
        ledger.chargeBytes >= 0,
    ) &&
    exactAgentMultiplicity(admissionEvents, (event) => eventPayload(event)?.agentId, 2) &&
    admissionEvents.every((event) => {
      const payload = eventPayload(event);
      const ledger = ledgers.find(
        (entry) =>
          entry.agentId === payload?.agentId && entry.transactionId === payload?.transactionId,
      );
      return (
        payload !== undefined &&
        ledger !== undefined &&
        payload.transactionId === ledger.transactionId &&
        payload.frameDigest === ledger.frameDigest &&
        payload.chargeBytes === ledger.chargeBytes &&
        payload.result === ledger.result
      );
    });

  const publicationEvents = eventRecords.filter((event) => event.eventType === "git.publication");
  const collaborationPublicationEvent = publicationEvents[0];
  const publicationEvent = publicationEvents[1];
  const collaborationPublicationPayload = collaborationPublicationEvent
    ? eventPayload(collaborationPublicationEvent)
    : undefined;
  const publicationPayload = publicationEvent ? eventPayload(publicationEvent) : undefined;
  const collaborationPublicationSequence = collaborationPublicationEvent
    ? eventSequence(collaborationPublicationEvent)
    : undefined;
  const publicationSequence = publicationEvent ? eventSequence(publicationEvent) : undefined;
  const frozenEvents = eventRecords.filter(
    (event) =>
      event.eventType === "lifecycle.transition" && eventPayload(event)?.state === "FROZEN",
  );
  const frozenEvent = frozenEvents[0];
  const frozenSequence = frozenEvent ? eventSequence(frozenEvent) : undefined;
  const admissionBeforeCollaboration = admissionEvents.filter((event) => {
    const sequence = eventSequence(event);
    return (
      typeof sequence === "number" &&
      typeof collaborationPublicationSequence === "number" &&
      sequence < collaborationPublicationSequence
    );
  });
  const admissionBeforeFinal = admissionEvents.filter((event) => {
    const sequence = eventSequence(event);
    return (
      typeof sequence === "number" &&
      typeof collaborationPublicationSequence === "number" &&
      typeof publicationSequence === "number" &&
      sequence > collaborationPublicationSequence &&
      sequence < publicationSequence
    );
  });
  const secondRevealEvents = eventRecords.filter(
    (event) => event.eventType === "reveal.release" && eventPayload(event)?.ordinal === 2,
  );
  const secondRevealSequences = secondRevealEvents
    .map(eventSequence)
    .filter((value): value is number => value !== undefined);
  const admissionBeforeFinalSequences = admissionBeforeFinal
    .map(eventSequence)
    .filter((value): value is number => value !== undefined);
  const collaborationBoundary = record(collaborationPublicationPayload?.boundary);
  const finalBoundary = record(publicationPayload?.boundary);
  const publishedCollaborationSnapshot =
    publicationEvents.length === 2 &&
    collaborationPublication.runId === run.runId &&
    collaborationPublication.contractId === "published-snapshot" &&
    collaborationPublication.ordinal === 1 &&
    collaborationPublication.predecessorSnapshotId === null &&
    validSnapshotDigest(collaborationPublication) &&
    collaborationPublicationEvent?.producer === "git-gateway" &&
    collaborationPublicationEvent.effectId === "publication-001" &&
    collaborationPublicationPayload !== undefined &&
    collaborationPublicationPayload.snapshotId === collaborationPublication.snapshotId &&
    collaborationPublicationPayload.refMapDigest === collaborationPublication.refMapDigest &&
    collaborationBoundary?.kind === "publication" &&
    collaborationBoundary.ordinal === 1 &&
    typeof collaborationPublicationSequence === "number" &&
    Number.isSafeInteger(collaborationPublication.eventSequence) &&
    typeof collaborationPublication.eventSequence === "number" &&
    collaborationPublicationSequence === collaborationPublication.eventSequence + 1 &&
    publication.runId === run.runId &&
    publication.contractId === "published-snapshot" &&
    publication.ordinal === 2 &&
    publication.predecessorSnapshotId === collaborationPublication.snapshotId &&
    validSnapshotDigest(publication) &&
    publicationEvent?.producer === "git-gateway" &&
    publicationEvent.effectId === "publication-002" &&
    publicationPayload !== undefined &&
    publicationPayload.snapshotId === publication.snapshotId &&
    publicationPayload.refMapDigest === publication.refMapDigest &&
    finalBoundary?.kind === "publication" &&
    finalBoundary.ordinal === 2 &&
    typeof publicationSequence === "number" &&
    collaborationPublicationSequence < publicationSequence &&
    collaborationPublication.snapshotId !== publication.snapshotId &&
    collaborationPublication.refMapDigest !== publication.refMapDigest &&
    admissionSequences.length === AGENT_IDS.length * 2 &&
    exactAgentRecords(admissionBeforeCollaboration, (event) => eventPayload(event)?.agentId) &&
    exactAgentRecords(admissionBeforeFinal, (event) => eventPayload(event)?.agentId) &&
    exactAgentRecords(secondRevealEvents, (event) => eventPayload(event)?.agentId) &&
    secondRevealSequences.length === AGENT_IDS.length &&
    admissionBeforeFinalSequences.length === AGENT_IDS.length &&
    collaborationPublicationSequence < Math.min(...secondRevealSequences) &&
    Math.max(...secondRevealSequences) < Math.min(...admissionBeforeFinalSequences) &&
    Number.isSafeInteger(publication.eventSequence) &&
    typeof publication.eventSequence === "number" &&
    publicationSequence === publication.eventSequence + 1 &&
    freeze.runId === run.runId &&
    freeze.freezeId === run.freezeId &&
    freeze.refMapDigest === publication.refMapDigest &&
    freeze.visibilityJournalDigest === publication.visibilityJournalDigest &&
    frozenEvents.length === 1 &&
    typeof frozenSequence === "number" &&
    publicationSequence < frozenSequence &&
    Number.isSafeInteger(freeze.finalEventSequence) &&
    typeof freeze.finalEventSequence === "number" &&
    frozenSequence === freeze.finalEventSequence + 1;

  const finalizingEvents = eventRecords.filter(
    (event) =>
      event.eventType === "lifecycle.transition" && eventPayload(event)?.state === "FINALIZING",
  );
  const submittedEvents = eventRecords.filter(
    (event) =>
      event.eventType === "lifecycle.transition" && eventPayload(event)?.state === "SUBMITTED",
  );
  const finalizingEvent = finalizingEvents[0];
  const submittedEvent = submittedEvents[0];
  const finalizingSequence = finalizingEvent ? eventSequence(finalizingEvent) : undefined;
  const submittedSequence = submittedEvent ? eventSequence(submittedEvent) : undefined;
  const finalFetchEvents = eventRecords.filter((event) => event.eventType === "worker.final-fetch");
  const container = record(run.containerEvidence);
  const fetchPublicationEvidenceDigests = record(container?.fetchPublicationEvidenceDigests);
  const collaborationFetchSnapshot = record(collaborationFetchPublication.snapshot);
  const fetchSnapshot = record(fetchPublication.snapshot);
  const collaborationFetchRefs = record(collaborationFetchPublication.refs);
  const fetchRefs = record(fetchPublication.refs);
  const admittedFetchCounts = record(fetches.admittedFetchCounts);
  const fetchRecords = Array.isArray(fetches.fetches)
    ? fetches.fetches
        .map((value) => record(value))
        .filter((value): value is Record<string, unknown> => value !== undefined)
    : [];
  const snapshotIds = [collaborationPublication.snapshotId, publication.snapshotId];
  const canonicalFetchEvidence =
    fetchPublicationEvidenceDigests?.collaboration ===
      sha256Hex(collaborationFetchPublicationBytes) &&
    fetchPublicationEvidenceDigests?.final === sha256Hex(fetchPublicationBytes) &&
    container?.canonicalFetchEvidenceDigest === sha256Hex(fetchBytes) &&
    collaborationFetchPublication.schemaVersion === 1 &&
    collaborationFetchPublication.slot === "collaboration" &&
    collaborationFetchPublication.maxFetchesPerAgent === 2 &&
    collaborationFetchRefs !== undefined &&
    sha256Hex(canonicalJsonBytes(collaborationFetchRefs)) ===
      collaborationPublication.refMapDigest &&
    collaborationFetchSnapshot?.snapshotId === collaborationPublication.snapshotId &&
    collaborationFetchSnapshot?.refMapDigest === collaborationPublication.refMapDigest &&
    collaborationFetchSnapshot?.visibilityJournalDigest ===
      collaborationPublication.visibilityJournalDigest &&
    canonicalJsonBytes(collaborationFetchSnapshot).equals(
      canonicalJsonBytes(collaborationPublication),
    ) &&
    fetchPublication.schemaVersion === 1 &&
    fetchPublication.slot === "final" &&
    fetchPublication.maxFetchesPerAgent === 2 &&
    fetchRefs !== undefined &&
    sha256Hex(canonicalJsonBytes(fetchRefs)) === publication.refMapDigest &&
    fetchSnapshot?.snapshotId === publication.snapshotId &&
    fetchSnapshot?.refMapDigest === publication.refMapDigest &&
    fetchSnapshot?.visibilityJournalDigest === publication.visibilityJournalDigest &&
    canonicalJsonBytes(fetchSnapshot).equals(canonicalJsonBytes(publication)) &&
    fetches.runId === run.runId &&
    fetches.maxFetchesPerAgent === 2 &&
    admittedFetchCounts !== undefined &&
    AGENT_IDS.every((agentId) => admittedFetchCounts[agentId] === 2) &&
    exactAgentMultiplicity(fetchRecords, (fetch) => fetch.agentId, 2) &&
    fetchRecords.every((fetch, index) => {
      const tuple = record(fetch.tuple);
      if (!tuple || fetch.sequence !== index + 1 || !snapshotIds.includes(tuple.snapshotId)) {
        return false;
      }
      const digest = tuple.digest;
      const tupleBody = {
        snapshotId: tuple.snapshotId,
        wants: tuple.wants,
        haves: tuple.haves,
        capabilityProfile: tuple.capabilityProfile,
      };
      return (
        Array.isArray(tuple.wants) &&
        tuple.wants.length >= 1 &&
        Array.isArray(tuple.haves) &&
        Array.isArray(tuple.capabilityProfile) &&
        typeof digest === "string" &&
        digest === sha256Hex(canonicalJsonBytes(tupleBody))
      );
    }) &&
    AGENT_IDS.every((agentId) => {
      const agentSnapshotIds = fetchRecords
        .filter((fetch) => fetch.agentId === agentId)
        .sort((left, right) => Number(left.sequence) - Number(right.sequence))
        .map((fetch) => record(fetch.tuple)?.snapshotId);
      return canonicalJsonBytes(agentSnapshotIds).equals(canonicalJsonBytes(snapshotIds));
    });
  const sealedEvents = eventRecords.filter((event) => event.eventType === "submission.sealed");
  const shardBindings = Array.isArray(freeze.finalReleasedShards)
    ? freeze.finalReleasedShards
        .map((value) => record(value))
        .filter((value): value is Record<string, unknown> => value !== undefined)
    : [];
  const sequences = (events: Record<string, unknown>[]): number[] =>
    events.map(eventSequence).filter((value): value is number => value !== undefined);
  const finalFetchSequences = sequences(finalFetchEvents);
  const sealedSequences = sequences(sealedEvents);
  const finalFetchAndSubmissionEvidence =
    canonicalFetchEvidence &&
    exactAgentRecords(finalFetchEvents, (event) => eventPayload(event)?.agentId) &&
    finalFetchEvents.every((event) => {
      const payload = eventPayload(event);
      const fetch = fetchRecords.find(
        (fetchRecord) =>
          fetchRecord.agentId === payload?.agentId &&
          record(fetchRecord.tuple)?.snapshotId === publication.snapshotId,
      );
      const tuple = record(fetch?.tuple);
      return (
        typeof payload?.invocationId === "string" &&
        payload.invocationId.length > 0 &&
        Number.isSafeInteger(payload.ordinal) &&
        typeof payload.ordinal === "number" &&
        payload.ordinal >= 1 &&
        payload.snapshotId === tuple?.snapshotId &&
        payload.tupleDigest === tuple?.digest
      );
    }) &&
    exactAgentRecords(shardBindings, (binding) => binding.agentId) &&
    shardBindings.every((binding) => {
      const manifest = record(binding.manifest);
      return (
        manifest?.artifactType === "released-shard-manifest" &&
        Number.isSafeInteger(manifest.byteLength) &&
        typeof manifest.byteLength === "number" &&
        manifest.byteLength >= 0 &&
        typeof manifest.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(manifest.sha256)
      );
    }) &&
    exactAgentRecords(submissions, (submission) => submission.agentId) &&
    submissions.every((submission) => {
      const binding = shardBindings.find((entry) => entry.agentId === submission.agentId);
      const manifest = record(binding?.manifest);
      return (
        submission.runId === run.runId &&
        submission.freezeId === freeze.freezeId &&
        submission.releasedShardDigest === manifest?.sha256
      );
    }) &&
    exactAgentRecords(sealedEvents, (event) => eventPayload(event)?.agentId) &&
    sealedEvents.every((event) => {
      const payload = eventPayload(event);
      const submission = submissions.find((entry) => entry.agentId === payload?.agentId);
      return (
        submission !== undefined &&
        payload !== undefined &&
        payload.freezeId === submission.freezeId &&
        payload.releasedShardDigest === submission.releasedShardDigest &&
        payload.manifestDigest === sha256Hex(canonicalJsonBytes(submission))
      );
    }) &&
    finalizingEvents.length === 1 &&
    submittedEvents.length === 1 &&
    typeof finalizingSequence === "number" &&
    typeof submittedSequence === "number" &&
    finalFetchSequences.length === AGENT_IDS.length &&
    sealedSequences.length === AGENT_IDS.length &&
    finalFetchSequences.every((sequence) => sequence > finalizingSequence) &&
    Math.max(...finalFetchSequences) < Math.min(...sealedSequences) &&
    sealedSequences.every((sequence) => sequence < submittedSequence);
  return {
    trustedGitAdmission,
    publishedCollaborationSnapshot,
    progressiveRevealEvidence: progressiveRevealEvidence({ run, eventRecords, agentEvents }),
    finalFetchAndSubmissionEvidence,
  };
}

export async function buildPredeclaration(root = "."): Promise<Record<string, unknown>> {
  const resolvedRoot = resolve(root);
  const bundle = await preflightBundle(resolve(resolvedRoot, HARNESS_ROOT, "declared"));
  const inputs = JSON.parse(
    await readFile(resolve(resolvedRoot, HARNESS_ROOT, "inputs", "manifest.json"), "utf8"),
  );
  const declaration = {
    schemaVersion: 1,
    contractId: "offline-harness-report",
    state: "predeclared",
    declarationDigest: "",
    runId: "pending",
    result: "pending",
    completedStages: ["build"],
    externalModelRequestCount: 0,
    liveModelValidationAuthorized: false,
    empiricalModelEvidence: false,
  };
  const digestInputs = {
    schemaVersion: 1,
    bundleId: bundle.bundleId,
    inputManifestDigest: sha256Hex(canonicalJsonBytes(inputs)),
    executionPolicy: await executionPolicy(resolvedRoot),
    modelProviderPolicy: "external-requests-forbidden",
  };
  declaration.declarationDigest = declarationDigest(digestInputs);
  const verdict = validateValue("offline-harness-report", declaration);
  if (!verdict.accepted) {
    throw new Error(`Predeclaration is invalid: ${verdict.reason} at ${verdict.pointer}`);
  }
  return { ...declaration, declarationInputs: digestInputs };
}

export async function writePredeclaration(root = "."): Promise<Record<string, unknown>> {
  const value = await buildPredeclaration(root);
  const report = { ...value };
  delete report.declarationInputs;
  const path = resolve(root, HARNESS_ROOT, "predeclaration.json");
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, canonicalJsonBytes(report));
  return report;
}

export async function checkPredeclaration(root = "."): Promise<Record<string, unknown>> {
  const expectedWithInputs = await buildPredeclaration(root);
  const expected = { ...expectedWithInputs };
  delete expected.declarationInputs;
  const actual = JSON.parse(
    await readFile(resolve(root, HARNESS_ROOT, "predeclaration.json"), "utf8"),
  );
  if (!canonicalJsonBytes(actual).equals(canonicalJsonBytes(expected))) {
    throw new Error("Frozen offline harness predeclaration does not match current inputs.");
  }
  const verdict = validateValue("offline-harness-report", actual);
  if (!verdict.accepted) {
    throw new Error(`Frozen predeclaration is invalid: ${verdict.reason} at ${verdict.pointer}`);
  }
  return actual;
}

export async function completeAttempt(
  identity: HarnessAttemptIdentity,
  root = ".",
  options: { priorIdentity?: HarnessAttemptIdentity } = {},
): Promise<Record<string, unknown>> {
  const attempt = attemptPath(resolve(root, HARNESS_ROOT), identity);
  const required = [
    "run-manifest.json",
    "run-result.json",
    "live.jsonl",
    "git/drain.json",
    "git/fetch-publication-001.json",
    "git/fetch-publication-002.json",
    "git/fetches.json",
    "git/freeze.json",
    "git/frozen.bundle",
    "git/ledgers.json",
    "git/publication-001.json",
    "git/publication-002.json",
    "agents/agent-1/events.json",
    "agents/agent-2/events.json",
    "agents/agent-3/events.json",
    "submissions.json",
    "grading/solver-executions.json",
    "grading/score-report.json",
    "replay/trusted-replay.json",
    "replay/verdict.json",
    "public/report.json",
  ];
  await Promise.all(required.map((path) => readFile(resolve(attempt, path))));
  const predeclaration = await checkPredeclaration(root);
  if (predeclaration.declarationDigest !== identity.declarationDigest) {
    throw new Error("Completion identity does not match the frozen predeclaration.");
  }
  await validateReplayArtifacts(identity, root);
  const run = JSON.parse(await readFile(resolve(attempt, "run-result.json"), "utf8"));
  const eventRecords = (await readFile(resolve(attempt, "live.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  if (run.runId !== identity.runId || run.declarationDigest !== identity.declarationDigest) {
    throw new Error("Run result does not match the explicit completion identity.");
  }
  const externalModelRequestCount = run.externalModelRequestCount;
  if (!Number.isInteger(externalModelRequestCount) || externalModelRequestCount < 0) {
    throw new Error("Run result has an invalid external model request count.");
  }
  const executions = JSON.parse(
    await readFile(resolve(attempt, "grading/solver-executions.json"), "utf8"),
  ) as Record<string, unknown>[];
  const imageLock = JSON.parse(
    await readFile(resolve(root, "containers/images.lock.json"), "utf8"),
  );
  const container = run.containerEvidence;
  const ledgers = JSON.parse(
    await readFile(resolve(attempt, "git/ledgers.json"), "utf8"),
  ) as Record<string, unknown>[];
  const drainBytes = await readFile(resolve(attempt, "git/drain.json"));
  const drain = JSON.parse(drainBytes.toString("utf8")) as Record<string, unknown>;
  const collaborationPublication = JSON.parse(
    await readFile(resolve(attempt, "git/publication-001.json"), "utf8"),
  ) as Record<string, unknown>;
  const collaborationFetchPublicationBytes = await readFile(
    resolve(attempt, "git/fetch-publication-001.json"),
  );
  const collaborationFetchPublication = JSON.parse(
    collaborationFetchPublicationBytes.toString("utf8"),
  ) as Record<string, unknown>;
  const publication = JSON.parse(
    await readFile(resolve(attempt, "git/publication-002.json"), "utf8"),
  ) as Record<string, unknown>;
  const fetchPublicationBytes = await readFile(resolve(attempt, "git/fetch-publication-002.json"));
  const fetchPublication = JSON.parse(fetchPublicationBytes.toString("utf8")) as Record<
    string,
    unknown
  >;
  const fetchBytes = await readFile(resolve(attempt, "git/fetches.json"));
  const fetches = JSON.parse(fetchBytes.toString("utf8")) as Record<string, unknown>;
  const freeze = JSON.parse(await readFile(resolve(attempt, "git/freeze.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const submissions = JSON.parse(
    await readFile(resolve(attempt, "submissions.json"), "utf8"),
  ) as Record<string, unknown>[];
  const agentEvents = Object.fromEntries(
    await Promise.all(
      AGENT_IDS.map(async (agentId) => [
        agentId,
        JSON.parse(
          await readFile(resolve(attempt, "agents", agentId, "events.json"), "utf8"),
        ) as Record<string, unknown>[],
      ]),
    ),
  ) as Record<string, Record<string, unknown>[]>;
  const completionEvidence = evaluateCompletionEvidence({
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
  });
  const expectedLifecycle = [
    "PREPARED",
    "STARTING",
    "RUNNING",
    "PUSH_CLOSED",
    "DRAINING",
    "FROZEN",
    "FINALIZING",
    "SUBMITTED",
  ];
  const runningSequence = eventRecords.find(
    (event) =>
      event.eventType === "lifecycle.transition" &&
      (event.payload as Record<string, unknown> | undefined)?.state === "RUNNING",
  )?.sequence;
  const readyEvents = eventRecords.filter((event) => event.eventType === "worker.ready");
  const readyAgents = new Set(
    readyEvents.map(
      (event) => (event.payload as Record<string, unknown> | undefined)?.agentId as string,
    ),
  );
  let priorTerminalBytes: Buffer | undefined;
  let priorTerminalDigest: string | undefined;
  if (options.priorIdentity) {
    if (
      options.priorIdentity.declarationDigest !== identity.declarationDigest ||
      options.priorIdentity.runId === identity.runId
    ) {
      throw new Error("Isolation evidence requires a different run under the same declaration.");
    }
    const terminal = await verifyTerminalAttempt({
      root: resolve(root, HARNESS_ROOT),
      identity: options.priorIdentity,
    });
    if (terminal.classification !== "completed") {
      throw new Error("Isolation evidence requires a completed predecessor attempt.");
    }
    await validateReplayArtifacts(options.priorIdentity, root);
    priorTerminalBytes = canonicalJsonBytes(terminal);
    priorTerminalDigest = sha256Hex(priorTerminalBytes);
  }
  const isolation = {
    realGit: true,
    processNetworkSandbox:
      container?.fixtureNetworkMode === "per-agent-internal-bridges" &&
      validAgentNetworkIsolationEvidence(container?.agentNetworkIsolation) &&
      container?.cleanSolverNetworkMode === "none" &&
      executions.length === 3 &&
      executions.every((execution) => execution.networkDisabled === true),
    digestPinnedContainerImages:
      typeof imageLock.baseImage === "string" &&
      /@sha256:[0-9a-f]{64}$/.test(imageLock.baseImage) &&
      container?.fixtureImageId === imageLock.fixtureAgent?.imageId &&
      container?.gatewayImageId === imageLock.gitGateway?.imageId &&
      container?.solverImageId === imageLock.cleanSolver?.imageId,
    authenticatedSmartHttpGateway: container?.authenticatedSmartHttpGateway === true,
    commonLaunchBarrier:
      typeof run.launchEpochMs === "number" &&
      Number.isFinite(run.launchEpochMs) &&
      run.launchEpochMs >= 0 &&
      typeof runningSequence === "number" &&
      readyEvents.length === AGENT_IDS.length &&
      readyAgents.size === AGENT_IDS.length &&
      AGENT_IDS.every((agentId) => readyAgents.has(agentId)) &&
      readyEvents.every(
        (event) => typeof event.sequence === "number" && event.sequence < runningSequence,
      ) &&
      canonicalJsonBytes(run.lifecycleStates).equals(canonicalJsonBytes(expectedLifecycle)),
    monotonicAbsoluteSchedule: validScheduleEvidence(run),
    transactionalGitAdmission: completionEvidence.trustedGitAdmission,
    publishedCollaborationSnapshot: completionEvidence.publishedCollaborationSnapshot,
    progressiveRevealEvidence: completionEvidence.progressiveRevealEvidence,
    finalFetchAndSubmissionEvidence: completionEvidence.finalFetchAndSubmissionEvidence,
    repeatedAttemptIsolation: priorTerminalBytes !== undefined,
  };
  const passing =
    externalModelRequestCount === 0 && Object.values(isolation).every((value) => value === true);
  const result = externalModelRequestCount === 0 ? (passing ? "pass" : "rework") : "invalid";
  const report = {
    schemaVersion: 1,
    contractId: "offline-harness-report",
    state: "completed",
    declarationDigest: identity.declarationDigest,
    runId: identity.runId,
    result,
    completedStages: [
      "build",
      "launch",
      "reveal",
      "collaborate",
      "freeze",
      "submit",
      "clean-execute",
      "score",
      "replay",
      "redact",
    ],
    externalModelRequestCount,
    liveModelValidationAuthorized: passing,
    empiricalModelEvidence: false,
  };
  const verdict = validateValue("offline-harness-report", report);
  if (!verdict.accepted) {
    throw new Error(`Completion report is invalid: ${verdict.reason} at ${verdict.pointer}`);
  }
  await writeFile(
    resolve(attempt, "completion-evidence.json"),
    canonicalJsonBytes({
      schemaVersion: 1,
      isolation,
      required,
      priorAttempt: options.priorIdentity
        ? {
            declarationDigest: options.priorIdentity.declarationDigest,
            runId: options.priorIdentity.runId,
            terminalSha256: priorTerminalDigest,
          }
        : null,
    }),
  );
  await writeFile(resolve(attempt, "offline-harness-report.json"), canonicalJsonBytes(report));
  if (options.priorIdentity && priorTerminalBytes) {
    const after = canonicalJsonBytes(
      await verifyTerminalAttempt({
        root: resolve(root, HARNESS_ROOT),
        identity: options.priorIdentity,
      }),
    );
    if (!after.equals(priorTerminalBytes)) {
      throw new Error("The second attempt changed the first terminal attempt.");
    }
  }
  const classification: AttemptClassification = result === "invalid" ? "invalid" : "completed";
  await sealAttempt({
    root: resolve(root, HARNESS_ROOT),
    identity,
    classification,
  });
  await verifyTerminalAttempt({ root: resolve(root, HARNESS_ROOT), identity });
  return report;
}

async function main(): Promise<void> {
  if (process.argv.includes("--predeclare")) {
    process.stdout.write(`${canonicalJsonBytes(await writePredeclaration()).toString("utf8")}\n`);
    return;
  }
  if (process.argv.includes("--check")) {
    process.stdout.write(`${canonicalJsonBytes(await checkPredeclaration()).toString("utf8")}\n`);
    return;
  }
  if (process.argv.includes("--complete")) {
    process.stdout.write(
      `${canonicalJsonBytes(await completeAttempt(identityFromArgs())).toString("utf8")}\n`,
    );
    return;
  }
  throw new Error("Select --predeclare, --check, or --complete.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
