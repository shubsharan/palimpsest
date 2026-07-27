from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

WORD_PATTERN = re.compile(r"[^\W\d_]+(?:['\u2019][^\W\d_]+)*", re.UNICODE)


@dataclass(frozen=True)
class TextSpan:
    surface: str
    normalized: str | None
    is_word: bool


def _normalize_text(value: str) -> str:
    return unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))


def tokenize(value: str) -> list[TextSpan]:
    normalized_text = _normalize_text(value)
    spans: list[TextSpan] = []
    cursor = 0
    for match in WORD_PATTERN.finditer(normalized_text):
        if match.start() > cursor:
            spans.append(TextSpan(normalized_text[cursor : match.start()], None, False))
        surface = match.group(0)
        spans.append(TextSpan(surface, unicodedata.normalize("NFC", surface.casefold()), True))
        cursor = match.end()
    if cursor < len(normalized_text):
        spans.append(TextSpan(normalized_text[cursor:], None, False))
    return spans


def word_tokens(value: str) -> list[TextSpan]:
    return [span for span in tokenize(value) if span.is_word]


def render(spans: list[TextSpan]) -> str:
    return "".join(span.surface for span in spans)


def canonicalize_capitalization(value: str) -> str:
    output: list[TextSpan] = []
    for span in tokenize(value):
        if (
            not span.is_word
            or span.surface.isupper()
            or span.surface.islower()
            or span.surface.istitle()
        ):
            output.append(span)
            continue
        canonical = span.surface.title() if span.surface[0].isupper() else span.surface.lower()
        output.append(TextSpan(canonical, canonical.casefold(), True))
    return render(output)


def apply_capitalization(source: str, replacement: str) -> str:
    if source.istitle():
        return replacement.title()
    if source.isupper():
        return replacement.upper()
    if source.islower():
        return replacement.lower()
    output: list[str] = []
    source_letters = [character for character in source if character.isalpha()]
    letter_index = 0
    for character in replacement:
        if not character.isalpha():
            output.append(character)
            continue
        template = source_letters[min(letter_index, len(source_letters) - 1)]
        output.append(character.upper() if template.isupper() else character.lower())
        letter_index += 1
    return "".join(output)
