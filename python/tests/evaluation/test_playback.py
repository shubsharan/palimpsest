from palimpsest.evaluation.playback import playback_delta


def test_playback_delta_marks_new_correct_regressed_and_changed_words() -> None:
    result = playback_delta(
        "The cat sat still.",
        "Foo cat baz still.",
        "The dog sat still.",
    )

    assert result["matchedWords"] == 3
    assert result["totalWords"] == 4
    assert result["accuracy"] == 0.75
    assert result["deltas"] == [
        {"index": 0, "candidate": "The", "state": "newly-correct"},
        {"index": 1, "candidate": "dog", "state": "regressed"},
        {"index": 2, "candidate": "sat", "state": "newly-correct"},
    ]
    assert result["newlyCorrectRanges"] == [
        {"start": 0, "end": 0},
        {"start": 2, "end": 2},
    ]


def test_playback_delta_retains_positional_missingness() -> None:
    result = playback_delta("one two three", "one two three", "one two")

    assert result["coverage"] == 2 / 3
    assert result["predictedWordCount"] == 2
    assert result["deltas"] == [
        {"index": 2, "candidate": None, "state": "regressed"},
    ]
