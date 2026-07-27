from __future__ import annotations

from collections import Counter
from typing import Any

from palimpsest.generation.text import word_tokens


def _words(value: str) -> list[str]:
    return [token.normalized for token in word_tokens(value) if token.normalized is not None]


def exact_frequency_signature(value: str) -> tuple[int, ...]:
    return tuple(sorted(Counter(_words(value)).values(), reverse=True))


def vocabulary_jaccard(left: str, right: str) -> float:
    left_types = set(_words(left))
    right_types = set(_words(right))
    union = left_types | right_types
    return len(left_types & right_types) / len(union) if union else 0.0


def rank_candidates(query: str, candidates: dict[str, str]) -> list[dict[str, Any]]:
    query_signature = exact_frequency_signature(query)
    ranked = [
        {
            "candidateId": candidate_id,
            "vocabularyJaccard": vocabulary_jaccard(query, candidate),
            "exactFrequencySignature": exact_frequency_signature(candidate) == query_signature,
        }
        for candidate_id, candidate in candidates.items()
    ]
    return sorted(
        ranked,
        key=lambda candidate: (
            not candidate["exactFrequencySignature"],
            -candidate["vocabularyJaccard"],
            candidate["candidateId"],
        ),
    )
