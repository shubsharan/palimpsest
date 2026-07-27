from __future__ import annotations

import pytest
from palimpsest.channel.fixtures import (
    build_opaque_shard,
    normalize_source_text,
    render_token_ids,
)


def test_opaque_shard_is_deterministic_and_preserves_structure() -> None:
    source = "Alpha beta, gamma.\nDelta alpha epsilon beta."
    first = build_opaque_shard(source, token_count=7, vocabulary_size=4)
    second = build_opaque_shard(source, token_count=7, vocabulary_size=4)
    assert first == second
    assert first.rendered.count(b"\n") == 1
    assert first.rendered.count(b",") == 1
    assert first.rendered.count(b".") == 2
    assert len(first.token_ids) == 7
    assert len(first.vocabulary) == 4
    assert (
        render_token_ids(
            source,
            first.token_ids,
            token_count=7,
            vocabulary_size=4,
        )
        == first.rendered
    )


def test_source_normalization_rejects_surrogates() -> None:
    assert normalize_source_text("a\r\nb") == "a\nb"
    with pytest.raises(ValueError, match="surrogate"):
        normalize_source_text("\ud800")


def test_fixture_rejects_insufficient_geometry() -> None:
    with pytest.raises(ValueError, match="word types"):
        build_opaque_shard("same same same", token_count=3, vocabulary_size=2)
