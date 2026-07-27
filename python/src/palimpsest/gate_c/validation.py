from __future__ import annotations

from typing import Any

from palimpsest.contracts import validate_value

from .artifacts import AttemptIdentity
from .config import REVEAL_EARLY_TOLERANCE_MS, REVEAL_LATE_TOLERANCE_MS


def validate_solver_evidence(
    *,
    identity: AttemptIdentity,
    instance: dict[str, Any],
    plan: dict[str, Any],
    events: list[dict[str, Any]],
    checkpoints: list[dict[str, Any]],
    completion: dict[str, Any],
) -> dict[int, int]:
    for contract_id, value in (
        ("revision-instance", instance),
        ("reveal-plan", plan),
    ):
        verdict = validate_value(contract_id, value)
        if not verdict.accepted:
            raise ValueError(
                f"{contract_id} validation failed: {verdict.reason} at {verdict.pointer}."
            )
    if len(events) != len(plan["slots"]) or len(checkpoints) != len(plan["slots"]):
        raise ValueError("Attempt must contain exactly one event and checkpoint per reveal slot.")

    response_chain: list[str] = []
    container_ids: set[str] = set()
    reveal_times: dict[int, int] = {}
    previous_time = -1
    for ordinal, (event, checkpoint, slot) in enumerate(
        zip(events, checkpoints, plan["slots"], strict=True),
        start=1,
    ):
        for contract_id, value in (
            ("reveal-event", event),
            ("solver-checkpoint", checkpoint),
        ):
            verdict = validate_value(contract_id, value)
            if not verdict.accepted:
                raise ValueError(
                    f"{contract_id} validation failed: {verdict.reason} at {verdict.pointer}."
                )
        observed = event["observedOffsetMs"]
        if (
            event["attemptId"] != identity.attempt_id
            or checkpoint["attemptId"] != identity.attempt_id
            or event["ordinal"] != ordinal
            or checkpoint["ordinal"] != ordinal
            or checkpoint["revealOrdinal"] != ordinal
            or checkpoint["observedMonotonicMs"] != observed
            or event["chapterIndex"] != slot["chapterIndex"]
            or event["plannedOffsetMs"] != slot["plannedOffsetMs"]
            or event["chapterArtifact"] != slot["cipherChapterArtifact"]
            or observed < slot["plannedOffsetMs"] - REVEAL_EARLY_TOLERANCE_MS
            or observed > slot["plannedOffsetMs"] + REVEAL_LATE_TOLERANCE_MS
            or observed < previous_time
        ):
            raise ValueError("Attempt event or checkpoint ordering does not match the declaration.")
        expected_previous = response_chain[-1] if response_chain else None
        if checkpoint["previousResponseId"] != expected_previous:
            raise ValueError("Checkpoint response chain is ambiguous.")
        if any(
            support > checkpoint["revealOrdinal"]
            for mapping in checkpoint["mappings"]
            for support in mapping["supportingRevealOrdinals"]
        ):
            raise ValueError("Checkpoint mapping cites unreleased evidence.")
        response_chain.append(checkpoint["responseId"])
        container_ids.add(checkpoint["containerId"])
        reveal_times[ordinal] = observed
        previous_time = observed

    if (
        completion.get("attemptId") != identity.attempt_id
        or completion.get("status") != "solver-completed"
        or completion.get("checkpointCount") != len(checkpoints)
        or completion.get("responseChain") != response_chain
        or len(container_ids) != 1
        or completion.get("containerId") not in container_ids
    ):
        raise ValueError("Solver completion does not bind the exact checkpoint chain.")
    return reveal_times
