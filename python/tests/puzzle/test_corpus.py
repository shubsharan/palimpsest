from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from palimpsest.puzzle.corpus import (
    SourceDefinition,
    load_chapters,
    load_paragraphs,
    load_source_registry,
    load_text_source,
    select_chapters,
    serialize_paragraphs,
)
from palimpsest.puzzle.text import word_tokens

ROOT = Path(__file__).resolve().parents[3]


def test_registry_rejects_digest_drift(tmp_path: Path) -> None:
    corpus = tmp_path / "fixtures/corpus"
    corpus.mkdir(parents=True)
    (corpus / "source.txt").write_text("changed\n", encoding="utf-8")
    provenance = {
        "schemaVersion": 1,
        "sources": [
            {
                "sourceId": "source",
                "path": "fixtures/corpus/source.txt",
                "format": "gutenberg-text",
                "byteLength": 8,
                "sha256": "0" * 64,
            }
        ],
    }
    (corpus / "provenance.json").write_text(json.dumps(provenance), encoding="utf-8")

    with pytest.raises(ValueError, match=r"source.*digest"):
        load_source_registry(tmp_path)


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


def test_chapter_helpers_remain_one_based(tmp_path: Path) -> None:
    words = " ".join(["narrative"] * 200)
    source = _source(
        tmp_path,
        "chapters.txt",
        "gutenberg-text",
        "*** START OF THE PROJECT GUTENBERG EBOOK SYNTHETIC ***\n"
        f"CHAPTER I.\n{words}\n"
        f"CHAPTER II.\n{words}\n"
        "*** END OF THE PROJECT GUTENBERG EBOOK SYNTHETIC ***\n",
    )

    chapters = load_chapters(source)
    assert [chapter.index for chapter in chapters] == [1, 2]
    assert [chapter.heading for chapter in select_chapters(source, 1, 2)] == [
        "CHAPTER I.",
        "CHAPTER II.",
    ]
    for start, end in ((0, 1), (2, 1), (1, 10_000)):
        with pytest.raises(ValueError, match="chapter range"):
            select_chapters(source, start, end)


def test_plain_paragraphs_use_only_canonical_gutenberg_body_blocks(tmp_path: Path) -> None:
    outside = " ".join(["outside"] * 20)
    first = "Cafe\u0301   " + " ".join(f"alpha{index}" for index in range(1, 20))
    second = " ".join(f"beta{index}" for index in range(1, 22))
    source = _source(
        tmp_path,
        "plain.txt",
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
    assert serialize_paragraphs(paragraphs) == f"{paragraphs[0]}\n\n{paragraphs[1]}\n"


def test_html_paragraphs_decode_entities_and_nested_text(tmp_path: Path) -> None:
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


def test_present_text_sources_have_canonical_prose_paragraphs() -> None:
    for name in (
        "chronicles-of-break-oday.txt",
        "middlemarch.txt",
        "jane-eyre.txt",
    ):
        paragraphs = load_paragraphs(load_text_source(ROOT / "fixtures/corpus" / name))
        assert paragraphs
        assert all(len(word_tokens(paragraph)) >= 20 for paragraph in paragraphs)
        assert serialize_paragraphs(paragraphs).endswith("\n")
