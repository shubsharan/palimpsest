from __future__ import annotations

from palimpsest.gate_b.decision import classify_gate_b


def _scores(value: float) -> dict[str, list[float]]:
    return {f"instance-{name}": [value - 0.1, value] for name in "abcd"}


def _mechanical(value: float) -> dict[str, float]:
    return {f"instance-{name}": value for name in "abcd"}


def _audits() -> dict[str, dict[str, float | int]]:
    return {
        f"instance-{name}": {
            "repeatedMentionConsistency": 0.99,
            "missedEntityRate": 0.1,
            "commonNounOverCaptureRate": 0.02,
            "generatedNameCollisions": 0,
        }
        for name in "abcd"
    }


def test_gate_passes_at_inclusive_minima_and_strict_mechanical_maximum() -> None:
    result = classify_gate_b(
        mechanical=_mechanical(0.84),
        agent=_scores(0.94),
        human=_scores(0.94),
        audits=_audits(),
        recognition={f"instance-{name}": False for name in "abcd"},
        function_accuracy=0.8,
        rare_content_accuracy=0.5,
        entity_accuracy=0.4,
    )
    assert result["classification"] == "pass"


def test_mechanical_score_equal_to_exclusive_ceiling_stops_gate() -> None:
    result = classify_gate_b(
        mechanical=_mechanical(0.85),
        agent=_scores(0.95),
        human=_scores(0.95),
        audits=_audits(),
        recognition={f"instance-{name}": False for name in "abcd"},
        function_accuracy=0.8,
        rare_content_accuracy=0.5,
        entity_accuracy=0.4,
    )
    assert result["classification"] == "stop"


def test_missing_capable_solver_evidence_is_invalid() -> None:
    result = classify_gate_b(
        mechanical=_mechanical(0.2),
        agent={},
        human={},
        audits=_audits(),
        recognition={f"instance-{name}": False for name in "abcd"},
        function_accuracy=0.8,
        rare_content_accuracy=0.5,
        entity_accuracy=0.4,
    )
    assert result["classification"] == "invalid"
    assert result["integrityFailures"]
