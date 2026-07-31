from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath, PureWindowsPath

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
FIRST_CHAPTER = re.compile(r"^(?:CHAPTER|BOOK)\s+(?:I|1)(?:[.:\s]|$)", re.IGNORECASE)
ILLUSTRATION_BLOCK = re.compile(
    r"\[Illustration:.*?\][ \t]*(?:\n|$)",
    re.IGNORECASE | re.DOTALL,
)
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_SOURCE_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_BLANK_LINES = re.compile(r"\n(?:[ \t]*\n)+")
_FIRST_NARRATIVE_HEADING = re.compile(
    r"^[ \t]*(?:CHAPTER[ \t]+)?(?:I|1)(?:[.:][^\n]*)?[ \t]*$",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass(frozen=True)
class SourceDefinition:
    path: Path
    source_format: str
    source_id: str
    sha256: str
    byte_length: int


def load_text_source(path: Path) -> SourceDefinition:
    """Load an operator-supplied UTF-8 text source without requiring registry promotion."""
    resolved = path.resolve()
    if not resolved.is_file():
        raise ValueError(f"Puzzle source is not a file: {resolved}")
    content = resolved.read_bytes()
    if not content:
        raise ValueError("Puzzle source must not be empty.")
    try:
        decoded = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("Puzzle source must be valid UTF-8 text.") from error
    if "\x00" in decoded:
        raise ValueError("Puzzle source must not contain NUL characters.")
    digest = sha256_hex(content)
    stem = re.sub(r"[^a-z0-9]+", "-", resolved.stem.casefold()).strip("-") or "source"
    source_format = "gutenberg-html" if resolved.suffix.casefold() in {".htm", ".html"} else "text"
    return SourceDefinition(
        path=resolved,
        source_format=source_format,
        source_id=f"{stem}-{digest[:12]}",
        sha256=digest,
        byte_length=len(content),
    )


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
    source_id: str
    sha256: str


def _safe_registry_path(root: Path, value: object, source_id: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError(f"Corpus source {source_id} path must be a non-empty string.")
    posix = PurePosixPath(value)
    windows = PureWindowsPath(value)
    parts = re.split(r"[\\/]", value)
    if (
        posix.is_absolute()
        or windows.is_absolute()
        or windows.drive
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise ValueError(f"Corpus source {source_id} path must be a safe relative path.")
    path = (root / value).resolve()
    corpus_root = (root / "fixtures/corpus").resolve()
    if not path.is_relative_to(corpus_root):
        raise ValueError(f"Corpus source {source_id} path must remain inside fixtures/corpus.")
    return path


def load_source_registry(root: Path) -> dict[str, SourceDefinition]:
    root = root.resolve()
    registry_path = root / "fixtures/corpus/provenance.json"
    value = json.loads(registry_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("Unsupported corpus provenance schema version.")
    sources = value.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Corpus provenance sources must be a non-empty array.")

    registry: dict[str, SourceDefinition] = {}
    for index, raw in enumerate(sources):
        if not isinstance(raw, dict):
            raise ValueError(f"Corpus provenance source {index + 1} must be an object.")
        source_id = raw.get("sourceId")
        if not isinstance(source_id, str) or _SOURCE_ID.fullmatch(source_id) is None:
            raise ValueError(f"Corpus provenance source {index + 1} has an invalid sourceId.")
        if source_id in registry:
            raise ValueError(f"Corpus provenance contains duplicate sourceId {source_id}.")
        source_format = raw.get("format")
        if source_format not in {"gutenberg-text", "gutenberg-html"}:
            raise ValueError(f"Unsupported source format for {source_id}: {source_format}")
        digest = raw.get("sha256")
        if not isinstance(digest, str) or _DIGEST.fullmatch(digest) is None:
            raise ValueError(f"Corpus source {source_id} sha256 must be lowercase SHA-256.")
        byte_length = raw.get("byteLength")
        if type(byte_length) is not int or byte_length < 1:
            raise ValueError(f"Corpus source {source_id} byteLength must be positive.")
        path = _safe_registry_path(root, raw.get("path"), source_id)
        content = path.read_bytes()
        if len(content) != byte_length:
            raise ValueError(f"Corpus source {source_id} byte length does not match provenance.")
        if sha256_hex(content) != digest:
            raise ValueError(f"Corpus source {source_id} digest does not match provenance.")
        registry[source_id] = SourceDefinition(
            path=path,
            source_format=source_format,
            source_id=source_id,
            sha256=digest,
            byte_length=byte_length,
        )
    return registry


def strip_gutenberg(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))
    start = START_MARKER.search(normalized)
    end = END_MARKER.search(normalized, start.end() if start else 0)
    if start is None or end is None or start.end() >= end.start():
        raise ValueError("Project Gutenberg source is missing an ordered START/END envelope.")
    return normalized[start.end() : end.start()].strip()


def _canonical_paragraph(value: str) -> str | None:
    normalized = unicodedata.normalize("NFC", value)
    collapsed = " ".join(normalized.split())
    return collapsed if len(word_tokens(collapsed)) >= 20 else None


class _GutenbergParagraphParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.paragraphs: list[str] = []
        self._parts: list[str] | None = None
        self._heading_parts: list[str] | None = None
        self._started = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        folded = tag.casefold()
        if folded == "p" and self._started:
            self._parts = []
        elif folded in {"h1", "h2", "h3"}:
            self._heading_parts = []
        elif folded == "br" and self._parts is not None:
            self._parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        folded = tag.casefold()
        if folded in {"h1", "h2", "h3"} and self._heading_parts is not None:
            heading = " ".join("".join(self._heading_parts).split())
            if _FIRST_NARRATIVE_HEADING.fullmatch(heading) is not None:
                self._started = True
            self._heading_parts = None
            return
        if folded != "p" or self._parts is None:
            return
        paragraph = _canonical_paragraph("".join(self._parts))
        if paragraph is not None:
            self.paragraphs.append(paragraph)
        self._parts = None

    def handle_data(self, data: str) -> None:
        if self._parts is not None:
            self._parts.append(data)
        if self._heading_parts is not None:
            self._heading_parts.append(data)


def load_paragraphs(source: SourceDefinition) -> tuple[str, ...]:
    raw = source.path.read_text(encoding="utf-8")
    if source.source_format == "text":
        normalized = unicodedata.normalize("NFC", raw.replace("\r\n", "\n").replace("\r", "\n"))
        start = START_MARKER.search(normalized)
        end = END_MARKER.search(normalized, start.end() if start else 0)
        body = (
            normalized[start.end() : end.start()].strip()
            if start is not None and end is not None and start.end() < end.start()
            else normalized
        )
        first_heading = next(
            (
                match
                for match in _FIRST_NARRATIVE_HEADING.finditer(body)
                if re.match(r"\n[ \t]*\n", body[match.end() :]) is not None
            ),
            None,
        )
        if first_heading is not None:
            body = body[first_heading.end() :]
        return tuple(
            paragraph
            for candidate in _BLANK_LINES.split(body)
            if (paragraph := _canonical_paragraph(candidate)) is not None
        )

    body = strip_gutenberg(raw)
    if source.source_format == "gutenberg-text":
        first_heading = next(
            (
                match
                for match in _FIRST_NARRATIVE_HEADING.finditer(body)
                if re.match(r"\n[ \t]*\n", body[match.end() :]) is not None
            ),
            None,
        )
        if first_heading is None:
            raise ValueError(
                f"Corpus {source.source_id} has no recognizable first narrative heading."
            )
        body = body[first_heading.end() :]
        candidates = _BLANK_LINES.split(body)
        return tuple(
            paragraph
            for candidate in candidates
            if (paragraph := _canonical_paragraph(candidate)) is not None
        )
    if source.source_format == "gutenberg-html":
        parser = _GutenbergParagraphParser()
        parser.feed(body)
        parser.close()
        return tuple(parser.paragraphs)
    raise ValueError(f"Unsupported source format: {source.source_format}")


def serialize_paragraphs(paragraphs: tuple[str, ...]) -> str:
    if not paragraphs:
        return ""
    return f"{'\n\n'.join(paragraphs)}\n"


def _plain_text_chapters(value: str) -> list[Chapter]:
    matches = list(CHAPTER_HEADING.finditer(value))
    parsed: list[tuple[str, str]] = []
    for match_index, match in enumerate(matches):
        end = matches[match_index + 1].start() if match_index + 1 < len(matches) else len(value)
        body = ILLUSTRATION_BLOCK.sub("", value[match.end() : end]).strip()
        if len(word_tokens(body)) >= 200:
            parsed.append((match.group("heading").strip(), body))
    first = next(
        (index for index, (heading, _) in enumerate(parsed) if FIRST_CHAPTER.match(heading)),
        None,
    )
    if first is None:
        raise ValueError("No ordered chapters beginning with Chapter I/1 were found.")
    parsed = parsed[first:]
    return [
        Chapter(index=index, heading=heading, text=body)
        for index, (heading, body) in enumerate(parsed, start=1)
    ]


def load_chapters(source: SourceDefinition) -> list[Chapter]:
    if source.source_format != "gutenberg-text":
        raise ValueError(f"Unsupported source format: {source.source_format}")
    return _plain_text_chapters(strip_gutenberg(source.path.read_text(encoding="utf-8")))


def select_chapters(
    source: SourceDefinition,
    start: int,
    end: int,
) -> tuple[Chapter, ...]:
    chapters = load_chapters(source)
    if (
        type(start) is not int
        or type(end) is not int
        or start < 1
        or end < start
        or end > len(chapters)
    ):
        raise ValueError(
            f"Corpus {source.source_id} chapter range must be one-based, ordered, and available."
        )
    return tuple(chapters[start - 1 : end])


def build_reference_corpus(
    sources: tuple[SourceDefinition, ...],
    *,
    excerpt_bytes: int = 8_192,
) -> tuple[ReferenceDocument, ...]:
    documents: list[ReferenceDocument] = []
    seen: set[str] = set()
    for source in sources:
        excerpt = (
            source.path.read_bytes()[:excerpt_bytes].decode("utf-8", errors="ignore").strip() + "\n"
        )
        digest = sha256_hex(excerpt.encode("utf-8"))
        if digest in seen:
            raise ValueError("Reference corpus contains a byte-identical duplicate.")
        seen.add(digest)
        documents.append(
            ReferenceDocument(
                document_id=f"{source.source_id}-reference",
                source_path=source.path,
                content=excerpt,
                source_id=source.source_id,
                sha256=source.sha256,
            )
        )
    return tuple(documents)
