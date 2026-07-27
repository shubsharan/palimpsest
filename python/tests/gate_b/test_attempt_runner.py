from __future__ import annotations

from palimpsest.baselines.runner import validate_complete_mapping


def test_complete_mapping_requires_exact_cipher_vocabulary_and_bijection() -> None:
    validate_complete_mapping("a b a c", {"a": "b", "b": "c", "c": "a"})
    invalid = [
        {"a": "b", "b": "a"},
        {"a": "b", "b": "b", "c": "a"},
        {"a": "b", "b": "b", "c": "b"},
    ]
    for mapping in invalid:
        try:
            validate_complete_mapping("a b a c", mapping)
        except ValueError:
            continue
        raise AssertionError(f"Invalid mapping was accepted: {mapping}")
