from __future__ import annotations

from decimal import Decimal
from typing import Any

from .config import DECISION_THRESHOLDS


def _decimal(value: float | int) -> Decimal:
    return Decimal(str(value))


def _difference_at_least(left: float, right: float, threshold: float) -> bool:
    return _decimal(left) - _decimal(right) >= _decimal(threshold)


def classify_gate_b(
    *,
    mechanical: dict[str, float],
    agent: dict[str, list[float]],
    human: dict[str, list[float]],
    audits: dict[str, dict[str, float | int]],
    recognition: dict[str, bool],
    function_accuracy: float,
    rare_content_accuracy: float,
    entity_accuracy: float,
) -> dict[str, Any]:
    instance_ids = sorted(set(mechanical) | set(audits) | set(recognition))
    integrity_failures = []
    if len(instance_ids) < 4:
        integrity_failures.append("fewer than four retained instances")
    for instance_id in instance_ids:
        if instance_id not in mechanical:
            integrity_failures.append(f"{instance_id}: missing mechanical result")
        if len(agent.get(instance_id, [])) < 2:
            integrity_failures.append(f"{instance_id}: missing agent trajectory")
        if len(human.get(instance_id, [])) < 2:
            integrity_failures.append(f"{instance_id}: missing human trajectory")
        if instance_id not in audits:
            integrity_failures.append(f"{instance_id}: missing entity audit")
        if instance_id not in recognition:
            integrity_failures.append(f"{instance_id}: missing recognition verdict")
    predicates = []
    for instance_id in instance_ids:
        mechanical_score = mechanical.get(instance_id, 1.0)
        agent_scores = agent.get(instance_id, [])
        human_scores = human.get(instance_id, [])
        agent_first = agent_scores[0] if agent_scores else 0.0
        agent_final = agent_scores[-1] if agent_scores else 0.0
        human_first = human_scores[0] if human_scores else 0.0
        human_final = human_scores[-1] if human_scores else 0.0
        predicates.append(
            {
                "instanceId": instance_id,
                "mechanicalHeadroom": (
                    _decimal(mechanical_score)
                    < _decimal(DECISION_THRESHOLDS["mechanicalMaximumExclusive"])
                    and _decimal(1) - _decimal(mechanical_score)
                    >= _decimal(DECISION_THRESHOLDS["mechanicalUnresolvedMinimumInclusive"])
                ),
                "agentProgress": (
                    _difference_at_least(
                        agent_final,
                        agent_first,
                        DECISION_THRESHOLDS["capableGainMinimumInclusive"],
                    )
                    or _difference_at_least(
                        agent_final,
                        mechanical_score,
                        DECISION_THRESHOLDS["capableGainMinimumInclusive"],
                    )
                ),
                "humanProgress": (
                    _difference_at_least(
                        human_final,
                        human_first,
                        DECISION_THRESHOLDS["capableGainMinimumInclusive"],
                    )
                    or _difference_at_least(
                        human_final,
                        mechanical_score,
                        DECISION_THRESHOLDS["capableGainMinimumInclusive"],
                    )
                ),
                "capableFloor": (
                    _decimal(agent_final)
                    >= _decimal(DECISION_THRESHOLDS["capableFinalMinimumInclusive"])
                    and _decimal(human_final)
                    >= _decimal(DECISION_THRESHOLDS["capableFinalMinimumInclusive"])
                ),
                "recognitionSafe": not recognition.get(instance_id, True),
            }
        )
    entity_acceptable = all(
        _decimal(audit["repeatedMentionConsistency"])
        >= _decimal(DECISION_THRESHOLDS["entityConsistencyMinimumInclusive"])
        and _decimal(audit["missedEntityRate"])
        <= _decimal(DECISION_THRESHOLDS["entityMissedMaximumInclusive"])
        and _decimal(audit["commonNounOverCaptureRate"])
        <= _decimal(DECISION_THRESHOLDS["commonNounOverCaptureMaximumInclusive"])
        and audit["generatedNameCollisions"] == DECISION_THRESHOLDS["generatedNameCollisions"]
        for audit in audits.values()
    )
    designed_residual = (
        function_accuracy > rare_content_accuracy and function_accuracy > entity_accuracy
    )
    if integrity_failures:
        classification = "invalid"
    elif (
        all(
            all(
                predicate[name]
                for name in (
                    "mechanicalHeadroom",
                    "agentProgress",
                    "humanProgress",
                    "capableFloor",
                    "recognitionSafe",
                )
            )
            for predicate in predicates
        )
        and entity_acceptable
        and designed_residual
    ):
        classification = "pass"
    elif any(not predicate["mechanicalHeadroom"] for predicate in predicates) or any(
        not predicate["agentProgress"]
        or not predicate["humanProgress"]
        or not predicate["capableFloor"]
        for predicate in predicates
    ):
        classification = "stop"
    else:
        classification = "rework"
    return {
        "schemaVersion": 1,
        "contractId": "gate-b-decision-analysis",
        "instancePredicates": predicates,
        "designedResidual": designed_residual,
        "entityAcceptable": entity_acceptable,
        "integrityFailures": integrity_failures,
        "classification": classification,
    }
