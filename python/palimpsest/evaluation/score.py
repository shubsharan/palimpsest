from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from ..puzzle.text import word_tokens
from ..serialization import canonical_json_bytes


@dataclass(frozen=True)
class AggregateScore:
    matched_words: int
    total_words: int
    coverage: float
    accuracy: float

    def __post_init__(self) -> None:
        if (
            isinstance(self.matched_words, bool)
            or isinstance(self.total_words, bool)
            or not isinstance(self.matched_words, int)
            or not isinstance(self.total_words, int)
            or self.matched_words < 0
            or self.total_words < 0
            or self.matched_words > self.total_words
        ):
            raise ValueError("Aggregate word counts are invalid.")
        if not 0.0 <= self.coverage <= 1.0 or not 0.0 <= self.accuracy <= 1.0:
            raise ValueError("Aggregate coverage and accuracy must be bounded.")

    def to_dict(self) -> dict[str, int | float]:
        return {
            "matchedWords": self.matched_words,
            "totalWords": self.total_words,
            "coverage": self.coverage,
            "accuracy": self.accuracy,
        }


def _normalized_words(value: str) -> list[str]:
    return [token.normalized for token in word_tokens(value) if token.normalized is not None]


def score_reconstruction(truth: str, candidate: str) -> AggregateScore:
    expected = _normalized_words(truth)
    predicted = _normalized_words(candidate)
    matched = sum(left == right for left, right in zip(expected, predicted, strict=False))
    total = max(len(expected), len(predicted))
    coverage = (
        min(len(predicted), len(expected)) / len(expected) if expected else float(not predicted)
    )
    accuracy = matched / total if total else 1.0
    return AggregateScore(
        matched_words=matched,
        total_words=total,
        coverage=coverage,
        accuracy=accuracy,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--truth", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    args = parser.parse_args()
    score = score_reconstruction(
        args.truth.read_text(encoding="utf-8"),
        args.candidate.read_text(encoding="utf-8"),
    )
    print(canonical_json_bytes(score.to_dict()).decode())


if __name__ == "__main__":
    main()
