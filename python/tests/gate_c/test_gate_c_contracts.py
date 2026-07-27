from __future__ import annotations

import json
from pathlib import Path

from palimpsest.contracts import validate_value

ROOT = Path(__file__).resolve().parents[3]


def test_generated_gate_c_artifacts_satisfy_contracts() -> None:
    for contract_id, relative_path in (
        ("revision-instance", "artifacts/gate-c/calibration/private-instance.json"),
        ("reveal-plan", "artifacts/gate-c/calibration/reveal-plan.json"),
    ):
        value = json.loads((ROOT / relative_path).read_text(encoding="utf-8"))
        verdict = validate_value(contract_id, value)
        assert verdict.accepted, (contract_id, verdict.reason, verdict.pointer)


def test_solver_checkpoint_rejects_oracle_leakage() -> None:
    value = {
        "schemaVersion": 1,
        "contractId": "solver-checkpoint",
        "attemptId": "gate-c/aaaaaaaa/run-1",
        "ordinal": 1,
        "revealOrdinal": 1,
        "observedMonotonicMs": 1,
        "responseId": "resp_1",
        "previousResponseId": None,
        "containerId": "cntr_1",
        "mappings": [],
        "switchHypotheses": [],
        "reconstructionRefs": [],
        "usage": {"inputTokens": 1, "outputTokens": 1, "toolCalls": 0},
        "oracleSwitch": 3,
    }
    verdict = validate_value("solver-checkpoint", value)
    assert not verdict.accepted
    assert verdict.reason == "unknown_field"
    assert verdict.pointer == "/oracleSwitch"
