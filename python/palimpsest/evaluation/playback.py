from __future__ import annotations

import argparse
from pathlib import Path

from ..puzzle.text import word_tokens
from ..serialization import canonical_json_bytes
from .score import score_reconstruction


def _words(value: str) -> list[tuple[str, str]]:
    return [
        (token.surface, token.normalized)
        for token in word_tokens(value)
        if token.normalized is not None
    ]


def _newly_correct_ranges(states: list[str]) -> list[dict[str, int]]:
    ranges: list[dict[str, int]] = []
    start: int | None = None
    for index, state in enumerate([*states, "end"]):
        if state == "newly-correct" and start is None:
            start = index
        elif state != "newly-correct" and start is not None:
            ranges.append({"start": start, "end": index - 1})
            start = None
    return ranges


def playback_delta(truth: str, previous: str, candidate: str) -> dict[str, object]:
    expected = _words(truth)
    before = _words(previous)
    after = _words(candidate)
    states: list[str] = []
    deltas: list[dict[str, object]] = []
    length = max(len(expected), len(before), len(after))
    for index in range(length):
        expected_word = expected[index][1] if index < len(expected) else None
        before_word = before[index][1] if index < len(before) else None
        after_word = after[index][1] if index < len(after) else None
        before_correct = expected_word is not None and before_word == expected_word
        after_correct = expected_word is not None and after_word == expected_word
        if after_correct and not before_correct:
            state = "newly-correct"
        elif after_correct:
            state = "previously-correct"
        elif before_correct:
            state = "regressed"
        elif before_word != after_word:
            state = "changed-incorrect"
        else:
            state = "unchanged"
        states.append(state)
        previous_state = None
        if before_correct:
            previous_state = "previously-correct"
        if before_word != after_word or state != (previous_state or "unchanged"):
            deltas.append(
                {
                    "index": index,
                    "candidate": after[index][0] if index < len(after) else None,
                    "state": state,
                }
            )
    score = score_reconstruction(truth, candidate)
    return {
        **score.to_dict(),
        "predictedWordCount": len(after),
        "deltas": deltas,
        "newlyCorrectRanges": _newly_correct_ranges(states),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--truth", type=Path, required=True)
    parser.add_argument("--previous", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    args = parser.parse_args()
    result = playback_delta(
        args.truth.read_text(encoding="utf-8"),
        args.previous.read_text(encoding="utf-8"),
        args.candidate.read_text(encoding="utf-8"),
    )
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
