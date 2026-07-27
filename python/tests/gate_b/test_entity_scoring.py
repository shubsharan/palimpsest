from __future__ import annotations

import pytest
from palimpsest.grading.entities import score_entity_roles


def test_entity_assignment_is_invariant_to_role_labels() -> None:
    result = score_entity_roles(
        ["person-a", "person-a", "place-b", "place-b", None],
        ["x", "x", "y", "y", "noise"],
    )
    assert result == {"strictAccuracy": 0.0, "assignmentAccuracy": 1.0}


def test_entity_scores_use_only_truth_entity_positions() -> None:
    result = score_entity_roles(
        ["person-a", None, "person-a", "place-b"],
        ["person-a", "spurious", None, "place-b"],
    )
    assert result["strictAccuracy"] == pytest.approx(2 / 3)
    assert result["assignmentAccuracy"] == pytest.approx(2 / 3)


def test_entity_score_rejects_mismatched_denominators() -> None:
    with pytest.raises(ValueError, match="same length"):
        score_entity_roles(["person-a"], [])
