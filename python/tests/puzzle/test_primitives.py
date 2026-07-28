from __future__ import annotations

import unicodedata
from collections import Counter

import pytest
from palimpsest.puzzle.cipher import stationary_key
from palimpsest.puzzle.revision import build_revision, build_successive_revision
from palimpsest.puzzle.text import (
    canonicalize_capitalization,
    render,
    tokenize,
    word_tokens,
)


@pytest.mark.parametrize(
    "vocabulary",
    [
        ["alpha", "beta"],
        ["alpha", "beta", "gamma", "delta"],
        ["élodie", "garçon", "naïve", "résumé"],
        [f"word{letter}" for letter in "abcdefghijklmnopqrst"],
    ],
)
def test_stationary_key_is_repeatable_bijective_derangement(vocabulary: list[str]) -> None:
    first = stationary_key(vocabulary, "ab" * 32)
    second = stationary_key(list(reversed(vocabulary)), "ab" * 32)
    assert first == second
    assert set(first) == set(vocabulary)
    assert set(first.values()) == set(vocabulary)
    assert all(plain != cipher for plain, cipher in first.items())


def test_single_and_multi_letter_types_never_cross() -> None:
    mapping = stationary_key(["a", "i", "alpha", "beta"], "cd" * 32)
    assert {mapping["a"], mapping["i"]} == {"a", "i"}


@pytest.mark.parametrize(
    "value",
    [
        "",
        "plain text",
        "line one\r\nline two",
        "CAFÉ Cafe\u0301",
        "Élodie can't O\u2019Neill 42_x",
    ],
)
def test_token_spans_cover_normalized_input(value: str) -> None:
    normalized = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))
    assert render(tokenize(value)) == normalized


def test_unicode_letters_and_internal_apostrophes_are_one_word() -> None:
    assert [span.surface for span in word_tokens("Élodie can't O\u2019Neill 42_x")] == [
        "Élodie",
        "can't",
        "O\u2019Neill",
        "x",
    ]


def test_normalized_types_are_nfc_casefolded() -> None:
    assert [token.normalized for token in word_tokens("CAFÉ Cafe\u0301")] == ["café", "café"]


def test_mixed_capitalization_is_canonicalized_before_ciphering() -> None:
    assert canonicalize_capitalization("eBook McGonagall NASA lower Title") == (
        "ebook Mcgonagall NASA lower Title"
    )


def _revision_fixture() -> tuple[list[str], list[str], list[str]]:
    vocabulary = [f"word{letter}" for letter in "abcdefghijklmnopqrstuvwx"]
    pre = [word for index, word in enumerate(vocabulary) for _ in range(8 + index)]
    post = [word for index, word in enumerate(reversed(vocabulary)) for _ in range(8 + index)]
    return vocabulary, pre, post


def test_revision_is_deterministic_bijective_and_localized() -> None:
    vocabulary, pre, post = _revision_fixture()
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


def test_revision_controls_are_unique_matched_and_unchanged() -> None:
    vocabulary, pre, post = _revision_fixture()
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


def test_revision_changed_mass_reaches_target() -> None:
    vocabulary, pre, post = _revision_fixture()
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
    changed_mass = sum(counts[entry.plain_type] for entry in result.changed_entries)
    assert changed_mass / sum(counts.values()) >= 0.2


def test_successive_revision_uses_the_immediately_preceding_key() -> None:
    vocabulary, pre, post = _revision_fixture()
    base = stationary_key(vocabulary, "11" * 32)
    first = build_revision(
        stationary_key=base,
        pre_tokens=pre,
        post_tokens=post,
        seed_hex="22" * 32,
        minimum_occurrences=8,
        stratum_count=4,
        token_mass_target=0.2,
    )
    second = build_successive_revision(
        prior_key=first.revised_key,
        pre_tokens=post,
        post_tokens=pre,
        seed_hex="33" * 32,
        minimum_occurrences=8,
        stratum_count=4,
        token_mass_target=0.2,
    )

    second_changed = {entry.plain_type for entry in second.changed_entries}
    assert all(second.revised_key[word] != first.revised_key[word] for word in second_changed)
    assert all(
        second.revised_key[word] == first.revised_key[word]
        for word in set(vocabulary) - second_changed
    )
