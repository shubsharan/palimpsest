from __future__ import annotations

import pytest
from palimpsest.puzzle.shards import (
    assign_streams,
    contradiction_metrics,
    eligible_symbols,
    split_text,
)
from palimpsest.puzzle.text import word_tokens


def words(value: str) -> list[str]:
    return [token.normalized for token in word_tokens(value) if token.normalized is not None]


def test_split_text_preserves_words_and_balances_boundary_segments() -> None:
    source = "one two, three four five six seven eight nine ten"
    segments = split_text(source, 3)

    assert len(segments) == 3
    assert [word for segment in segments for word in words(segment)] == words(source)
    counts = [len(words(segment)) for segment in segments]
    assert max(counts) - min(counts) <= 1


def test_assign_streams_uses_declared_dynamic_geometry() -> None:
    segments = tuple(f"stage-{index}" for index in range(1, 11))

    assert assign_streams(segments, ("agent-1", "agent-2"), 5) == {
        "agent-1": segments[:5],
        "agent-2": segments[5:],
    }
    with pytest.raises(ValueError, match="10 stage segments"):
        assign_streams(segments[:-1], ("agent-1", "agent-2"), 5)


def test_eligible_symbols_uses_only_adjacent_declared_regions() -> None:
    streams = {
        "agent-1": ("old common common", "old common", "new common common", "new common", "later"),
        "agent-2": ("old common common", "old common", "new common common", "new common", "later"),
    }

    assert eligible_symbols(
        streams,
        pre_start=1,
        pre_end=2,
        post_start=3,
        post_end=4,
        minimum_occurrences=2,
    ) == {"common"}


def test_contradiction_metrics_reports_each_dynamic_stream() -> None:
    streams = {
        agent_id: (
            "changed changed base",
            "changed base",
            "changed changed revised",
            "changed revised",
        )
        for agent_id in ("agent-1", "agent-2")
    }

    metrics = contradiction_metrics(
        streams,
        pre_start=1,
        pre_end=2,
        post_start=3,
        post_end=4,
        changed_symbols={"changed"},
    )

    assert set(metrics) == {"agent-1", "agent-2"}
    assert metrics["agent-1"]["preChangedOccurrences"] == 3
    assert metrics["agent-1"]["postChangedOccurrences"] == 3
    assert metrics["agent-1"]["postChangedTokenMass"] == 0.6


def test_adjacent_region_validation_rejects_empty_or_out_of_range_windows() -> None:
    streams = {"agent-1": ("one", "two")}

    with pytest.raises(ValueError, match="adjacent stage regions"):
        eligible_symbols(
            streams,
            pre_start=1,
            pre_end=1,
            post_start=3,
            post_end=3,
            minimum_occurrences=1,
        )
