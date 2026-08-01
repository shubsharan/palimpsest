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
    select_chapters,
    serialize_paragraphs,
)
from palimpsest.puzzle.text import word_tokens

ROOT = Path(__file__).resolve().parents[3]
pytestmark = pytest.mark.material


def test_registry_verifies_every_checked_in_source() -> None:
    registry = load_source_registry(ROOT)

    assert tuple(registry) == (
        "middlemarch",
        "moby-dick",
        "jane-eyre",
        "theron-ware",
        "odd-women",
        "pointed-firs",
        "custom-country",
        "woodlanders",
    )
    assert registry["middlemarch"].path == ROOT / "fixtures/corpus/middlemarch.txt"
    assert registry["theron-ware"].path == ROOT / "fixtures/corpus/pg133.txt"
    assert registry["pointed-firs"].source_format == "gutenberg-html"
    assert all(source.sha256 and source.byte_length > 0 for source in registry.values())


def test_study_sources_pin_exact_download_metadata() -> None:
    provenance = json.loads((ROOT / "fixtures/corpus/provenance.json").read_text(encoding="utf-8"))
    sources = {source["sourceId"]: source for source in provenance["sources"]}

    assert {
        source_id: (
            source["downloadUrl"],
            source["contentType"],
            source["ebookNumber"],
            source["retrievedAt"],
        )
        for source_id, source in sources.items()
        if source_id
        in {"theron-ware", "odd-women", "pointed-firs", "custom-country", "woodlanders"}
    } == {
        "theron-ware": (
            "https://www.gutenberg.org/cache/epub/133/pg133.txt",
            "text/plain; charset=utf-8",
            133,
            "2026-07-28",
        ),
        "odd-women": (
            "https://www.gutenberg.org/cache/epub/4313/pg4313.txt",
            "text/plain; charset=utf-8",
            4313,
            "2026-07-28",
        ),
        "pointed-firs": (
            "https://www.gutenberg.org/files/367/367-h/367-h.htm",
            "text/html",
            367,
            "2026-07-28",
        ),
        "custom-country": (
            "https://www.gutenberg.org/cache/epub/11052/pg11052.txt",
            "text/plain; charset=utf-8",
            11052,
            "2026-07-28",
        ),
        "woodlanders": (
            "https://www.gutenberg.org/cache/epub/482/pg482.txt",
            "text/plain; charset=utf-8",
            482,
            "2026-07-28",
        ),
    }


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


def test_chapters_are_one_based_and_discard_leading_toc_matches() -> None:
    registry = load_source_registry(ROOT)
    middlemarch = load_chapters(registry["middlemarch"])
    moby_dick = load_chapters(registry["moby-dick"])

    assert middlemarch[0].index == 1
    assert middlemarch[0].heading == "CHAPTER I."
    assert moby_dick[0].index == 1
    assert moby_dick[0].heading == "CHAPTER 1. Loomings."
    selected = select_chapters(registry["middlemarch"], 10, 15)
    assert [selected[0].heading, selected[-1].heading] == ["CHAPTER X.", "CHAPTER XV."]


@pytest.mark.parametrize(("start", "end"), [(0, 1), (2, 1), (1, 10_000)])
def test_chapter_selection_rejects_invalid_one_based_ranges(start: int, end: int) -> None:
    source = load_source_registry(ROOT)["jane-eyre"]

    with pytest.raises(ValueError, match="chapter range"):
        select_chapters(source, start, end)


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


def test_every_study_source_has_canonical_prose_paragraphs() -> None:
    registry = load_source_registry(ROOT)

    for source_id in (
        "theron-ware",
        "odd-women",
        "pointed-firs",
        "custom-country",
        "woodlanders",
    ):
        paragraphs = load_paragraphs(registry[source_id])
        assert paragraphs
        assert all(len(word_tokens(paragraph)) >= 20 for paragraph in paragraphs)
        assert serialize_paragraphs(paragraphs).endswith("\n")

    assert load_paragraphs(registry["theron-ware"])[0].startswith("No such throng")
    assert load_paragraphs(registry["odd-women"])[0].startswith("“So to-morrow")
    assert load_paragraphs(registry["pointed-firs"])[0].startswith(
        "THERE WAS SOMETHING about the coast town"
    )
    assert load_paragraphs(registry["custom-country"])[0].startswith(
        '"Undine Spragg--how can you?"'
    )
    assert load_paragraphs(registry["woodlanders"])[0].startswith("The rambler who")
