from __future__ import annotations

import json
from pathlib import Path

from palimpsest.contracts import validate_value

ROOT = Path(__file__).resolve().parents[3]

CASES = (
    ("instance-build-request", "instance-build-request"),
    ("run-manifest", "run-manifest"),
    ("score-report", "score-report"),
    ("offline-harness-report", "offline-harness-report"),
)


def test_harness_contract_families_accept_valid_fixtures() -> None:
    for contract_id, filename in CASES:
        value = json.loads(
            (ROOT / f"packages/contracts/fixtures/valid/{filename}.json").read_text(
                encoding="utf-8"
            )
        )
        verdict = validate_value(contract_id, value)
        assert verdict.accepted, (contract_id, verdict.reason, verdict.pointer)


def test_harness_contract_families_reject_unknown_fields() -> None:
    for contract_id, filename in CASES:
        value = json.loads(
            (ROOT / f"packages/contracts/fixtures/invalid/{filename}-unknown-field.json").read_text(
                encoding="utf-8"
            )
        )
        verdict = validate_value(contract_id, value)
        assert not verdict.accepted
        assert verdict.reason == "unknown_field"


def test_authorized_completion_requires_zero_provider_calls() -> None:
    report = json.loads(
        (ROOT / "packages/contracts/fixtures/valid/offline-harness-report.json").read_text(
            encoding="utf-8"
        )
    )
    report["externalModelRequestCount"] = 1
    assert not validate_value("offline-harness-report", report).accepted
    report["result"] = "invalid"
    report["liveModelValidationAuthorized"] = False
    assert validate_value("offline-harness-report", report).accepted
