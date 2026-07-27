from __future__ import annotations

from collections import Counter

from .common import cipher_counts, repair_fixed_points


def frequency_mapping(cipher_text: str, reference_counts: Counter[str]) -> dict[str, str]:
    counts = cipher_counts(cipher_text)
    vocabulary = sorted(counts)
    cipher_rank = sorted(vocabulary, key=lambda word: (-counts[word], word))
    plaintext_rank = sorted(
        vocabulary,
        key=lambda word: (-reference_counts.get(word, 0), word),
    )
    mapping = dict(zip(cipher_rank, plaintext_rank, strict=True))
    return repair_fixed_points(mapping)
