from __future__ import annotations

from palimpsest.identification.retrieval import (
    exact_frequency_signature,
    rank_candidates,
)


def test_frequency_signature_is_invariant_to_a_type_bijection() -> None:
    plain = "the fox met the dog and the fox"
    cipher = "x q z x w p x q"
    assert exact_frequency_signature(plain) == exact_frequency_signature(cipher)


def test_target_excluded_catalog_cannot_return_an_exact_alignment() -> None:
    query = "x q z x w p x q"
    candidates = {
        "unrelated": "one two three four five six seven",
        "nearby": "the fox met a dog",
    }
    ranked = rank_candidates(query, candidates)
    assert ranked[0]["candidateId"] == "nearby"
    assert all(candidate["exactFrequencySignature"] is False for candidate in ranked)
