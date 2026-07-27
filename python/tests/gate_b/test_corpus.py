from __future__ import annotations

from pathlib import Path

from palimpsest.corpus.sources import (
    SourceDefinition,
    load_chapters,
    strip_gutenberg,
    strip_technical_layout,
)
from palimpsest.corpus.spans import select_word_span
from palimpsest.generation.text import word_tokens


def test_strip_gutenberg_removes_envelope() -> None:
    source = (
        "header\n*** START OF THE PROJECT GUTENBERG EBOOK EXAMPLE ***\n"
        "CHAPTER I\nNarrative.\n"
        "*** END OF THE PROJECT GUTENBERG EBOOK EXAMPLE ***\nfooter"
    )
    assert strip_gutenberg(source) == "CHAPTER I\nNarrative."


def test_plaintext_chapters_ignore_short_contents_entries(tmp_path: Path) -> None:
    source = (
        "*** START OF THE PROJECT GUTENBERG EBOOK EXAMPLE ***\n"
        "CHAPTER I\nContents entry\n"
        "CHAPTER II\nContents entry\n"
        "CHAPTER I\n" + ("alpha beta gamma. " * 300) + "\n"
        "CHAPTER II\n" + ("delta epsilon zeta. " * 300) + "\n"
        "*** END OF THE PROJECT GUTENBERG EBOOK EXAMPLE ***"
    )
    path = tmp_path / "source.txt"
    path.write_text(source, encoding="utf-8")
    chapters = load_chapters(
        SourceDefinition(path=path, source_format="gutenberg-text", source_id="fixture")
    )
    assert len(chapters) == 2
    assert chapters[0].heading == "CHAPTER I"


def test_plaintext_chapters_accept_indentation_and_remove_illustrations(tmp_path: Path) -> None:
    source = (
        "*** START OF THE PROJECT GUTENBERG EBOOK EXAMPLE ***\n"
        "                         CHAPTER I\n"
        + ("technical prose continues. " * 300)
        + "\n[Illustration: FIG. 1.--Identifying caption words.]\n"
        "*** END OF THE PROJECT GUTENBERG EBOOK EXAMPLE ***"
    )
    path = tmp_path / "source.txt"
    path.write_text(source, encoding="utf-8")

    chapters = load_chapters(
        SourceDefinition(path=path, source_format="gutenberg-text", source_id="fixture")
    )

    assert len(chapters) == 1
    assert chapters[0].heading == "CHAPTER I"
    assert "Identifying caption words" not in chapters[0].text


def test_technical_layout_removes_indented_tables_and_equations() -> None:
    source = (
        "*** START OF THE PROJECT GUTENBERG EBOOK EXAMPLE ***\n"
        "                         CHAPTER I\n"
        "                         A CENTERED TITLE\n"
        "Continuous technical prose remains available to the puzzle.\n"
        "[Illustration: FIG. 1.--Identifying caption words.]\n"
        "  Table Headings--\n"
        "    Speed    Power    Fuel\n"
        "    p = v / t\n"
        "The next prose paragraph also remains.\n"
        "*** END OF THE PROJECT GUTENBERG EBOOK EXAMPLE ***"
    )
    stripped = strip_technical_layout(source)
    assert stripped.startswith("CHAPTER I")
    assert "Continuous technical prose" in stripped
    assert "next prose paragraph" in stripped
    assert "CENTERED TITLE" not in stripped
    assert "Identifying caption words" not in stripped
    assert "Speed" not in stripped
    assert "p = v / t" not in stripped


def test_select_word_span_starts_at_declared_chapter_and_is_exact() -> None:
    from palimpsest.corpus.sources import Chapter

    chapters = [
        Chapter(index=index, heading=f"Chapter {index}", text=(f"word{index} " * 20).strip())
        for index in range(4)
    ]
    selected = select_word_span(chapters, start_chapter=1, target_tokens=25)
    assert selected.start_chapter == 1
    assert len(word_tokens(selected.text)) == 25
    assert selected.text.startswith("Chapter 1")
