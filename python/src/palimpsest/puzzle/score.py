from __future__ import annotations

import argparse
from pathlib import Path

from palimpsest.contracts import canonical_json_bytes
from palimpsest.generation.text import word_tokens

from .model import AggregateScore


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
