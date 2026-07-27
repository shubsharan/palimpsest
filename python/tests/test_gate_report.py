from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from palimpsest.contracts.gate_report import (
    complete_gate_report,
    predeclaration_digest,
    validate_gate_report,
)

FIXTURES = Path(__file__).resolve().parents[2] / "packages" / "contracts" / "fixtures" / "valid"


def fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / f"{name}.json").read_text())


def test_predeclared_and_completed_reports_share_the_frozen_digest() -> None:
    predeclared = fixture("gate-predeclared")
    completed = fixture("gate-completed")
    assert predeclaration_digest(predeclared) == predeclared["predeclarationDigest"]
    assert predeclaration_digest(completed) == predeclared["predeclarationDigest"]
    assert validate_gate_report(predeclared).accepted
    assert validate_gate_report(completed).accepted


def test_completion_preserves_the_predeclaration() -> None:
    predeclared = fixture("gate-predeclared")
    source = fixture("gate-completed")
    completion = {
        key: source[key]
        for key in (
            "environment",
            "producerVersions",
            "rawArtifacts",
            "analysis",
            "result",
            "followUp",
        )
    }
    completed = complete_gate_report(predeclared, completion)
    assert completed["predeclarationDigest"] == predeclared["predeclarationDigest"]
    assert validate_gate_report(completed).accepted


@pytest.mark.parametrize("field", ["thresholds", "frozenInputs"])
def test_tampering_is_detected(field: str) -> None:
    tampered = copy.deepcopy(fixture("gate-completed"))
    if field == "thresholds":
        tampered["thresholds"][0]["value"] = "1"
    else:
        tampered["frozenInputs"][0]["sha256"] = "e" * 64
    verdict = validate_gate_report(tampered)
    assert not verdict.accepted
    assert verdict.reason == "digest"
    assert verdict.pointer == "/predeclarationDigest"
