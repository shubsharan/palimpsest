from __future__ import annotations

from palimpsest.baselines.ngram import NgramModel, optimize_mapping


def test_ngram_optimizer_is_seeded_and_never_degrades_its_objective() -> None:
    reference = "the cat sat on the mat the cat ate the fish"
    cipher = "cat the sat on cat mat"
    initial = {"cat": "the", "the": "cat", "sat": "on", "on": "sat", "mat": "fish"}
    model = NgramModel.from_text(reference)
    first = optimize_mapping(cipher, initial, model, seed_hex="12" * 32, iterations=100)
    second = optimize_mapping(cipher, initial, model, seed_hex="12" * 32, iterations=100)
    assert first == second
    assert first.score >= first.initial_score
