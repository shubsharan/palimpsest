from __future__ import annotations

from collections import Counter

import pytest
from hypothesis import given
from hypothesis import strategies as st
from palimpsest.gate_c.revision import apply_regimes, build_revision
from palimpsest.generation.cipher import apply_mapping
from palimpsest.generation.key import stationary_key


def fixture_tokens() -> tuple[list[str], list[str], list[str]]:
    vocabulary = [f"word{letter}" for letter in "abcdefghijklmnopqrstuvwx"]
    pre = [word for index, word in enumerate(vocabulary) for _ in range(8 + index)]
    post = [word for index, word in enumerate(reversed(vocabulary)) for _ in range(8 + index)]
    return vocabulary, pre, post


def test_revision_is_deterministic_bijective_and_localized() -> None:
    vocabulary, pre, post = fixture_tokens()
    key = stationary_key(vocabulary, "11" * 32)
    first = build_revision(
        stationary_key=key,
        pre_tokens=pre,
        post_tokens=post,
        seed_hex="22" * 32,
        minimum_occurrences=8,
        stratum_count=4,
        token_mass_target=0.2,
    )
    second = build_revision(
        stationary_key=key,
        pre_tokens=list(reversed(pre)),
        post_tokens=list(reversed(post)),
        seed_hex="22" * 32,
        minimum_occurrences=8,
        stratum_count=4,
        token_mass_target=0.2,
    )
    assert first == second
    assert set(first.revised_key) == set(first.revised_key.values()) == set(key)
    changed = {entry.plain_type for entry in first.changed_entries}
    assert {entry.frequency_stratum for entry in first.changed_entries} == {0, 1, 2, 3}
    assert all(first.revised_key[word] != key[word] for word in changed)
    assert all(first.revised_key[word] != word for word in changed)
    assert all(first.revised_key[word] == key[word] for word in set(key) - changed)


def test_controls_are_unique_frequency_matched_and_unchanged() -> None:
    vocabulary, pre, post = fixture_tokens()
    key = stationary_key(vocabulary, "11" * 32)
    result = build_revision(
        stationary_key=key,
        pre_tokens=pre,
        post_tokens=post,
        seed_hex="22" * 32,
        minimum_occurrences=8,
        stratum_count=4,
        token_mass_target=0.2,
    )
    controls = [control.plain_type for control in result.matched_controls]
    assert len(controls) == len(set(controls)) == len(result.changed_entries)
    assert set(controls).isdisjoint(entry.plain_type for entry in result.changed_entries)
    assert all(result.revised_key[word] == key[word] for word in controls)
    assert all(
        control.frequency_stratum
        == next(
            entry.frequency_stratum
            for entry in result.changed_entries
            if entry.plain_type == control.matched_changed_type
        )
        for control in result.matched_controls
    )


def test_changed_mass_reaches_declared_target() -> None:
    vocabulary, pre, post = fixture_tokens()
    result = build_revision(
        stationary_key=stationary_key(vocabulary, "11" * 32),
        pre_tokens=pre,
        post_tokens=post,
        seed_hex="22" * 32,
        minimum_occurrences=8,
        stratum_count=4,
        token_mass_target=0.2,
    )
    counts = Counter(post)
    eligible_mass = sum(counts.values())
    changed_mass = sum(counts[entry.plain_type] for entry in result.changed_entries)
    assert changed_mass / eligible_mass >= 0.2


def test_regime_application_uses_only_the_revised_suffix() -> None:
    value = "Alpha beta gamma delta."
    stationary = {"alpha": "beta", "beta": "gamma", "delta": "alpha", "gamma": "delta"}
    revised = {"alpha": "gamma", "beta": "delta", "delta": "beta", "gamma": "alpha"}
    assert (
        apply_regimes(
            value,
            stationary_key=stationary,
            revised_key=revised,
            switch_word_offset=2,
        )
        == "Beta gamma alpha beta."
    )
    assert apply_mapping("Alpha beta.", stationary) == "Beta gamma."


@given(st.integers(max_value=0))
def test_regime_application_rejects_nonpositive_switch(offset: int) -> None:
    with pytest.raises(ValueError, match="Switch offset"):
        apply_regimes(
            "Alpha beta.",
            stationary_key={"alpha": "beta", "beta": "alpha"},
            revised_key={"alpha": "beta", "beta": "alpha"},
            switch_word_offset=offset,
        )
