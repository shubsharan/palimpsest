from __future__ import annotations

from palimpsest.puzzle.score import score_reconstruction


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
    score = score_reconstruction("one two three", "one unresolved three")
    assert score.matched_words == 2
    assert score.total_words == 3
    assert score.accuracy == 2 / 3
