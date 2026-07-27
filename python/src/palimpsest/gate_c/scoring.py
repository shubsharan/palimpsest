from __future__ import annotations

from typing import Any


def _active_mappings(checkpoint: dict[str, Any]) -> dict[str, str]:
    active: dict[str, str] = {}
    for mapping in checkpoint["mappings"]:
        if mapping["status"] != "active":
            continue
        cipher_type = mapping["cipherType"]
        if cipher_type in active:
            raise ValueError(f"Checkpoint contains duplicate active cipher type: {cipher_type}.")
        active[cipher_type] = mapping["plainType"]
    return active


def score_mapping_accuracy(
    checkpoint: dict[str, Any],
    *,
    changed_entries: list[dict[str, Any]],
    matched_controls: list[dict[str, Any]],
    revised_regime: bool,
) -> tuple[float, float]:
    active = _active_mappings(checkpoint)
    changed_correct = sum(
        active.get(entry["revisedCipherType"] if revised_regime else entry["priorCipherType"])
        == entry["plainType"]
        for entry in changed_entries
    )
    stable_correct = sum(
        active.get(control["cipherType"]) == control["plainType"] for control in matched_controls
    )
    return (
        changed_correct / len(changed_entries) if changed_entries else 0.0,
        stable_correct / len(matched_controls) if matched_controls else 0.0,
    )


def _percentage_points(value: float) -> float:
    return round(value * 100, 10)


def build_trajectory(
    *,
    attempt_id: str,
    checkpoints: list[dict[str, Any]],
    changed_entries: list[dict[str, Any]],
    matched_controls: list[dict[str, Any]],
    contradiction_reveal_ordinal: int,
    switch_after_chapter: int,
    reveal_times_ms: dict[int, int],
) -> dict[str, Any]:
    integrity_failures: list[str] = []
    ordered = sorted(checkpoints, key=lambda item: item["ordinal"])
    if not ordered:
        raise ValueError("At least one solver checkpoint is required.")
    for index, checkpoint in enumerate(ordered, start=1):
        if checkpoint["attemptId"] != attempt_id:
            integrity_failures.append(f"checkpoint {index} attempt identity mismatch")
        if checkpoint["ordinal"] != index:
            integrity_failures.append(f"checkpoint ordinal {checkpoint['ordinal']} is out of order")
        if index > 1 and checkpoint["revealOrdinal"] < ordered[index - 2]["revealOrdinal"]:
            integrity_failures.append(f"checkpoint {index} reveal ordinal regressed")
        if (
            index > 1
            and checkpoint["observedMonotonicMs"] < ordered[index - 2]["observedMonotonicMs"]
        ):
            integrity_failures.append(f"checkpoint {index} monotonic time regressed")

    scores: list[dict[str, Any]] = []
    for checkpoint in ordered:
        revised = checkpoint["revealOrdinal"] >= contradiction_reveal_ordinal
        changed_accuracy, stable_accuracy = score_mapping_accuracy(
            checkpoint,
            changed_entries=changed_entries,
            matched_controls=matched_controls,
            revised_regime=revised,
        )
        scores.append(
            {
                "checkpointOrdinal": checkpoint["ordinal"],
                "revealOrdinal": checkpoint["revealOrdinal"],
                "observedMonotonicMs": checkpoint["observedMonotonicMs"],
                "changedAccuracy": changed_accuracy,
                "stableAccuracy": stable_accuracy,
            }
        )

    pre_scores = [
        score for score in scores if score["revealOrdinal"] < contradiction_reveal_ordinal
    ]
    post_scores = [
        score for score in scores if score["revealOrdinal"] >= contradiction_reveal_ordinal
    ]
    if not pre_scores:
        integrity_failures.append("no pre-threshold checkpoint")
        pre_scores = [scores[0]]
    if not post_scores:
        integrity_failures.append("no post-threshold checkpoint")
        post_scores = [scores[-1]]

    first_aggregate = (scores[0]["changedAccuracy"] + scores[0]["stableAccuracy"]) / 2
    best_pre_aggregate = max(
        (score["changedAccuracy"] + score["stableAccuracy"]) / 2 for score in pre_scores
    )
    best_pre_changed = max(score["changedAccuracy"] for score in pre_scores)
    best_pre_stable = max(score["stableAccuracy"] for score in pre_scores)
    first_post = post_scores[0]
    localized_drop = (best_pre_changed - first_post["changedAccuracy"]) - (
        best_pre_stable - first_post["stableAccuracy"]
    )

    threshold_time = reveal_times_ms[contradiction_reveal_ordinal]
    premature_alarm_count = 0
    credited_detection: dict[str, Any] | None = None
    for checkpoint in ordered:
        hypotheses = checkpoint["switchHypotheses"]
        if checkpoint["observedMonotonicMs"] < threshold_time:
            premature_alarm_count += len(hypotheses)
            continue
        if credited_detection is None and any(
            hypothesis["afterChapter"] == switch_after_chapter for hypothesis in hypotheses
        ):
            credited_detection = checkpoint

    detection_time = (
        credited_detection["observedMonotonicMs"] if credited_detection is not None else None
    )
    after_detection = (
        [score for score in post_scores if score["observedMonotonicMs"] >= detection_time]
        if detection_time is not None
        else []
    )
    post_min = min(score["changedAccuracy"] for score in post_scores)
    changed_recovery = (
        max(score["changedAccuracy"] for score in after_detection) - post_min
        if after_detection
        else 0.0
    )
    adaptation_time = next(
        (
            score["observedMonotonicMs"]
            for score in after_detection
            if score["changedAccuracy"] - post_min >= 0.10
        ),
        None,
    )

    correct_pre_controls: set[str] = set()
    for checkpoint, score in zip(ordered, scores, strict=True):
        if score["revealOrdinal"] >= contradiction_reveal_ordinal:
            continue
        active = _active_mappings(checkpoint)
        correct_pre_controls.update(
            control["plainType"]
            for control in matched_controls
            if active.get(control["cipherType"]) == control["plainType"]
        )
    final_active = _active_mappings(ordered[-1])
    false_retractions = sum(
        final_active.get(control["cipherType"]) != control["plainType"]
        for control in matched_controls
        if control["plainType"] in correct_pre_controls
    )
    false_retraction_rate = (
        false_retractions / len(correct_pre_controls) if correct_pre_controls else 0.0
    )

    return {
        "schemaVersion": 1,
        "contractId": "revision-trajectory",
        "attemptId": attempt_id,
        "checkpointScores": scores,
        "preSwitchGainPp": _percentage_points(best_pre_aggregate - first_aggregate),
        "localizedDropPp": _percentage_points(localized_drop),
        "changedRecoveryPp": _percentage_points(changed_recovery),
        "stableRetentionPp": _percentage_points(scores[-1]["stableAccuracy"] - best_pre_stable),
        "falseRetractionRate": false_retraction_rate,
        "prematureAlarmCount": premature_alarm_count,
        "detectionLatencyMs": (
            detection_time - threshold_time if detection_time is not None else None
        ),
        "adaptationLatencyMs": (
            adaptation_time - detection_time
            if adaptation_time is not None and detection_time is not None
            else None
        ),
        "integrityFailures": integrity_failures,
    }
