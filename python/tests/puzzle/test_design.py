from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from palimpsest.puzzle.definition import AllocationTier, WindowPin
from palimpsest.puzzle.design import (
    ParagraphUnit,
    _frequency_distance,
    candidate_windows,
    initial_allocation,
)

ROOT = Path(__file__).resolve().parents[3]


def _paragraph(ordinal: int, words: int = 100) -> ParagraphUnit:
    return ParagraphUnit.from_text(
        ordinal,
        " ".join((f"paragraph-{ordinal}", *(["evidence"] * (words - 1)))),
    )


def _window():
    return next(candidate_windows(tuple(_paragraph(index) for index in range(1, 181))))


@pytest.mark.parametrize(
    ("changed_post_count", "control_post_count", "maximum_post_count", "expected"),
    [
        (0, 0, 0, 0.0),
        (2, 1, 553, 0.06418466641510638),
        (4, 2, 479, 0.08274106280474154),
        (4, 2, 546, 0.08102621494360407),
    ],
)
def test_frequency_distance_uses_platform_independent_logarithms(
    changed_post_count: int,
    control_post_count: int,
    maximum_post_count: int,
    expected: float,
) -> None:
    assert (
        _frequency_distance(changed_post_count, control_post_count, maximum_post_count) == expected
    )


@pytest.mark.parametrize(
    ("agent_ids", "stage_count", "boundary_stage"),
    [
        (("alpha", "beta"), 3, 2),
        (("alpha", "beta", "gamma", "delta"), 8, 5),
    ],
)
def test_allocation_supports_declared_fixture_geometry(
    agent_ids: tuple[str, ...],
    stage_count: int,
    boundary_stage: int,
) -> None:
    window = _window()
    tier = AllocationTier(
        "strict",
        0.67,
        3,
        3,
        0.6,
        0.04,
        0.12,
        0.15,
    )

    first = initial_allocation(
        window,
        "synthetic-fixture",
        73,
        tier,
        agent_ids=agent_ids,
        stage_count=stage_count,
        boundary_stage=boundary_stage,
    )
    second = initial_allocation(
        window,
        "synthetic-fixture",
        73,
        tier,
        agent_ids=agent_ids,
        stage_count=stage_count,
        boundary_stage=boundary_stage,
    )

    assert first == second
    assert first.agent_ids == agent_ids
    assert first.stage_count == stage_count
    assert first.boundary_stage == boundary_stage
    assert {item.paragraph.ordinal for item in first.assignments} == {
        item.ordinal for item in window.paragraphs
    }
    assert all(
        first.stage_paragraphs(agent_id, stage)
        for agent_id in agent_ids
        for stage in range(1, stage_count + 1)
    )


def test_window_pin_remains_independent_of_fixture_geometry() -> None:
    window = _window()
    pin = window.pin()

    assert pin == WindowPin(1, 180, 18_000, window.sha256)
    assert not pin.is_discovery
    assert replace(pin, paragraph_start=0, paragraph_end=0, word_count=0, sha256="").is_discovery
