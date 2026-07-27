from __future__ import annotations

from copy import deepcopy

from palimpsest.gate_c.decision import decide_gate_c


def passing_trajectory() -> dict[str, object]:
    return {
        "attemptId": f"gate-c/{'a' * 64}/run-1",
        "preSwitchGainPp": 10,
        "localizedDropPp": 10,
        "changedRecoveryPp": 10,
        "stableRetentionPp": -5,
        "falseRetractionRate": 0.10,
        "detectionLatencyMs": 100,
        "integrityFailures": [],
    }


def decide(trajectory: dict[str, object]) -> dict[str, object]:
    return decide_gate_c(
        trajectory,
        final_reveal_time_ms=500,
        contradiction_time_ms=300,
    )


def test_pass_authorizes_only_minimum_gate_d() -> None:
    decision = decide(passing_trajectory())
    assert decision["classification"] == "pass"
    assert decision["gateDAuthorization"] == "minimal-only"
    assert decision["fullHarnessAuthorized"] is False


def test_one_owned_failure_requires_rework() -> None:
    trajectory = passing_trajectory()
    trajectory["localizedDropPp"] = 9.9
    decision = decide(trajectory)
    assert decision["classification"] == "rework"
    assert decision["failedPredicates"] == ["localized-drop"]
    assert decision["owningDial"] == "changed-token-mass"


def test_multiple_failures_stop_the_mechanic() -> None:
    trajectory = passing_trajectory()
    trajectory["localizedDropPp"] = 0
    trajectory["changedRecoveryPp"] = 0
    decision = decide(trajectory)
    assert decision["classification"] == "stop"
    assert decision["gateDAuthorization"] == "none"


def test_integrity_failure_is_invalid_not_an_empirical_result() -> None:
    trajectory = deepcopy(passing_trajectory())
    trajectory["integrityFailures"] = ["clock regressed"]
    decision = decide(trajectory)
    assert decision["classification"] == "invalid"
    assert decision["failedPredicates"] == ["integrity"]
