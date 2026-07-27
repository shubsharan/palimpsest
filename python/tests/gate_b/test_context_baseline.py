from __future__ import annotations

from palimpsest.baselines.context import align_context_signatures


def test_context_alignment_preserves_bijection_and_is_deterministic() -> None:
    cipher = "x y x z x y w z x"
    reference = "the fox the dog the fox ran dog the"
    initial = {"w": "ran", "x": "the", "y": "fox", "z": "dog"}
    first = align_context_signatures(cipher, reference, initial, maximum_types=4)
    second = align_context_signatures(cipher, reference, initial, maximum_types=4)
    assert first == second
    assert set(first) == set(initial)
    assert set(first.values()) == set(initial.values())
