from __future__ import annotations

from collections import Counter

from palimpsest.generation.cipher import apply_mapping
from palimpsest.generation.text import word_tokens


def cipher_counts(cipher_text: str) -> Counter[str]:
    return Counter(
        token.normalized for token in word_tokens(cipher_text) if token.normalized is not None
    )


def reconstruct(cipher_text: str, mapping: dict[str, str]) -> str:
    return apply_mapping(cipher_text, mapping)


def repair_fixed_points(mapping: dict[str, str]) -> dict[str, str]:
    fixed = sorted(word for word, value in mapping.items() if word == value)
    if not fixed:
        return dict(sorted(mapping.items()))
    if len(fixed) == 1:
        fixed_word = fixed[0]
        swap_word = next(word for word in sorted(mapping) if word != fixed_word)
        mapping[fixed_word], mapping[swap_word] = mapping[swap_word], mapping[fixed_word]
    else:
        values = [mapping[word] for word in fixed]
        for index, word in enumerate(fixed):
            mapping[word] = values[(index + 1) % len(values)]
    return dict(sorted(mapping.items()))
