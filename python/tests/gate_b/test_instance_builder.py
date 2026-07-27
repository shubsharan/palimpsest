from __future__ import annotations

from pathlib import Path

from palimpsest.generation.builder import build_instance
from palimpsest.generation.cipher import apply_mapping
from palimpsest.generation.text import word_tokens


def test_builder_is_repeatable_and_oracle_inverts_exactly(tmp_path: Path) -> None:
    source = (
        "*** START OF THE PROJECT GUTENBERG EBOOK FIXTURE ***\n"
        "CHAPTER I\n" + ("Alice sees Bob beside a London. " * 100) + "\n"
        "CHAPTER II\n" + ("Bob sees Alice beyond a London. " * 100) + "\n"
        "*** END OF THE PROJECT GUTENBERG EBOOK FIXTURE ***"
    )
    source_path = tmp_path / "fixture.txt"
    source_path.write_text(source, encoding="utf-8")
    first = build_instance(
        source_path=source_path,
        source_format="gutenberg-text",
        source_id="fixture",
        instance_id="instance-fixture",
        seed_hex="22" * 32,
        start_chapter=0,
        target_tokens=200,
    )
    second = build_instance(
        source_path=source_path,
        source_format="gutenberg-text",
        source_id="fixture",
        instance_id="instance-fixture",
        seed_hex="22" * 32,
        start_chapter=0,
        target_tokens=200,
    )
    assert first == second
    assert len(word_tokens(first.prepared_text)) == 200
    assert apply_mapping(first.cipher_text, first.recovered_mapping) == first.prepared_text
    assert not set(first.encryption_key).intersection(
        plain for plain, cipher in first.encryption_key.items() if plain == cipher
    )
