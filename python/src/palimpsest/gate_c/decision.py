from __future__ import annotations

from typing import Any

OWNING_DIALS = {
    "pre-switch-gain": "reveal-cadence",
    "localized-drop": "changed-token-mass",
    "changed-recovery": "changed-token-mass",
    "stable-retention": "changed-token-mass",
    "false-retractions": "changed-token-mass",
    "detection-window": "contradiction-threshold",
}


def decide_gate_c(
    trajectory: dict[str, Any],
    *,
    final_reveal_time_ms: int,
    contradiction_time_ms: int,
) -> dict[str, Any]:
    attempt_id = trajectory["attemptId"]
    if trajectory["integrityFailures"]:
        return _decision(attempt_id, "invalid", ["integrity"], None)

    detection_latency = trajectory["detectionLatencyMs"]
    detection_limit = (final_reveal_time_ms - contradiction_time_ms) * 0.75
    predicates = {
        "pre-switch-gain": trajectory["preSwitchGainPp"] >= 10,
        "localized-drop": trajectory["localizedDropPp"] >= 10,
        "changed-recovery": trajectory["changedRecoveryPp"] >= 10,
        "stable-retention": trajectory["stableRetentionPp"] >= -5,
        "false-retractions": trajectory["falseRetractionRate"] <= 0.10,
        "detection-window": detection_latency is not None
        and 0 <= detection_latency <= detection_limit,
    }
    failed = [name for name, passed in predicates.items() if not passed]
    if not failed:
        return _decision(attempt_id, "pass", [], None)
    if len(failed) == 1:
        return _decision(attempt_id, "rework", failed, OWNING_DIALS[failed[0]])
    return _decision(attempt_id, "stop", failed, None)


def _decision(
    attempt_id: str,
    classification: str,
    failed_predicates: list[str],
    owning_dial: str | None,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "contractId": "gate-c-decision",
        "attemptId": attempt_id,
        "classification": classification,
        "failedPredicates": failed_predicates,
        "owningDial": owning_dial,
        "gateDAuthorization": "minimal-only" if classification == "pass" else "none",
        "fullHarnessAuthorized": False,
    }
