from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from palimpsest.contracts import canonical_json_bytes, sha256_hex
from palimpsest.replay.harness import (
    TRUSTED_ARTIFACT_PATHS,
    _load_agent_events,
    _verify_admission_events,
    _verify_drain,
    _verify_submission_events,
)

AGENTS = ("agent-1", "agent-2", "agent-3")
RUN_ID = "run-runtime-evidence"
FREEZE_ID = "freeze-runtime-evidence"


def _runtime_evidence(
    attempt: Path,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any],
    dict[str, Any],
]:
    trusted_events = []
    ledgers = []
    submissions = []
    for number, agent_id in enumerate(AGENTS, start=1):
        invocation_id = f"{agent_id}-fixture-001"
        agent_events = [
            {
                "schemaVersion": 1,
                "runId": RUN_ID,
                "agentId": agent_id,
                "invocationId": invocation_id,
                "ordinal": 1,
                "type": "git.clone",
                "payload": {"repository": "workspace/repository"},
            },
            {
                "schemaVersion": 1,
                "runId": RUN_ID,
                "agentId": agent_id,
                "invocationId": invocation_id,
                "ordinal": 2,
                "type": "git.fetch",
                "payload": {
                    "snapshot": "frozen",
                    "refNamespace": "refs/heads/agents",
                },
            },
            {
                "schemaVersion": 1,
                "runId": RUN_ID,
                "agentId": agent_id,
                "invocationId": invocation_id,
                "ordinal": 3,
                "type": "worker.completed",
                "payload": {"classification": "completed"},
            },
        ]
        path = attempt / "agents" / agent_id / "events.json"
        path.parent.mkdir(parents=True)
        path.write_bytes(canonical_json_bytes(agent_events))

        budget_before = 1_000
        for slot, charge_bytes in ((1, number * 100), (2, number * 50)):
            frame_digest = f"{number + (slot - 1) * 6}" * 64
            transaction_id = f"{agent_id}-push-{frame_digest}"
            ledger = {
                "schemaVersion": 1,
                "contractId": "push-ledger-entry",
                "runId": RUN_ID,
                "agentId": agent_id,
                "transactionId": transaction_id,
                "frameDigest": frame_digest,
                "chargeBytes": charge_bytes,
                "budgetBefore": budget_before,
                "budgetAfter": budget_before - charge_bytes,
                "result": "accepted",
            }
            budget_before = ledger["budgetAfter"]
            ledgers.append(ledger)
            trusted_events.append(
                {
                    "producer": "git-gateway",
                    "effectId": f"admission-{transaction_id}",
                    "eventType": "git.admission",
                    "payload": {
                        "agentId": agent_id,
                        "transactionId": transaction_id,
                        "frameDigest": ledger["frameDigest"],
                        "chargeBytes": ledger["chargeBytes"],
                        "result": "accepted",
                    },
                }
            )
        trusted_events.append(
            {
                "producer": "model-bridge",
                "effectId": f"worker-{agent_id}-final-fetch",
                "eventType": "worker.final-fetch",
                "payload": {
                    "agentId": agent_id,
                    "invocationId": invocation_id,
                    "ordinal": 2,
                    "snapshotId": "snapshot-1",
                    "tupleDigest": f"{number}" * 64,
                },
            }
        )

        submission = {
            "schemaVersion": 1,
            "contractId": "private-deliverable-manifest",
            "runId": RUN_ID,
            "agentId": agent_id,
            "freezeId": FREEZE_ID,
            "releasedShardDigest": f"{number + 3}" * 64,
            "outputs": [],
        }
        submissions.append(submission)
        trusted_events.append(
            {
                "producer": "submission-service",
                "effectId": f"submission-{agent_id}",
                "eventType": "submission.sealed",
                "payload": {
                    "agentId": agent_id,
                    "freezeId": FREEZE_ID,
                    "releasedShardDigest": submission["releasedShardDigest"],
                    "manifestDigest": sha256_hex(canonical_json_bytes(submission)),
                },
            }
        )
    freeze = {"freezeId": FREEZE_ID}
    policy = {
        "schemaVersion": 2,
        "resourceLimits": {
            "maxFetchesPerAgent": 2,
            "maxReceiveAttemptsPerAgent": 2,
            "maxReceiveBodyBytes": 8 * 1024 * 1024,
            "receiveTimeoutMs": 30_000,
        },
        "perAgentPrivateObjectDatabases": True,
        "inspectedRepositories": {
            agent_id: {
                "gitDirectory": f"/git/{agent_id}",
                "objectDirectory": f"/objects/{agent_id}",
                "hooksPath": f"/run/palimpsest-hooks/{agent_id}",
                "alternates": [],
                "receiveHiddenRefs": [
                    "refs/heads/agents",
                    "refs/heads/quarantine",
                ],
                "uploadHiddenRefs": [
                    "refs/heads/agents",
                    "refs/heads/quarantine",
                ],
                "quarantineRefCount": 0,
            }
            for agent_id in AGENTS
        },
    }
    drain = {
        "schemaVersion": 1,
        "runId": RUN_ID,
        "pendingReceives": 0,
        "pendingReservations": 0,
        "ledgerEntryCount": 6,
        "policy": policy,
    }
    return trusted_events, ledgers, submissions, freeze, drain


def test_reconciles_complete_runtime_evidence_and_trusted_artifacts(tmp_path: Path) -> None:
    attempt = tmp_path / "attempt"
    events, ledgers, submissions, freeze, drain = _runtime_evidence(attempt)

    _verify_drain(drain, ledgers, RUN_ID)
    loaded = _load_agent_events(attempt, RUN_ID, events)
    _verify_admission_events(events, ledgers)
    _verify_submission_events(events, submissions, freeze)

    assert set(loaded) == set(AGENTS)
    trusted_paths = {path for path, _ in TRUSTED_ARTIFACT_PATHS}
    assert "git/drain.json" in trusted_paths
    assert {
        "agents/agent-1/events.json",
        "agents/agent-2/events.json",
        "agents/agent-3/events.json",
    } <= trusted_paths


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("runId", "another-run"),
        ("pendingReceives", 1),
        ("pendingReservations", 1),
        ("ledgerEntryCount", 5),
    ],
)
def test_rejects_incomplete_or_foreign_drain_evidence(
    tmp_path: Path, field: str, value: Any
) -> None:
    attempt = tmp_path / "attempt"
    _, ledgers, _, _, drain = _runtime_evidence(attempt)
    drain[field] = value

    with pytest.raises(ValueError, match="zero pending work, two ledgers per agent"):
        _verify_drain(drain, ledgers, RUN_ID)


def test_rejects_uneven_two_slot_ledger_coverage(tmp_path: Path) -> None:
    attempt = tmp_path / "attempt"
    _, ledgers, _, _, drain = _runtime_evidence(attempt)
    next(ledger for ledger in ledgers if ledger["agentId"] == "agent-2")["agentId"] = "agent-1"

    with pytest.raises(ValueError, match="two ledgers per agent"):
        _verify_drain(drain, ledgers, RUN_ID)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("perAgentPrivateObjectDatabases", False),
        ("schemaVersion", 1),
    ],
)
def test_rejects_unproven_gateway_policy_v2(tmp_path: Path, field: str, value: Any) -> None:
    attempt = tmp_path / "attempt"
    _, ledgers, _, _, drain = _runtime_evidence(attempt)
    drain["policy"][field] = value

    with pytest.raises(ValueError, match="policy v2 isolation"):
        _verify_drain(drain, ledgers, RUN_ID)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("maxFetchesPerAgent", 3),
        ("maxReceiveAttemptsPerAgent", 3),
        ("maxReceiveBodyBytes", 16 * 1024 * 1024),
        ("receiveTimeoutMs", 60_000),
    ],
)
def test_rejects_relaxed_gateway_resource_limits(tmp_path: Path, field: str, value: Any) -> None:
    attempt = tmp_path / "attempt"
    _, ledgers, _, _, drain = _runtime_evidence(attempt)
    drain["policy"]["resourceLimits"][field] = value

    with pytest.raises(ValueError, match="policy v2 isolation"):
        _verify_drain(drain, ledgers, RUN_ID)


def test_rejects_nonempty_inspected_quarantine_at_drain(tmp_path: Path) -> None:
    attempt = tmp_path / "attempt"
    _, ledgers, _, _, drain = _runtime_evidence(attempt)
    drain["policy"]["inspectedRepositories"]["agent-2"]["quarantineRefCount"] = 1

    with pytest.raises(ValueError, match="policy v2 isolation"):
        _verify_drain(drain, ledgers, RUN_ID)


def test_rejects_shared_or_nonexec_gateway_hooks(tmp_path: Path) -> None:
    attempt = tmp_path / "attempt"
    _, ledgers, _, _, drain = _runtime_evidence(attempt)
    drain["policy"]["inspectedRepositories"]["agent-2"]["hooksPath"] = "/tmp/hooks"

    with pytest.raises(ValueError, match="policy v2 isolation"):
        _verify_drain(drain, ledgers, RUN_ID)


@pytest.mark.parametrize(
    ("surface", "value", "message"),
    [
        ("agent-snapshot", "published", "one exact frozen Git fetch"),
        ("trusted-ordinal", 7, "does not match trusted evidence"),
        ("trusted-invocation", "foreign-invocation", "does not match trusted evidence"),
    ],
)
def test_rejects_agent_final_fetch_drift(
    tmp_path: Path, surface: str, value: Any, message: str
) -> None:
    attempt = tmp_path / "attempt"
    events, _, _, _, _ = _runtime_evidence(attempt)
    agent_path = attempt / "agents" / "agent-1" / "events.json"
    agent_events = deepcopy(json.loads(agent_path.read_text(encoding="utf-8")))
    trusted = next(
        event
        for event in events
        if event["eventType"] == "worker.final-fetch" and event["payload"]["agentId"] == "agent-1"
    )
    if surface == "agent-snapshot":
        agent_events[1]["payload"]["snapshot"] = value
        agent_path.write_bytes(canonical_json_bytes(agent_events))
    elif surface == "trusted-ordinal":
        trusted["payload"]["ordinal"] = value
    else:
        trusted["payload"]["invocationId"] = value

    with pytest.raises(ValueError, match=message):
        _load_agent_events(attempt, RUN_ID, events)


def test_rejects_admission_and_submission_event_drift(tmp_path: Path) -> None:
    attempt = tmp_path / "attempt"
    events, ledgers, submissions, freeze, _ = _runtime_evidence(attempt)
    admission_drift = deepcopy(events)
    next(event for event in admission_drift if event["eventType"] == "git.admission")["payload"][
        "chargeBytes"
    ] += 1
    with pytest.raises(ValueError, match="does not match its ledger"):
        _verify_admission_events(admission_drift, ledgers)

    uneven_ledgers = deepcopy(ledgers)
    uneven_admissions = deepcopy(events)
    migrated = next(ledger for ledger in uneven_ledgers if ledger["agentId"] == "agent-2")
    migrated["agentId"] = "agent-1"
    next(
        event
        for event in uneven_admissions
        if event["eventType"] == "git.admission"
        and event["payload"]["transactionId"] == migrated["transactionId"]
    )["payload"]["agentId"] = "agent-1"
    with pytest.raises(ValueError, match="two events per agent"):
        _verify_admission_events(uneven_admissions, uneven_ledgers)

    submission_drift = deepcopy(events)
    next(event for event in submission_drift if event["eventType"] == "submission.sealed")[
        "payload"
    ]["manifestDigest"] = "f" * 64
    with pytest.raises(ValueError, match="does not match sealed evidence"):
        _verify_submission_events(submission_drift, submissions, freeze)
