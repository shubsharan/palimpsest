from __future__ import annotations

import hashlib
from pathlib import Path

from palimpsest.puzzle.corpus import SourceDefinition, load_paragraphs, serialize_paragraphs

ROOT = Path(__file__).resolve().parents[3]


def _source(tmp_path: Path, name: str, source_format: str, content: str) -> SourceDefinition:
    path = tmp_path / name
    encoded = content.encode("utf-8")
    path.write_bytes(encoded)
    return SourceDefinition(
        path=path,
        source_format=source_format,
        source_id="synthetic",
        sha256=hashlib.sha256(encoded).hexdigest(),
        byte_length=len(encoded),
    )


def test_plain_text_is_interpreted_exactly_as_stored(tmp_path: Path) -> None:
    first = " ".join(f"alpha{index}" for index in range(1, 22))
    second = " ".join(f"beta{index}" for index in range(1, 22))
    source = _source(tmp_path, "source.txt", "plain-text", f"TITLE\n\n{first}\n\n{second}\n")

    assert load_paragraphs(source) == (first, second)
    assert serialize_paragraphs(load_paragraphs(source)) == f"{first}\n\n{second}\n"


def test_checked_in_source_is_clean_utf8_plain_text() -> None:
    path = ROOT / "fixtures/corpus/fortunes-fool.txt"
    encoded = path.read_bytes()
    source = SourceDefinition(
        path=path,
        source_format="plain-text",
        source_id="fortunes-fool",
        sha256=hashlib.sha256(encoded).hexdigest(),
        byte_length=len(encoded),
    )

    paragraphs = load_paragraphs(source)
    assert paragraphs
    assert paragraphs[0].startswith("The times were full of trouble")
    assert serialize_paragraphs(paragraphs).endswith("\n")


def test_gutenberg_text_strips_envelope_and_normalizes_paragraphs(tmp_path: Path) -> None:
    outside = " ".join(["outside"] * 20)
    first = "Cafe\u0301   " + " ".join(f"alpha{index}" for index in range(1, 20))
    second = " ".join(f"beta{index}" for index in range(1, 22))
    source = _source(
        tmp_path,
        "gutenberg.txt",
        "gutenberg-text",
        (
            f"{outside}\r\n"
            "*** START OF THE PROJECT GUTENBERG EBOOK SYNTHETIC ***\r\n"
            "CHAPTER I\r\n\r\n"
            "too short\r\n\r\n"
            f"{first}\r\ncontinued\twords\r\n\r\n"
            f"{second}\r\n"
            "*** END OF THE PROJECT GUTENBERG EBOOK SYNTHETIC ***\r\n"
            f"{outside}\r\n"
        ),
    )

    paragraphs = load_paragraphs(source)
    assert paragraphs == (
        "Café " + " ".join(f"alpha{index}" for index in range(1, 20)) + " continued words",
        second,
    )


def test_gutenberg_html_decodes_entities_and_nested_text(tmp_path: Path) -> None:
    outside = " ".join(["outside"] * 20)
    inside = " ".join(f"word{index}" for index in range(1, 20))
    source = _source(
        tmp_path,
        "source.htm",
        "gutenberg-html",
        (
            "<html><body>\n"
            f"<p>{outside}</p>"
            "<pre>\n*** START OF THIS PROJECT GUTENBERG EBOOK SYNTHETIC ***\n</pre>"
            "<h2>I. Beginning</h2>"
            "<p>short text</p>"
            f"<p>Cafe&#769; &amp; <em>{inside}</em></p>"
            "<pre>\n*** END OF THIS PROJECT GUTENBERG EBOOK SYNTHETIC ***\n</pre>"
            f"<p>{outside}</p>"
            "</body></html>"
        ),
    )

    assert load_paragraphs(source) == (f"Café & {inside}",)
