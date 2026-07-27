from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence

import numpy as np
from scipy.optimize import linear_sum_assignment


def score_entity_roles(
    truth_roles: Sequence[str | None],
    predicted_roles: Sequence[str | None],
) -> dict[str, float]:
    if len(truth_roles) != len(predicted_roles):
        raise ValueError("Entity role sequences must have the same length.")
    entity_positions = [
        index for index, truth_role in enumerate(truth_roles) if truth_role is not None
    ]
    if not entity_positions:
        return {"strictAccuracy": 0.0, "assignmentAccuracy": 0.0}
    strict_matches = sum(truth_roles[index] == predicted_roles[index] for index in entity_positions)
    truth_labels = sorted({truth_roles[index] for index in entity_positions})
    predicted_labels = sorted(
        {predicted_roles[index] for index in entity_positions if predicted_roles[index] is not None}
    )
    if not predicted_labels:
        return {
            "strictAccuracy": strict_matches / len(entity_positions),
            "assignmentAccuracy": 0.0,
        }
    overlaps: dict[tuple[str, str], int] = defaultdict(int)
    for index in entity_positions:
        truth = truth_roles[index]
        predicted = predicted_roles[index]
        if truth is not None and predicted is not None:
            overlaps[(truth, predicted)] += 1
    size = max(len(truth_labels), len(predicted_labels))
    cost = np.zeros((size, size), dtype=np.int64)
    for truth_index, truth in enumerate(truth_labels):
        for predicted_index, predicted in enumerate(predicted_labels):
            cost[truth_index, predicted_index] = -overlaps[(truth, predicted)]
    truth_assignment, predicted_assignment = linear_sum_assignment(cost)
    assigned_matches = sum(
        -cost[left, right]
        for left, right in zip(truth_assignment, predicted_assignment, strict=True)
    )
    return {
        "strictAccuracy": strict_matches / len(entity_positions),
        "assignmentAccuracy": float(assigned_matches) / len(entity_positions),
    }
