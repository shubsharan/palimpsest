from __future__ import annotations

from collections import Counter

from palimpsest.baselines.frequency import frequency_mapping
from palimpsest.generation.text import word_tokens


def test_frequency_mapping_is_bijective_and_has_no_fixed_points() -> None:
    cipher = "z z z y y x w"
    reference = Counter({"x": 100, "y": 50, "z": 20, "w": 1})
    mapping = frequency_mapping(cipher, reference)
    vocabulary = {token.normalized for token in word_tokens(cipher)}
    assert set(mapping) == vocabulary
    assert set(mapping.values()) == vocabulary
    assert all(cipher_type != plain_type for cipher_type, plain_type in mapping.items())


def test_frequency_mapping_is_deterministic_under_reference_order() -> None:
    cipher = "a a b c c c d d"
    first = frequency_mapping(cipher, Counter({"a": 1, "b": 2, "c": 3, "d": 4}))
    second = frequency_mapping(cipher, Counter({"d": 4, "c": 3, "b": 2, "a": 1}))
    assert first == second
