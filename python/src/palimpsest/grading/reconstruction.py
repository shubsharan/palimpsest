from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any

from palimpsest.generation.text import word_tokens

FUNCTION_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "but",
    "by",
    "do",
    "for",
    "from",
    "had",
    "has",
    "have",
    "he",
    "her",
    "hers",
    "him",
    "his",
    "i",
    "if",
    "in",
    "is",
    "it",
    "its",
    "me",
    "my",
    "no",
    "not",
    "of",
    "on",
    "or",
    "our",
    "she",
    "so",
    "that",
    "the",
    "their",
    "them",
    "they",
    "this",
    "to",
    "was",
    "we",
    "were",
    "what",
    "when",
    "which",
    "who",
    "will",
    "with",
    "you",
    "your",
}


def _accuracy(matches: list[bool]) -> float:
    return sum(matches) / len(matches) if matches else 0.0


def _frequency_bands(types: list[str]) -> dict[str, str]:
    counts = Counter(types)
    ordered = sorted(counts, key=lambda word: (-counts[word], word))
    return {
        word: f"d{min(10, (rank * 10 // max(1, len(ordered))) + 1):02d}"
        for rank, word in enumerate(ordered)
    }


def _ambiguity_bands(types: list[str]) -> dict[str, str]:
    contexts: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for index, word in enumerate(types):
        left = types[index - 1] if index > 0 else "<start>"
        right = types[index + 1] if index + 1 < len(types) else "<end>"
        contexts[word].add((left, right))
    bands = {}
    for word, values in contexts.items():
        if len(values) >= 10:
            bands[word] = "low"
        elif len(values) >= 4:
            bands[word] = "medium"
        else:
            bands[word] = "high"
    return bands


def score_reconstruction(
    truth: str,
    reconstruction: str,
    *,
    reference_counts: dict[str, int],
    entity_types: set[str],
) -> dict[str, Any]:
    truth_types = [token.normalized for token in word_tokens(truth)]
    predicted_types = [token.normalized for token in word_tokens(reconstruction)]
    if len(truth_types) != len(predicted_types):
        raise ValueError(
            f"Reconstruction token count {len(predicted_types)} does not match truth "
            f"token count {len(truth_types)}."
        )
    matches = [
        truth_type == predicted_type
        for truth_type, predicted_type in zip(truth_types, predicted_types, strict=True)
    ]
    by_type: dict[str, list[bool]] = defaultdict(list)
    for truth_type, matched in zip(truth_types, matches, strict=True):
        assert truth_type is not None
        by_type[truth_type].append(matched)
    frequency_bands = _frequency_bands([word for word in truth_types if word is not None])
    ambiguity_bands = _ambiguity_bands([word for word in truth_types if word is not None])
    frequency_matches: dict[str, list[bool]] = defaultdict(list)
    ambiguity_matches: dict[str, list[bool]] = defaultdict(list)
    class_matches: dict[str, list[bool]] = defaultdict(list)
    reference_total = sum(reference_counts.values())
    weighted_match = 0.0
    weighted_total = 0.0
    for truth_type, matched in zip(truth_types, matches, strict=True):
        assert truth_type is not None
        frequency_matches[frequency_bands[truth_type]].append(matched)
        ambiguity_matches[ambiguity_bands[truth_type]].append(matched)
        if truth_type in entity_types:
            word_class = "entity"
        elif truth_type in FUNCTION_WORDS:
            word_class = "function"
        else:
            word_class = "content"
        class_matches[word_class].append(matched)
        weight = min(
            8.0,
            math.log((reference_total + 1) / (reference_counts.get(truth_type, 0) + 1)) + 1,
        )
        weighted_total += weight
        if matched:
            weighted_match += weight
    token_accuracy = _accuracy(matches)
    return {
        "tokenAccuracy": token_accuracy,
        "unresolvedTokenMass": 1 - token_accuracy,
        "macroTypeAccuracy": _accuracy([all(values) for values in by_type.values()]),
        "weightedTokenAccuracy": weighted_match / weighted_total if weighted_total else 0.0,
        "frequency": {
            f"d{index:02d}": _accuracy(frequency_matches[f"d{index:02d}"]) for index in range(1, 11)
        },
        "classes": {
            name: _accuracy(class_matches[name]) for name in ("content", "entity", "function")
        },
        "ambiguity": {
            name: _accuracy(ambiguity_matches[name]) for name in ("high", "low", "medium")
        },
    }
