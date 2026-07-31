from __future__ import annotations

from hashlib import sha256

import pytest
from palimpsest.puzzle.block import (
    TIERS,
    AllocationTier,
    ParagraphAssignment,
    ParagraphUnit,
    candidate_windows,
    decode_block_catalog,
    design_oracle,
    initial_allocation,
    make_allocation,
    match_controls,
)


def catalog() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "blocks": [
            {
                "blockId": "calibration-odd-women",
                "phase": "calibration",
                "sourceId": "odd-women",
                "seed": 130013,
                "window": {
                    "paragraphStart": 0,
                    "paragraphEnd": 0,
                    "wordCount": 0,
                    "sha256": "",
                },
                "boundaryStage": 4,
            }
        ],
    }


def alpha(index: int) -> str:
    letters = "abcdefghijklmnopqrstuvwxyz"
    return letters[index // len(letters)] + letters[index % len(letters)]


def paragraph(ordinal: int, *tokens: str) -> ParagraphUnit:
    words = list(tokens)
    while len(words) < 20:
        words.append(f"filler{alpha(len(words))}")
    return ParagraphUnit.from_text(ordinal, " ".join(words))


def test_catalog_decoder_is_strict_and_accepts_only_complete_discovery_windows() -> None:
    decoded = decode_block_catalog(catalog())

    assert decoded.blocks[0].block_id == "calibration-odd-women"
    assert decoded.blocks[0].window.is_discovery

    value = catalog()
    block = value["blocks"][0]  # type: ignore[index]
    assert isinstance(block, dict)
    block["unknown"] = True
    with pytest.raises(ValueError, match="unknown field"):
        decode_block_catalog(value)

    partial = catalog()
    window = partial["blocks"][0]["window"]  # type: ignore[index]
    assert isinstance(window, dict)
    window["paragraphStart"] = 1
    with pytest.raises(ValueError, match="all zero"):
        decode_block_catalog(partial)


def test_catalog_decoder_accepts_a_pinned_window_and_rejects_duplicates() -> None:
    value = catalog()
    window = value["blocks"][0]["window"]  # type: ignore[index]
    assert isinstance(window, dict)
    window.update(
        {
            "paragraphStart": 10,
            "paragraphEnd": 900,
            "wordCount": 18_000,
            "sha256": "a" * 64,
        }
    )
    value["blocks"].append(dict(value["blocks"][0]))  # type: ignore[union-attr,index]

    with pytest.raises(ValueError, match="duplicate blockId"):
        decode_block_catalog(value)


def test_candidate_window_uses_first_18k_mass_and_first_half_boundary() -> None:
    paragraphs = tuple(
        paragraph(ordinal, *("window" for _ in range(20))) for ordinal in range(1, 1126)
    )

    window = next(candidate_windows(paragraphs))

    assert window.paragraph_start == 226
    assert window.paragraph_end == 1125
    assert window.word_count == 18_000
    assert window.boundary_index == 450
    expected = "\n\n".join(item.text for item in paragraphs[225:]) + "\n"
    assert window.sha256 == sha256(expected.encode()).hexdigest()


def test_initial_allocation_is_deterministic_complete_ordered_and_nonempty() -> None:
    paragraphs = tuple(
        paragraph(ordinal, *("window" for _ in range(20))) for ordinal in range(1, 1126)
    )
    window = next(candidate_windows(paragraphs))

    first = initial_allocation(window, "calibration-odd-women", 4313013, TIERS[0])
    second = initial_allocation(window, "calibration-odd-women", 4313013, TIERS[0])

    assert first == second
    assert sorted(item.paragraph.ordinal for item in first.assignments) == list(range(226, 1126))
    for agent_id in ("agent-1", "agent-2", "agent-3"):
        for stage in range(1, 7):
            ordinals = [
                item.paragraph.ordinal
                for item in first.assignments
                if item.agent_id == agent_id and item.stage == stage
            ]
            assert ordinals
            assert ordinals == sorted(ordinals)


def designed_assignment() -> tuple[tuple[ParagraphUnit, ...], object]:
    paragraphs: list[ParagraphUnit] = []
    assignments: list[ParagraphAssignment] = []
    ordinal = 1
    anchors = [f"anchor{alpha(index)}" for index in range(12)]
    sentinels = [f"sentinel{alpha(index)}" for index in range(6)]
    sentinel_controls = [f"scontrol{alpha(index)}" for index in range(6)]
    for agent_index, agent_id in enumerate(("agent-1", "agent-2", "agent-3")):
        specialists = [f"specialist{alpha(agent_index)}{alpha(index)}" for index in range(3)]
        specialist_controls = [f"pcontrol{alpha(agent_index)}{alpha(index)}" for index in range(3)]
        for stage in range(1, 7):
            tokens = (
                list(anchors)
                if stage in {1, 4}
                else [
                    f"padding{alpha(agent_index)}{alpha(stage)}{alpha(index)}"
                    for index in range(len(anchors))
                ]
            )
            pairs = (*zip(sentinels, sentinel_controls, strict=True),)
            pairs += (*zip(specialists, specialist_controls, strict=True),)
            for pair_index, (changed, control) in enumerate(pairs):
                marker = f"marker{alpha(agent_index)}{alpha(stage)}{alpha(pair_index)}"
                tokens.extend((marker, changed, changed, control, control, marker))
            item = paragraph(ordinal, *tokens)
            paragraphs.append(item)
            assignments.append(ParagraphAssignment(paragraph=item, agent_id=agent_id, stage=stage))
            ordinal += 1
    return tuple(paragraphs), make_allocation(TIERS[0].name, assignments)


def test_oracle_design_has_declared_sets_mass_and_solo_coverage() -> None:
    paragraphs, allocation = designed_assignment()

    design = design_oracle(paragraphs, allocation, TIERS[0])

    assert len(design.anchors) == 12
    assert len(design.sentinels) >= 6
    assert {agent: len(words) for agent, words in design.specialists.items()} == {
        "agent-1": 3,
        "agent-2": 3,
        "agent-3": 3,
    }
    assert len(design.controls) == len(design.changed_types)
    assert max(design.metrics.solo_coverage.values()) <= TIERS[0].max_solo_coverage
    assert min(design.metrics.post_changed_mass.values()) >= 0.15
    assert design.metrics.min_owner_occurrences_per_region >= TIERS[0].owner_occurrences
    assert design.metrics.min_sentinel_occurrences_per_agent_region >= TIERS[0].sentinel_occurrences


def test_control_matching_uses_deterministic_augmenting_paths() -> None:
    paragraphs, allocation = designed_assignment()
    loose = AllocationTier(
        name="test",
        specialist_owner_share=0.5,
        owner_occurrences=1,
        sentinel_occurrences=1,
        max_solo_coverage=1.0,
        max_region_deviation=1.0,
        max_stage_deviation=1.0,
        max_control_distance=1.0,
    )
    design = design_oracle(paragraphs, allocation, loose)

    first = match_controls(
        design.changed_types,
        design.available_control_types,
        design.profiles,
        loose.max_control_distance,
    )
    second = match_controls(
        design.changed_types,
        design.available_control_types,
        design.profiles,
        loose.max_control_distance,
    )

    assert first == second
    assert len({match.control_type for match in first}) == len(first)
    assert all(match.control_type not in design.changed_types for match in first)
