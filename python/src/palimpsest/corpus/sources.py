from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from palimpsest.generation.text import word_tokens

START_MARKER = re.compile(
    r"^\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*\*{3}\s*$",
    re.IGNORECASE | re.MULTILINE,
)
END_MARKER = re.compile(
    r"^\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*\*{3}\s*$",
    re.IGNORECASE | re.MULTILINE,
)
CHAPTER_HEADING = re.compile(
    r"^[ \t]*(?P<heading>(?:CHAPTER|BOOK)\s+(?:[0-9]+|[IVXLCDM]+)"
    r"(?:[.:][ \t]*.*)?)[ \t]*$",
    re.IGNORECASE | re.MULTILINE,
)
ILLUSTRATION_BLOCK = re.compile(
    r"\[Illustration:.*?\][ \t]*(?:\n|$)",
    re.IGNORECASE | re.DOTALL,
)


@dataclass(frozen=True)
class SourceDefinition:
    path: Path
    source_format: str
    source_id: str


@dataclass(frozen=True)
class Chapter:
    index: int
    heading: str
    text: str


def strip_gutenberg(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))
    start = START_MARKER.search(normalized)
    end = END_MARKER.search(normalized, start.end() if start else 0)
    if start is None or end is None or start.end() >= end.start():
        raise ValueError("Project Gutenberg source is missing an ordered START/END envelope.")
    return normalized[start.end() : end.start()].strip()


def strip_technical_layout(value: str) -> str:
    """Remove a frozen technical edition's preformatted non-prose blocks."""
    stripped = ILLUSTRATION_BLOCK.sub("", strip_gutenberg(value))
    retained: list[str] = []
    for line in stripped.splitlines():
        if CHAPTER_HEADING.fullmatch(line):
            retained.append(line.strip())
        elif line.startswith((" ", "\t")) or line.casefold().startswith("table headings--"):
            retained.append("")
        else:
            retained.append(line)
    return "\n".join(retained).strip()


def _plain_text_chapters(value: str, *, remove_illustrations: bool = True) -> list[Chapter]:
    matches = list(CHAPTER_HEADING.finditer(value))
    chapters: list[Chapter] = []
    for match_index, match in enumerate(matches):
        end = matches[match_index + 1].start() if match_index + 1 < len(matches) else len(value)
        body = value[match.end() : end]
        if remove_illustrations:
            body = ILLUSTRATION_BLOCK.sub("", body)
        body = body.strip()
        if len(word_tokens(body)) < 200:
            continue
        chapters.append(
            Chapter(index=len(chapters), heading=match.group("heading").strip(), text=body)
        )
    if not chapters:
        raise ValueError("No chapters with at least 200 word tokens were found.")
    return chapters


def load_chapters(source: SourceDefinition) -> list[Chapter]:
    if source.source_format == "gutenberg-text":
        return _plain_text_chapters(strip_gutenberg(source.path.read_text(encoding="utf-8")))
    if source.source_format == "gutenberg-technical-text":
        return _plain_text_chapters(
            strip_technical_layout(source.path.read_text(encoding="utf-8")),
            remove_illustrations=False,
        )
    raise ValueError(f"Unsupported source format: {source.source_format}")
