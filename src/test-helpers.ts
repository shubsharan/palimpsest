import {
  type AgentSandboxLease,
  type AgentSandboxLeaseRequest,
  type CommandSandbox,
  type EvaluationSandboxCommand,
  type SandboxCommand,
  type SandboxCommandResult,
  type SandboxIdentity,
} from "./sandbox/contracts.js";
import { generateAgentIds, type AgentId, type ModelBinding } from "./model.js";

export const TEST_SANDBOX_IDENTITY: SandboxIdentity = {
  imageTag: "palimpsest-puzzle-sandbox:0.1.0",
  imageId: `sha256:${"1".repeat(64)}`,
  sourceDigest: "2".repeat(64),
  profileVersion: 1,
};

const SUCCESS: SandboxCommandResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  outputExceeded: false,
};

export class FakeCommandSandbox implements CommandSandbox {
  readonly identity = TEST_SANDBOX_IDENTITY;
  readonly requests: SandboxCommand[] = [];
  readonly leases: AgentSandboxLeaseRequest[] = [];
  closedLeases = 0;
  readonly #execute: (request: SandboxCommand) => Promise<SandboxCommandResult>;

  constructor(
    execute: (request: SandboxCommand) => Promise<SandboxCommandResult> = async () => SUCCESS,
  ) {
    this.#execute = execute;
  }

  async openAgentLease(request: AgentSandboxLeaseRequest): Promise<AgentSandboxLease> {
    this.leases.push(request);
    const mounts = {
      profile: request.profile,
      workspacePath: request.workspacePath,
      evidencePath: request.evidencePath,
      referenceCorpusPath: request.referenceCorpusPath,
      sharedGitPath: request.sharedGitPath,
    } as const;
    return {
      identity: this.identity,
      execute: async (command) => {
        const fullRequest = { ...mounts, ...command };
        this.requests.push(fullRequest);
        return this.#execute(fullRequest);
      },
      close: async () => {
        this.closedLeases += 1;
      },
    };
  }

  async execute(request: EvaluationSandboxCommand): Promise<SandboxCommandResult> {
    this.requests.push(request);
    return this.#execute(request);
  }
}

export const TEST_DIGEST = "a".repeat(64);

export function testModelBinding(overrides: Partial<ModelBinding> = {}): ModelBinding {
  return {
    profile: "fixture-model",
    provider: "fixture-provider",
    driver: "openai-compatible",
    requestedModel: "fixture/model",
    settings: {},
    providerOptions: {},
    actualProvider: "fixture",
    actualModel: "fixture/model-v1",
    ...overrides,
  };
}

export function testBuildManifest(): Record<string, unknown> {
  const agentIds = generateAgentIds(3);
  const variant = (variantId: "stationary" | "rekey") => ({
    variantId,
    buildId: `build-${variantId === "stationary" ? "b".repeat(64) : TEST_DIGEST}`,
    publicCiphertextPath: `variants/${variantId}/complete/ciphertext.txt`,
    referenceCorpusPath: `variants/${variantId}/references`,
    privateStageRoots: Object.fromEntries(
      agentIds.map((agentId) => [agentId, `variants/${variantId}/private/${agentId}/stages`]),
    ),
    stages: agentIds.flatMap((agentId, agentIndex) =>
      Array.from({ length: 6 }, (_, index) => {
        const ordinal = index + 1;
        const stageDigest =
          ordinal < 4
            ? agentIndex * 6 + ordinal
            : 100 + (variantId === "stationary" ? 0 : 18) + agentIndex * 6 + ordinal;
        return {
          agentId,
          ordinal,
          keyVersion: variantId === "rekey" && ordinal >= 4 ? 1 : 0,
          sourcePath: `variants/${variantId}/private/${agentId}/stages/stage-${String(ordinal).padStart(2, "0")}.txt`,
          tokenCount: 200,
          sha256: stageDigest.toString(16).padStart(64, "0"),
        };
      }),
    ),
    keyTransitions:
      variantId === "stationary"
        ? []
        : [
            {
              atStage: 4,
              keyVersion: 1,
              keyPath: "oracle/keys/rekey-stage-04.json",
              changedSymbolsSha256: "c".repeat(64),
            },
          ],
  });
  return {
    schemaVersion: 3,
    pairedBuildId: `paired-${"d".repeat(64)}`,
    blockId: "calibration-theron-ware",
    source: { sourceId: "theron-ware", sha256: TEST_DIGEST },
    references: [
      { sourceId: "middlemarch", sha256: "1".repeat(64) },
      { sourceId: "moby-dick", sha256: "2".repeat(64) },
      { sourceId: "jane-eyre", sha256: "3".repeat(64) },
    ],
    seed: 130013,
    window: {
      paragraphStart: 10,
      paragraphEnd: 80,
      wordCount: 18_000,
      sha256: "4".repeat(64),
    },
    agentIds,
    stageCount: 6,
    boundaryStage: 4,
    allocation: {
      allocationId: `allocation-${"5".repeat(64)}`,
      tier: "balanced",
      metrics: {
        regionDeviation: 0.05,
        stageDeviation: 0.15,
        soloChangedSetCoverage: 0.6,
        minOwnerShare: 0.61,
        anchorCount: 12,
        sentinelCount: 6,
        specialistCounts: { "agent-1": 3, "agent-2": 3, "agent-3": 3 },
        minOwnerOccurrencesPerRegion: 2,
        minSentinelOccurrencesPerAgentRegion: 2,
        unmatchedControlCount: 0,
        maxControlDistance: 0.2,
      },
      rejectedTiers: [{ tier: "strict", reasons: ["region-deviation"] }],
      path: "oracle/allocation.json",
      sha256: "6".repeat(64),
    },
    oracleDesign: {
      path: "oracle/design.json",
      sha256: "7".repeat(64),
      anchorsSha256: "8".repeat(64),
      sentinelsSha256: "9".repeat(64),
      specialistsSha256: "a".repeat(64),
      controlsSha256: "b".repeat(64),
    },
    baseKeyPath: "oracle/keys/base.json",
    manipulationCheck: {
      path: "oracle/manipulation-check.json",
      sha256: "c".repeat(64),
      preBoundaryIdentical: true,
      stationaryOldKeyLoss: 0,
      rekeyOldKeyLoss: 0.2,
      changedTokenMassByAgent: { "agent-1": 0.2, "agent-2": 0.2, "agent-3": 0.2 },
    },
    variants: { stationary: variant("stationary"), rekey: variant("rekey") },
  };
}

export function testAttemptSummary(
  options: {
    agentIds?: readonly AgentId[];
  } = {},
): Record<string, unknown> {
  const agentIds = options.agentIds ?? generateAgentIds(3);
  return {
    schemaVersion: 2,
    attemptId: "attempt-fixture",
    buildId: `build-${TEST_DIGEST}`,
    buildRoot: "/tmp/palimpsest/build",
    agentIds,
    tracePath: "/tmp/palimpsest/attempt/trace.jsonl",
    traceMetadataPath: "/tmp/palimpsest/attempt/trace.meta.json",
    frozenRoot: "/tmp/palimpsest/attempt/frozen",
    sandbox: {
      ...TEST_SANDBOX_IDENTITY,
      network: "none",
      cpus: 2,
      memoryBytes: 2_147_483_648,
      pids: 256,
      tmpfsBytes: 268_435_456,
      maxOutputBytes: 4_194_304,
    },
    sessions: agentIds.map((agentId) => ({
      agentId,
      model: testModelBinding(),
      state: "finished",
      inputTokens: 1,
      outputTokens: 1,
      activityCursor: 0,
      terminationReason: "finished",
      finalResponse: "done",
    })),
  };
}

export function testExperimentSummary(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    resolvedConfig: {
      schemaVersion: 1,
      puzzle: {
        agentIds: generateAgentIds(3),
        stageCount: 6,
      },
      runs: [{ name: "baseline", repetitions: 1 }],
    },
    buildRoot: "/tmp/palimpsest/build",
    buildId: `build-${TEST_DIGEST}`,
    attempts: [
      {
        runName: "baseline",
        repetition: 1,
        attemptId: "attempt-fixture",
        attemptRoot: "/tmp/palimpsest/attempts/baseline/001",
      },
    ],
  };
}
