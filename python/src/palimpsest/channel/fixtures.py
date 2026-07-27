from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass

TOKEN_PATTERN = re.compile(r"\w+(?:['\u2019]\w+)*|[^\w\s]|\s+", re.UNICODE)


@dataclass(frozen=True)
class OpaqueShard:
    rendered: bytes
    token_count: int
    token_ids: tuple[int, ...]
    vocabulary: tuple[str, ...]


def normalize_source_text(source: str) -> str:
    normalized = unicodedata.normalize("NFC", source.replace("\r\n", "\n").replace("\r", "\n"))
    if any(0xD800 <= ord(character) <= 0xDFFF for character in normalized):
        raise ValueError("Source text contains a surrogate code point.")
    return normalized


def _is_word(token: str) -> bool:
    return bool(token) and (token[0].isalnum() or token[0] == "_")


def build_opaque_shard(source: str, *, token_count: int, vocabulary_size: int) -> OpaqueShard:
    if token_count <= 0:
        raise ValueError("token_count must be positive.")
    if vocabulary_size < 2:
        raise ValueError("vocabulary_size must leave room for an overflow bucket.")

    pieces = TOKEN_PATTERN.findall(normalize_source_text(source))
    corpus_words = [piece.casefold() for piece in pieces if _is_word(piece)]
    frequencies = Counter(corpus_words)
    if len(frequencies) < vocabulary_size:
        raise ValueError(
            f"Source corpus provides {len(frequencies)} word types, "
            f"expected at least {vocabulary_size}."
        )
    selected: list[str] = []
    words: list[str] = []
    for piece in pieces:
        if len(words) >= token_count and _is_word(piece):
            break
        selected.append(piece)
        if _is_word(piece):
            words.append(piece.casefold())
    if len(words) != token_count:
        raise ValueError(f"Source provides {len(words)} word tokens, expected {token_count}.")

    retained = sorted(frequencies, key=lambda word: (-frequencies[word], word))[
        : vocabulary_size - 1
    ]
    vocabulary = tuple([*sorted(retained), "<overflow>"])
    identifiers = {word: index for index, word in enumerate(vocabulary)}
    overflow = identifiers["<overflow>"]
    token_ids = tuple(identifiers.get(word, overflow) for word in words)

    rendered = render_token_ids(
        source,
        token_ids,
        token_count=token_count,
        vocabulary_size=vocabulary_size,
    )
    return OpaqueShard(
        rendered=rendered,
        token_count=token_count,
        token_ids=token_ids,
        vocabulary=vocabulary,
    )


def render_token_ids(
    source: str,
    token_ids: tuple[int, ...],
    *,
    token_count: int,
    vocabulary_size: int,
) -> bytes:
    if len(token_ids) != token_count:
        raise ValueError("Token identifier count does not match the declared geometry.")
    if any(token_id < 0 or token_id >= vocabulary_size for token_id in token_ids):
        raise ValueError("Token identifier is outside the declared vocabulary.")
    pieces = TOKEN_PATTERN.findall(normalize_source_text(source))
    selected: list[str] = []
    word_count = 0
    for piece in pieces:
        if word_count >= token_count and _is_word(piece):
            break
        selected.append(piece)
        if _is_word(piece):
            word_count += 1
    if word_count != token_count:
        raise ValueError(f"Source provides {word_count} word tokens, expected {token_count}.")

    width = max(4, len(f"{vocabulary_size - 1:x}"))
    rendered_parts: list[str] = []
    word_index = 0
    for piece in selected:
        if _is_word(piece):
            rendered_parts.append(f"w{token_ids[word_index]:0{width}x}")
            word_index += 1
        else:
            rendered_parts.append(piece)
    return "".join(rendered_parts).encode("utf-8")
