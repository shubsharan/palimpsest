from __future__ import annotations

import math

from palimpsest.grading.reconstruction import score_reconstruction


def test_exact_reconstruction_scores_one_in_every_nonempty_slice() -> None:
    truth = "The rare fox met Elodie. The fox ran."
    scores = score_reconstruction(
        truth,
        truth,
        reference_counts={"the": 100, "fox": 2, "met": 10, "ran": 3},
        entity_types={"elodie"},
    )
    assert scores["tokenAccuracy"] == 1
    assert scores["unresolvedTokenMass"] == 0
    assert scores["macroTypeAccuracy"] == 1
    assert scores["weightedTokenAccuracy"] == 1
    assert scores["classes"] == {"content": 1, "entity": 1, "function": 1}


def test_weighted_accuracy_caps_tail_weight_and_reports_mismatch() -> None:
    scores = score_reconstruction(
        "the xylophone",
        "the wrong",
        reference_counts={"the": 1_000},
        entity_types=set(),
    )
    assert scores["tokenAccuracy"] == 0.5
    assert scores["unresolvedTokenMass"] == 0.5
    assert 0 < scores["weightedTokenAccuracy"] < 0.5
    assert math.isfinite(scores["weightedTokenAccuracy"])


def test_token_count_mismatch_is_rejected() -> None:
    try:
        score_reconstruction("one two", "one", reference_counts={}, entity_types=set())
    except ValueError as error:
        assert "token count" in str(error)
    else:
        raise AssertionError("Token-count mismatch was accepted.")
