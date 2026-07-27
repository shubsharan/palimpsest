from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st
from palimpsest.generation.text import (
    canonicalize_capitalization,
    render,
    tokenize,
    word_tokens,
)


@given(st.text(max_size=200))
def test_token_spans_cover_input_exactly(value: str) -> None:
    normalized = __import__("unicodedata").normalize(
        "NFC", value.replace("\r\n", "\n").replace("\r", "\n")
    )
    assert render(tokenize(value)) == normalized


def test_unicode_letters_and_internal_apostrophes_are_one_word() -> None:
    assert [span.surface for span in word_tokens("\u00c9lodie can't O\u2019Neill 42_x")] == [
        "\u00c9lodie",
        "can't",
        "O\u2019Neill",
        "x",
    ]


def test_normalized_types_are_nfc_casefolded() -> None:
    tokens = word_tokens("CAFÉ Cafe\u0301")
    assert [token.normalized for token in tokens] == ["café", "café"]


def test_mixed_capitalization_is_canonicalized_before_ciphering() -> None:
    assert canonicalize_capitalization("eBook McGonagall NASA lower Title") == (
        "ebook Mcgonagall NASA lower Title"
    )
