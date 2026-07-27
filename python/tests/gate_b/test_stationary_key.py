from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st
from palimpsest.generation.key import stationary_key


@given(
    st.lists(
        st.text(alphabet=st.characters(categories=("Ll",)), min_size=2, max_size=8),
        min_size=2,
        max_size=80,
        unique=True,
    )
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
