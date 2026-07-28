from __future__ import annotations

import json
from pathlib import Path

import pytest
from palimpsest.evaluation.score import AggregateScore, score_reconstruction

ROOT = Path(__file__).resolve().parents[3]
GOLDEN = json.loads((ROOT / "tests/golden/behavior.json").read_text(encoding="utf-8"))


def test_exact_reconstruction_scores_one() -> None:
    assert score_reconstruction("Alpha beta gamma.", "alpha BETA gamma!").to_dict() == {
        "matchedWords": 3,
        "totalWords": 3,
        "coverage": 1.0,
        "accuracy": 1.0,
    }


def test_missing_and_extra_tokens_count_as_incorrect_without_raising() -> None:
    missing = score_reconstruction("one two three four", "one two")
    assert missing.matched_words == 2
    assert missing.total_words == 4
    assert missing.coverage == 0.5
    assert missing.accuracy == 0.5

    extra = score_reconstruction("one two", "one two three four")
    assert extra.matched_words == 2
    assert extra.total_words == 4
    assert extra.coverage == 1.0
    assert extra.accuracy == 0.5


def test_wrong_or_unresolved_tokens_are_ordinary_mismatches() -> None:
    expected = GOLDEN["offlineFixture"]["evaluationScore"]
    word_count = expected["totalWords"]
    score = score_reconstruction("truth " * word_count, "candidate " * word_count)
    assert score.to_dict() == expected


def test_aggregate_score_is_bounded_and_serializes_without_detail() -> None:
    score = AggregateScore(matched_words=3, total_words=5, coverage=0.8, accuracy=0.6)
    assert score.to_dict() == {
        "matchedWords": 3,
        "totalWords": 5,
        "coverage": 0.8,
        "accuracy": 0.6,
    }
    with pytest.raises(ValueError, match="bounded"):
        AggregateScore(matched_words=0, total_words=1, coverage=1.1, accuracy=0.0)
    with pytest.raises(ValueError, match="counts"):
        AggregateScore(matched_words=0.5, total_words=1, coverage=1.0, accuracy=0.5)
