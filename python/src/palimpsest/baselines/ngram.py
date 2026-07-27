from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass

from palimpsest.generation.seeds import DeterministicStream, derive_seed
from palimpsest.generation.text import word_tokens


@dataclass(frozen=True)
class NgramModel:
    trigram_counts: Counter[tuple[str, str, str]]
    context_counts: Counter[tuple[str, str]]
    vocabulary_size: int

    @classmethod
    def from_text(cls, value: str) -> NgramModel:
        words = [token.normalized for token in word_tokens(value) if token.normalized is not None]
        padded = ["<s>", "<s>", *words, "</s>"]
        trigrams = Counter(zip(padded, padded[1:], padded[2:], strict=False))
        contexts = Counter((left, middle) for left, middle, _ in trigrams.elements())
        return cls(trigrams, contexts, max(1, len(set(words))))

    def score(self, words: list[str]) -> float:
        padded = ["<s>", "<s>", *words, "</s>"]
        score = 0.0
        for left, middle, right in zip(padded, padded[1:], padded[2:], strict=False):
            numerator = self.trigram_counts[(left, middle, right)] + 0.05
            denominator = self.context_counts[(left, middle)] + (0.05 * self.vocabulary_size)
            score += math.log(numerator / denominator)
        return score


@dataclass(frozen=True)
class OptimizationResult:
    mapping: dict[str, str]
    initial_score: float
    score: float


def optimize_mapping(
    cipher_text: str,
    initial_mapping: dict[str, str],
    model: NgramModel,
    *,
    seed_hex: str,
    iterations: int,
) -> OptimizationResult:
    cipher_words = [
        token.normalized for token in word_tokens(cipher_text) if token.normalized is not None
    ]
    keys = sorted(initial_mapping)

    def decoded(mapping: dict[str, str]) -> list[str]:
        return [mapping[word] for word in cipher_words]

    current = dict(initial_mapping)
    current_score = model.score(decoded(current))
    initial_score = current_score
    best = dict(current)
    best_score = current_score
    stream = DeterministicStream(derive_seed(seed_hex, "ngram-annealing"))
    for iteration in range(iterations):
        first_index = stream.below(len(keys))
        second_index = stream.below(len(keys) - 1)
        if second_index >= first_index:
            second_index += 1
        first = keys[first_index]
        second = keys[second_index]
        current[first], current[second] = current[second], current[first]
        if current[first] == first or current[second] == second:
            current[first], current[second] = current[second], current[first]
            continue
        candidate_score = model.score(decoded(current))
        temperature = max(0.05, 2.0 * (1 - (iteration / max(1, iterations))))
        delta = candidate_score - current_score
        random_fraction = stream.below(1_000_000) / 1_000_000
        if delta >= 0 or random_fraction < math.exp(delta / temperature):
            current_score = candidate_score
            if candidate_score > best_score:
                best = dict(current)
                best_score = candidate_score
        else:
            current[first], current[second] = current[second], current[first]
    return OptimizationResult(
        mapping=dict(sorted(best.items())), initial_score=initial_score, score=best_score
    )
