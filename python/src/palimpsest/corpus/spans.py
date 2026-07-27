from __future__ import annotations

from dataclasses import dataclass

from palimpsest.corpus.sources import Chapter
from palimpsest.generation.text import tokenize


@dataclass(frozen=True)
class SelectedSpan:
    text: str
    start_chapter: int
    end_chapter: int
    token_count: int


def select_word_span(
    chapters: list[Chapter],
    *,
    start_chapter: int,
    target_tokens: int,
) -> SelectedSpan:
    if target_tokens < 2:
        raise ValueError("A stationary span needs at least two word tokens.")
    if start_chapter < 0 or start_chapter >= len(chapters):
        raise ValueError("Start chapter is outside the parsed chapter sequence.")
    joined_parts: list[str] = []
    chapter_ends: list[tuple[int, int]] = []
    for chapter in chapters[start_chapter:]:
        if joined_parts:
            joined_parts.append("\n\n")
        joined_parts.append(chapter.heading)
        joined_parts.append("\n\n")
        joined_parts.append(chapter.text)
        chapter_ends.append((len("".join(joined_parts)), chapter.index))
    joined = "".join(joined_parts)
    spans = tokenize(joined)
    word_count = 0
    end_offset = 0
    for span in spans:
        end_offset += len(span.surface)
        if span.is_word:
            word_count += 1
            if word_count == target_tokens:
                break
    if word_count != target_tokens:
        raise ValueError(
            f"Only {word_count} word tokens remain from chapter {start_chapter}; "
            f"{target_tokens} are required."
        )
    end_chapter = next(
        chapter_index for chapter_end, chapter_index in chapter_ends if chapter_end >= end_offset
    )
    return SelectedSpan(
        text=joined[:end_offset],
        start_chapter=start_chapter,
        end_chapter=end_chapter,
        token_count=target_tokens,
    )
