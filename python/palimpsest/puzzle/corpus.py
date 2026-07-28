from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from ..serialization import sha256_hex
from .text import word_tokens

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


@dataclass(frozen=True)
class ReferenceDocument:
    document_id: str
    source_path: Path
    content: str


REFERENCE_SOURCES = (
    ("jane-eyre-reference", Path("fixtures/corpus/jane-eyre.txt")),
    ("moby-dick-reference", Path("fixtures/corpus/moby-dick.txt")),
)


def strip_gutenberg(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))
    start = START_MARKER.search(normalized)
    end = END_MARKER.search(normalized, start.end() if start else 0)
    if start is None or end is None or start.end() >= end.start():
        raise ValueError("Project Gutenberg source is missing an ordered START/END envelope.")
    return normalized[start.end() : end.start()].strip()


def _plain_text_chapters(value: str) -> list[Chapter]:
    matches = list(CHAPTER_HEADING.finditer(value))
    chapters: list[Chapter] = []
    for match_index, match in enumerate(matches):
        end = matches[match_index + 1].start() if match_index + 1 < len(matches) else len(value)
        body = ILLUSTRATION_BLOCK.sub("", value[match.end() : end]).strip()
        if len(word_tokens(body)) < 200:
            continue
        chapters.append(
            Chapter(index=len(chapters), heading=match.group("heading").strip(), text=body)
        )
    if not chapters:
        raise ValueError("No chapters with at least 200 word tokens were found.")
    return chapters


def load_chapters(source: SourceDefinition) -> list[Chapter]:
    if source.source_format != "gutenberg-text":
        raise ValueError(f"Unsupported source format: {source.source_format}")
    return _plain_text_chapters(strip_gutenberg(source.path.read_text(encoding="utf-8")))


def build_reference_corpus(
    root: Path, *, excerpt_bytes: int = 8_192
) -> tuple[ReferenceDocument, ...]:
    documents: list[ReferenceDocument] = []
    seen: set[str] = set()
    for document_id, relative_path in REFERENCE_SOURCES:
        source = (root / relative_path).read_bytes()
        excerpt = source[:excerpt_bytes].decode("utf-8", errors="ignore").strip() + "\n"
        digest = sha256_hex(excerpt.encode("utf-8"))
        if digest in seen:
            raise ValueError("Reference corpus contains a byte-identical duplicate.")
        seen.add(digest)
        documents.append(ReferenceDocument(document_id, relative_path, excerpt))
    return tuple(documents)
