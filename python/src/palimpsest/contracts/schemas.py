from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

SCHEMAS_ROOT = Path(__file__).resolve().parents[4] / "packages" / "contracts" / "schemas"
SCHEMA_FILES = (
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
)

SCHEMAS: dict[str, dict[str, Any]] = {
    filename: json.loads((SCHEMAS_ROOT / filename).read_text(encoding="utf-8"))
    for filename in SCHEMA_FILES
}

REGISTRY = Registry().with_resources(
    [(schema["$id"], Resource.from_contents(schema)) for schema in SCHEMAS.values()]
)

CONTRACT_SCHEMAS = {
    "canonical-json": SCHEMAS["canonical-json.schema.json"],
    "canonical-archive": SCHEMAS["canonical-archive.schema.json"],
    "artifact-response-manifest": SCHEMAS["artifact-response-manifest.schema.json"],
    "gate-report": SCHEMAS["gate-report.schema.json"],
    "git-genesis": SCHEMAS["git-genesis.schema.json"],
    "logical-git-transaction": SCHEMAS["logical-git-transaction.schema.json"],
    "channel-fixture": SCHEMAS["channel-fixture.schema.json"],
    "useful-state-checkpoint": SCHEMAS["useful-state-checkpoint.schema.json"],
    "relay-attempt-result": SCHEMAS["relay-attempt-result.schema.json"],
    "timing-capacity-result": SCHEMAS["timing-capacity-result.schema.json"],
    "budget-sweep-result": SCHEMAS["budget-sweep-result.schema.json"],
    "gate-b-source-record": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/sourceRecord"
    },
    "gate-b-build-request": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/buildRequest"
    },
    "gate-b-prepared-plaintext-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/preparedPlaintextManifest"
    },
    "gate-b-entity-regeneration-map": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/entityRegenerationMap"
    },
    "gate-b-public-instance-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/publicInstanceManifest"
    },
    "gate-b-solver-input-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/solverInputManifest"
    },
    "gate-b-oracle-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/oracleManifest"
    },
    "gate-b-reference-corpus-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/referenceCorpusManifest"
    },
    "gate-b-baseline-attempt": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/baselineAttempt"
    },
    "gate-b-identification-attempt": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/identificationAttempt"
    },
    "gate-b-solver-checkpoint": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/solverCheckpoint"
    },
    "gate-b-entity-audit": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/entityAudit"
    },
    "gate-b-score-table": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/scoreTable"
    },
    "gate-b-decision-analysis": {
        "$ref": "https://palimpsest.invalid/contracts/gate-b-records/1#/$defs/decisionAnalysis"
    },
    "revision-instance": SCHEMAS["revision-instance.schema.json"],
    "reveal-plan": SCHEMAS["reveal-plan.schema.json"],
    "reveal-event": SCHEMAS["reveal-event.schema.json"],
    "solver-checkpoint": SCHEMAS["solver-checkpoint.schema.json"],
    "revision-trajectory": SCHEMAS["revision-trajectory.schema.json"],
    "gate-c-decision": SCHEMAS["gate-c-decision.schema.json"],
    "instance-build-request": {
        "$ref": "https://palimpsest.invalid/contracts/instance-records/1#/$defs/instanceBuildRequest"
    },
    "public-instance-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/instance-records/1#/$defs/publicInstanceManifest"
    },
    "oracle-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/instance-records/1#/$defs/oracleManifest"
    },
    "agent-reference-corpus-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/instance-records/1#/$defs/agentReferenceCorpusManifest"
    },
    "shard-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/instance-records/1#/$defs/shardManifest"
    },
    "released-shard-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/instance-records/1#/$defs/releasedShardManifest"
    },
    "difficulty-config": {
        "$ref": "https://palimpsest.invalid/contracts/instance-records/1#/$defs/difficultyConfig"
    },
    "scoring-policy": {
        "$ref": "https://palimpsest.invalid/contracts/instance-records/1#/$defs/scoringPolicy"
    },
    "run-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/runManifest"
    },
    "agent-invocation": {
        "$ref": "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/agentInvocation"
    },
    "agent-event": {
        "$ref": "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/agentEvent"
    },
    "push-ledger-entry": {
        "$ref": "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/pushLedgerEntry"
    },
    "published-snapshot": {
        "$ref": "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/publishedSnapshot"
    },
    "run-event": {
        "$ref": "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/runEvent"
    },
    "freeze-snapshot": {
        "$ref": "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/freezeSnapshot"
    },
    "private-deliverable-manifest": {
        "$ref": "https://palimpsest.invalid/contracts/run-control-records/1#/$defs/privateDeliverableManifest"
    },
    "solver-execution": {
        "$ref": "https://palimpsest.invalid/contracts/grading-records/1#/$defs/solverExecution"
    },
    "score-report": {
        "$ref": "https://palimpsest.invalid/contracts/grading-records/1#/$defs/scoreReport"
    },
    "trusted-replay-bundle": {
        "$ref": "https://palimpsest.invalid/contracts/grading-records/1#/$defs/trustedReplayBundle"
    },
    "public-report-bundle": {
        "$ref": "https://palimpsest.invalid/contracts/grading-records/1#/$defs/publicReportBundle"
    },
    "offline-harness-report": SCHEMAS["offline-harness-report.schema.json"],
}


def contract_validator(contract_id: str, value: Any) -> Draft202012Validator:
    schema = CONTRACT_SCHEMAS[contract_id]
    if contract_id == "gate-report" and isinstance(value, dict):
        state = value.get("state")
        if state in {"predeclared", "completed"}:
            schema = schema["$defs"][state]
    return Draft202012Validator(schema, registry=REGISTRY)
