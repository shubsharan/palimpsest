import { readFileSync } from "node:fs";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

export const contractIds = [
  "canonical-json",
  "canonical-archive",
  "artifact-response-manifest",
  "gate-report",
  "git-genesis",
  "logical-git-transaction",
  "channel-fixture",
  "useful-state-checkpoint",
  "relay-attempt-result",
  "timing-capacity-result",
  "budget-sweep-result",
  "gate-b-source-record",
  "gate-b-build-request",
  "gate-b-prepared-plaintext-manifest",
  "gate-b-entity-regeneration-map",
  "gate-b-public-instance-manifest",
  "gate-b-solver-input-manifest",
  "gate-b-oracle-manifest",
  "gate-b-reference-corpus-manifest",
  "gate-b-baseline-attempt",
  "gate-b-identification-attempt",
  "gate-b-solver-checkpoint",
  "gate-b-entity-audit",
  "gate-b-score-table",
  "gate-b-decision-analysis",
  "revision-instance",
  "reveal-plan",
  "reveal-event",
  "solver-checkpoint",
  "revision-trajectory",
  "gate-c-decision",
  "instance-build-request",
  "public-instance-manifest",
  "oracle-manifest",
  "agent-reference-corpus-manifest",
  "shard-manifest",
  "released-shard-manifest",
  "difficulty-config",
  "scoring-policy",
  "run-manifest",
  "agent-invocation",
  "agent-event",
  "push-ledger-entry",
  "published-snapshot",
  "run-event",
  "freeze-snapshot",
  "private-deliverable-manifest",
  "solver-execution",
  "score-report",
  "trusted-replay-bundle",
  "public-report-bundle",
  "offline-harness-report",
] as const;

export type ContractId = (typeof contractIds)[number];

const schemaFiles = [
  "contract-envelope.schema.json",
  "canonical-json.schema.json",
  "canonical-archive.schema.json",
  "artifact-response-manifest.schema.json",
  "gate-report.schema.json",
  "git-genesis.schema.json",
  "logical-git-transaction.schema.json",
  "channel-fixture.schema.json",
  "useful-state-checkpoint.schema.json",
  "relay-attempt-result.schema.json",
  "timing-capacity-result.schema.json",
  "budget-sweep-result.schema.json",
  "gate-b/gate-b-records.schema.json",
  "revision-instance.schema.json",
  "reveal-plan.schema.json",
  "reveal-event.schema.json",
  "solver-checkpoint.schema.json",
  "revision-trajectory.schema.json",
  "gate-c-decision.schema.json",
  "instance-records.schema.json",
  "run-control-records.schema.json",
  "grading-records.schema.json",
  "offline-harness-report.schema.json",
] as const;

const schemas = schemaFiles.map((filename) =>
  JSON.parse(readFileSync(new URL(`../schemas/${filename}`, import.meta.url), "utf8")),
);

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: false,
  strict: true,
  validateFormats: true,
});

schemas.forEach((schema) => {
  ajv.addSchema(schema);
});

const schemaIds: Record<ContractId, string> = {
  "artifact-response-manifest": "https://palimpsest.invalid/contracts/artifact-response-manifest/1",
  "canonical-archive": "https://palimpsest.invalid/contracts/canonical-archive/1",
  "canonical-json": "https://palimpsest.invalid/contracts/canonical-json/1",
  "gate-report": "https://palimpsest.invalid/contracts/gate-report/1",
  "git-genesis": "https://palimpsest.invalid/contracts/git-genesis/1",
  "logical-git-transaction": "https://palimpsest.invalid/contracts/logical-git-transaction/1",
  "channel-fixture": "https://palimpsest.invalid/contracts/channel-fixture/1",
  "useful-state-checkpoint": "https://palimpsest.invalid/contracts/useful-state-checkpoint/1",
  "relay-attempt-result": "https://palimpsest.invalid/contracts/relay-attempt-result/1",
  "timing-capacity-result": "https://palimpsest.invalid/contracts/timing-capacity-result/1",
  "budget-sweep-result": "https://palimpsest.invalid/contracts/budget-sweep-result/1",
  "gate-b-source-record":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/sourceRecord",
  "gate-b-build-request":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/buildRequest",
  "gate-b-prepared-plaintext-manifest":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/preparedPlaintextManifest",
  "gate-b-entity-regeneration-map":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/entityRegenerationMap",
  "gate-b-public-instance-manifest":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/publicInstanceManifest",
  "gate-b-solver-input-manifest":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/solverInputManifest",
  "gate-b-oracle-manifest":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/oracleManifest",
  "gate-b-reference-corpus-manifest":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/referenceCorpusManifest",
  "gate-b-baseline-attempt":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/baselineAttempt",
  "gate-b-identification-attempt":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/identificationAttempt",
  "gate-b-solver-checkpoint":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/solverCheckpoint",
  "gate-b-entity-audit": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/entityAudit",
  "gate-b-score-table": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/scoreTable",
  "gate-b-decision-analysis":
    "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/decisionAnalysis",
  "revision-instance": "https://palimpsest.invalid/contracts/revision-instance/1",
  "reveal-plan": "https://palimpsest.invalid/contracts/reveal-plan/1",
  "reveal-event": "https://palimpsest.invalid/contracts/reveal-event/1",
  "solver-checkpoint": "https://palimpsest.invalid/contracts/solver-checkpoint/1",
  "revision-trajectory": "https://palimpsest.invalid/contracts/revision-trajectory/1",
  "gate-c-decision": "https://palimpsest.invalid/contracts/gate-c-decision/1",
  "instance-build-request":
    "https://palimpsest.invalid/contracts/instance-records/1#/$defs/instanceBuildRequest",
  "public-instance-manifest":
    "https://palimpsest.invalid/contracts/instance-records/1#/$defs/publicInstanceManifest",
  "oracle-manifest":
    "https://palimpsest.invalid/contracts/instance-records/1#/$defs/oracleManifest",
  "agent-reference-corpus-manifest":
    "https://palimpsest.invalid/contracts/instance-records/1#/$defs/agentReferenceCorpusManifest",
  "shard-manifest": "https://palimpsest.invalid/contracts/instance-records/1#/$defs/shardManifest",
  "released-shard-manifest":
    "https://palimpsest.invalid/contracts/instance-records/1#/$defs/releasedShardManifest",
  "difficulty-config":
    "https://palimpsest.invalid/contracts/instance-records/1#/$defs/difficultyConfig",
  "scoring-policy": "https://palimpsest.invalid/contracts/instance-records/1#/$defs/scoringPolicy",
  "run-manifest": "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/runManifest",
  "agent-invocation":
    "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/agentInvocation",
  "agent-event": "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/agentEvent",
  "push-ledger-entry":
    "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/pushLedgerEntry",
  "published-snapshot":
    "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/publishedSnapshot",
  "run-event": "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/runEvent",
  "freeze-snapshot":
    "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/freezeSnapshot",
  "private-deliverable-manifest":
    "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/privateDeliverableManifest",
  "solver-execution":
    "https://palimpsest.invalid/contracts/grading-records/1#/$defs/solverExecution",
  "score-report": "https://palimpsest.invalid/contracts/grading-records/1#/$defs/scoreReport",
  "trusted-replay-bundle":
    "https://palimpsest.invalid/contracts/grading-records/1#/$defs/trustedReplayBundle",
  "public-report-bundle":
    "https://palimpsest.invalid/contracts/grading-records/1#/$defs/publicReportBundle",
  "offline-harness-report": "https://palimpsest.invalid/contracts/offline-harness-report/1",
};

export function isContractId(value: string): value is ContractId {
  return contractIds.some((contractId) => contractId === value);
}

export function getContractValidator(contractId: ContractId, value: unknown): ValidateFunction {
  let schemaId = schemaIds[contractId];
  if (
    contractId === "gate-report" &&
    value !== null &&
    typeof value === "object" &&
    "state" in value
  ) {
    const state = value.state;
    if (state === "predeclared" || state === "completed") {
      schemaId += `#/$defs/${state}`;
    }
  }
  const validator = ajv.getSchema(schemaId);
  if (!validator) {
    throw new Error(`Schema validator is not registered: ${schemaId}`);
  }
  return validator;
}
