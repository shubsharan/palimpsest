from __future__ import annotations

import json
from pathlib import Path

import pytest
from palimpsest.puzzle.corpus import (
    load_chapters,
    load_source_registry,
    select_chapters,
)

ROOT = Path(__file__).resolve().parents[3]


def test_registry_verifies_every_checked_in_source() -> None:
    registry = load_source_registry(ROOT)

    assert tuple(registry) == ("middlemarch", "moby-dick", "jane-eyre")
    assert registry["middlemarch"].path == ROOT / "fixtures/corpus/middlemarch.txt"
    assert all(source.sha256 and source.byte_length > 0 for source in registry.values())


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
