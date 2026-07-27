from __future__ import annotations

from .text import TextSpan, apply_capitalization, render, tokenize


def invert_mapping(mapping: dict[str, str]) -> dict[str, str]:
    if len(set(mapping.values())) != len(mapping):
        raise ValueError("Mapping is not injective.")
    return dict(sorted((cipher, plain) for plain, cipher in mapping.items()))


def apply_mapping(value: str, mapping: dict[str, str]) -> str:
    output: list[TextSpan] = []
    for span in tokenize(value):
        if not span.is_word:
            output.append(span)
            continue
        assert span.normalized is not None
        replacement = mapping.get(span.normalized)
        if replacement is None:
            raise ValueError(f"Mapping omits normalized word type: {span.normalized}")
        output.append(TextSpan(apply_capitalization(span.surface, replacement), replacement, True))
    return render(output)
