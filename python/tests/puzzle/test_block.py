from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from palimpsest.puzzle.block import (
    ParagraphUnit,
    WindowPin,
    candidate_windows,
    decode_fixture_catalog,
    initial_allocation,
    load_fixture_catalog,
)

ROOT = Path(__file__).resolve().parents[3]


def _paragraph(ordinal: int, words: int = 100) -> ParagraphUnit:
    return ParagraphUnit.from_text(
        ordinal,
        " ".join((f"paragraph-{ordinal}", *(["evidence"] * (words - 1)))),
    )


def _window():
    return next(candidate_windows(tuple(_paragraph(index) for index in range(1, 181))))


def test_checked_in_fixture_definitions_are_declarative_and_strict() -> None:
    catalog = load_fixture_catalog(ROOT / "experiments/blocks.json")

    assert len(catalog.fixtures) == 5
    fixture = catalog.fixtures[0]
    assert fixture.fixture_id == "calibration-theron-ware"
    assert fixture.source_id == "theron-ware"
    assert fixture.agent_ids == ("agent-1", "agent-2", "agent-3")
    assert fixture.stage_count == 6
    assert [(item.variant_id, item.rekey_from_stage) for item in fixture.variants] == [
        ("stationary", None),
        ("rekey", 4),
    ]
    assert fixture.rekey_from_stage == 4
    assert fixture.allocation_constraints.minimum_changed_mass == 0.15
    assert tuple(tier.name for tier in fixture.allocation_constraints.tiers) == (
        "strict",
        "balanced",
        "fallback",
    )

    record = {
        "schemaVersion": 1,
        "fixtures": [
            {
                "fixtureId": "invalid",
                "source": {
                    "sourceId": "source",
                    "window": {
                        "paragraphStart": 0,
                        "paragraphEnd": 0,
                        "wordCount": 0,
                        "sha256": "",
                    },
                },
                "references": ["reference"],
                "seed": 1,
                "agentIds": ["alpha", "beta"],
                "stageCount": 3,
                "variants": [
                    {"variantId": "stationary", "rekeyFromStage": None},
                    {"variantId": "rekey", "rekeyFromStage": 4},
                ],
                "allocationConstraints": {
                    "minimumAnchors": 1,
                    "minimumSentinels": 1,
                    "minimumSpecialistsPerAgent": 1,
                    "minimumChangedMass": 0.1,
                    "tiers": [
                        {
                            "tier": "default",
                            "minimumSpecialistOwnerShare": 0.5,
                            "minimumOwnerOccurrences": 1,
                            "minimumSentinelOccurrences": 1,
                            "maximumSoloCoverage": 1,
                            "maximumRegionDeviation": 1,
                            "maximumStageDeviation": 1,
                            "maximumControlDistance": 1,
                        }
                    ],
                },
            }
        ],
    }
    with pytest.raises(ValueError, match="exceeds stageCount"):
        decode_fixture_catalog(record)


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
    tier = (
        load_fixture_catalog(ROOT / "experiments/blocks.json")
        .fixtures[0]
        .allocation_constraints.tiers[0]
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
