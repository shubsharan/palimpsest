from __future__ import annotations

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


def test_assign_streams_uses_contiguous_equal_slices() -> None:
    segments = tuple(f"stage-{index}" for index in range(1, 19))
    streams = assign_streams(segments)

    assert streams == {
        "agent-1": segments[0:6],
        "agent-2": segments[6:12],
        "agent-3": segments[12:18],
    }


def test_eligible_symbols_intersects_pre_and_post_evidence_for_every_agent() -> None:
    streams = {
        "agent-1": ("common common private", "common", "common", "common common revised", "x", "y"),
        "agent-2": ("common common other", "common", "common", "common common revised", "x", "y"),
        "agent-3": ("common common third", "common", "common", "common common revised", "x", "y"),
    }

    assert eligible_symbols(streams, transition_stage=4, minimum_occurrences=2) == {"common"}


def test_contradiction_metrics_reports_each_stream_without_mutating_geometry() -> None:
    streams = {
        agent_id: (
            "changed changed base",
            "changed base",
            "base",
            "changed changed revised",
            "changed revised",
            "revised",
        )
        for agent_id in ("agent-1", "agent-2", "agent-3")
    }

    metrics = contradiction_metrics(streams, transition_stage=4, changed_symbols={"changed"})

    assert set(metrics) == {"agent-1", "agent-2", "agent-3"}
    assert metrics["agent-1"]["preChangedOccurrences"] == 3
    assert metrics["agent-1"]["postChangedOccurrences"] == 3
    assert metrics["agent-1"]["postChangedTokenMass"] == 0.5
