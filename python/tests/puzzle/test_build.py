from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import palimpsest.puzzle.block as block_module
import palimpsest.puzzle.build as build_module
import pytest
from palimpsest.puzzle.block import (
    BlockDefinition,
    InfeasibleDesignError,
    ParagraphUnit,
    WindowPin,
    candidate_windows,
    design_block,
)
from palimpsest.puzzle.cipher import apply_mapping
from palimpsest.puzzle.corpus import (
    load_paragraphs,
    load_text_source,
    serialize_paragraphs,
)
from palimpsest.puzzle.manifest import PuzzleBuild
from palimpsest.puzzle.text import word_tokens

ROOT = Path(__file__).resolve().parents[3]
BLOCK_IDS = ("calibration-odd-women",)
CALIBRATION_SOURCE = ROOT / "fixtures/chronicles-of-break-oday.txt"
AGENT_IDS = ("agent-1", "agent-2", "agent-3")


def _files(root: Path) -> dict[Path, bytes]:
    return {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}


def _json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def _paragraphs(count: int = 700, words: int = 100) -> tuple[ParagraphUnit, ...]:
    def letters(value: int) -> str:
        result = ""
        while value:
            value, remainder = divmod(value - 1, 26)
            result = chr(ord("a") + remainder) + result
        return result

    return tuple(
        ParagraphUnit.from_text(
            ordinal,
            " ".join((f"paragraph{letters(ordinal)}", *(["word"] * (words - 1)))),
        )
        for ordinal in range(1, count + 1)
    )


def _stage_map(build: PuzzleBuild, variant: str) -> dict[tuple[str, int], Path]:
    record = build.stationary if variant == "stationary" else build.rekey
    return {(stage.agent_id, stage.ordinal): stage.source_path for stage in record.stages}


def _normalized_words(value: str) -> tuple[str, ...]:
    return tuple(token.normalized for token in word_tokens(value) if token.normalized is not None)


@dataclass(frozen=True)
class BuiltBlock:
    build: PuzzleBuild
    first_root: Path
    second_root: Path


@pytest.fixture(scope="module")
def built_blocks(tmp_path_factory: pytest.TempPathFactory) -> Mapping[str, BuiltBlock]:
    output_root = tmp_path_factory.mktemp("paired-blocks")
    built: dict[str, BuiltBlock] = {}
    block_id = BLOCK_IDS[0]
    first_root = output_root / block_id / "first"
    second_root = output_root / block_id / "second"
    first = build_module.build_puzzle(ROOT, first_root, CALIBRATION_SOURCE, "calibration", block_id)
    second = build_module.build_puzzle(
        ROOT, second_root, CALIBRATION_SOURCE, "calibration", block_id
    )
    assert first == second
    assert _files(first_root) == _files(second_root)
    built[block_id] = BuiltBlock(first, first_root, second_root)
    return built


def test_candidate_windows_use_exact_first_end_and_boundary_order() -> None:
    windows = candidate_windows(_paragraphs(count=227))
    first = next(windows)
    second = next(windows)

    assert (
        first.paragraph_start,
        first.paragraph_end,
        first.word_count,
        first.boundary_index,
    ) == (47, 226, 18_000, 90)
    assert (
        second.paragraph_start,
        second.paragraph_end,
        second.word_count,
        second.boundary_index,
    ) == (48, 227, 18_000, 90)


def test_design_search_stops_after_512_window_starts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    starts: list[int] = []

    def reject(window: object, block_id: str, seed: int) -> object:
        del block_id, seed
        starts.append(window.paragraph_start)  # type: ignore[attr-defined]
        raise InfeasibleDesignError(("synthetic-infeasible",))

    monkeypatch.setattr(block_module, "allocate_window", reject)
    block = BlockDefinition(
        block_id="synthetic-block",
        phase="calibration",
        source_id="synthetic",
        seed=17,
        window=WindowPin(0, 0, 0, ""),
        boundary_stage=4,
    )

    with pytest.raises(InfeasibleDesignError, match="no candidate window satisfied"):
        design_block(_paragraphs(count=900), block, discover=True)

    assert starts == list(range(181, 693))


def test_normal_design_revalidates_the_first_feasible_pin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paragraphs = _paragraphs(count=226)
    first = next(candidate_windows(paragraphs))
    allocation = SimpleNamespace(
        design=SimpleNamespace(controls=(), changed_types=()),
        tier=block_module.TIERS[0],
        control_tier="strict",
    )
    monkeypatch.setattr(block_module, "allocate_window", lambda *args: allocation)
    block = BlockDefinition(
        block_id="synthetic-block",
        phase="calibration",
        source_id="synthetic",
        seed=17,
        window=first.pin(),
        boundary_stage=4,
    )

    assert design_block(paragraphs, block, discover=False).window == first

    stale = replace(block, window=replace(first.pin(), sha256="0" * 64))
    with pytest.raises(ValueError, match="not the first deterministic feasible window"):
        design_block(paragraphs, stale, discover=False)


def test_plain_utf8_source_builds_without_registration_or_pinning(tmp_path: Path) -> None:
    source = tmp_path / "dropped-in.txt"
    source.write_text(CALIBRATION_SOURCE.read_text(encoding="utf-8"), encoding="utf-8")
    output = tmp_path / "build"

    build = build_module.build_puzzle(ROOT, output, source, "calibration")

    assert build.block_id.startswith("dropped-in-")
    assert build.source.source_id == build.block_id
    assert (output / "puzzle-build.json").is_file()


def test_ineligible_source_rejects_without_publication(tmp_path: Path) -> None:
    source = tmp_path / "too-short.txt"
    source.write_text("This text cannot contain a qualifying puzzle window.\n", encoding="utf-8")
    output = tmp_path / "build"

    with pytest.raises(InfeasibleDesignError, match="no bounded 16,000-to-20,000-word"):
        build_module.build_puzzle(ROOT, output, source, "validation")

    assert not output.exists()


def test_validate_pair_rejects_twin_divergence_and_weak_manipulation() -> None:
    stationary = {
        (agent_id, ordinal): f"{agent_id}:{ordinal}".encode()
        for agent_id in AGENT_IDS
        for ordinal in range(1, 7)
    }
    rekey = dict(stationary)
    valid = {
        "boundary_stage": 4,
        "stationary_old_key_loss": 0.0,
        "rekey_old_key_loss": 0.2,
        "changed_token_mass_by_agent": {agent_id: 0.2 for agent_id in AGENT_IDS},
    }
    build_module.validate_pair(
        stationary_stage_bytes=stationary,
        rekey_stage_bytes=rekey,
        **valid,
    )

    divergent = dict(rekey)
    divergent[("agent-2", 3)] = b"different"
    with pytest.raises(ValueError, match="before the manipulation boundary"):
        build_module.validate_pair(
            stationary_stage_bytes=stationary,
            rekey_stage_bytes=divergent,
            **valid,
        )

    with pytest.raises(ValueError, match="Stationary"):
        build_module.validate_pair(
            stationary_stage_bytes=stationary,
            rekey_stage_bytes=rekey,
            **{**valid, "stationary_old_key_loss": 0.01},
        )

    with pytest.raises(ValueError, match="old-key loss"):
        build_module.validate_pair(
            stationary_stage_bytes=stationary,
            rekey_stage_bytes=rekey,
            **{**valid, "rekey_old_key_loss": 0.149},
        )

    weak_mass = {agent_id: 0.2 for agent_id in AGENT_IDS}
    weak_mass["agent-3"] = 0.149
    with pytest.raises(ValueError, match="changed mass"):
        build_module.validate_pair(
            stationary_stage_bytes=stationary,
            rekey_stage_bytes=rekey,
            **{**valid, "changed_token_mass_by_agent": weak_mass},
        )


@pytest.mark.parametrize("reason", ["all-tiers-infeasible", "unmatched-controls"])
def test_design_failures_publish_nothing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    reason: str,
) -> None:
    output = tmp_path / reason

    def fail_design(*args: object, **kwargs: object) -> object:
        del args, kwargs
        raise InfeasibleDesignError((reason,))

    monkeypatch.setattr(build_module, "design_block", fail_design)

    with pytest.raises(InfeasibleDesignError, match=reason):
        build_module.build_puzzle(ROOT, output, CALIBRATION_SOURCE, "calibration", BLOCK_IDS[0])

    assert not output.exists()


@pytest.mark.parametrize("message", ["pre-boundary divergence", "insufficient old-key loss"])
def test_pair_validation_failures_publish_nothing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    message: str,
) -> None:
    output = tmp_path / message.replace(" ", "-")

    def fail_pair(**kwargs: object) -> None:
        del kwargs
        raise ValueError(message)

    monkeypatch.setattr(
        build_module,
        "revise_explicit_types",
        lambda *, prior_key, **kwargs: prior_key,
    )
    monkeypatch.setattr(build_module, "validate_pair", fail_pair)

    with pytest.raises(ValueError, match=message):
        build_module.build_puzzle(ROOT, output, CALIBRATION_SOURCE, "calibration", BLOCK_IDS[0])

    assert not output.exists()


def test_build_refuses_an_existing_nonempty_destination(tmp_path: Path) -> None:
    output = tmp_path / "occupied"
    output.mkdir()
    sentinel = output / "keep.txt"
    sentinel.write_text("user data\n", encoding="utf-8")

    with pytest.raises(FileExistsError, match="non-empty"):
        build_module.build_puzzle(ROOT, output, CALIBRATION_SOURCE, "calibration", BLOCK_IDS[0])

    assert sentinel.read_text(encoding="utf-8") == "user data\n"
    assert tuple(_files(output)) == (Path("keep.txt"),)


def test_eligible_source_rebuilds_byte_identically(
    built_blocks: Mapping[str, BuiltBlock],
) -> None:
    assert tuple(built_blocks) == (BLOCK_IDS[0],)
    for block_id, built in built_blocks.items():
        manifest = _json(built.first_root / "puzzle-build.json")
        assert PuzzleBuild.from_dict(manifest) == built.build
        assert manifest["schemaVersion"] == 4
        assert built.build.block_id == block_id
        assert built.build.agent_ids == AGENT_IDS
        assert built.build.stage_count == 6
        assert built.build.boundary_stage == 4


def test_calibration_pair_has_exact_union_and_verified_key_manipulation(
    built_blocks: Mapping[str, BuiltBlock],
) -> None:
    built = built_blocks[BLOCK_IDS[0]]
    build = built.build
    root = built.first_root
    stationary_paths = _stage_map(build, "stationary")
    rekey_paths = _stage_map(build, "rekey")
    base_key = _json(root / build.base_key_path)
    revised_key = _json(root / build.rekey.key_transitions[0].key_path)
    design = _json(root / build.oracle_design.path)
    allocation = _json(root / build.allocation.path)

    changed = {
        *design["sentinels"],
        *(word for specialist_words in design["specialists"].values() for word in specialist_words),
    }
    controls = {match["controlType"] for match in design["controls"]}
    assert changed
    assert changed.isdisjoint(controls)
    assert set(base_key) == set(base_key.values()) == set(revised_key) == set(revised_key.values())
    assert all(revised_key[word] != base_key[word] for word in changed)
    assert all(revised_key[word] != word for word in changed)
    assert all(revised_key[word] == base_key[word] for word in controls)

    for geometry, stationary_path in stationary_paths.items():
        agent_id, ordinal = geometry
        rekey_path = rekey_paths[geometry]
        stationary_bytes = (root / stationary_path).read_bytes()
        rekey_bytes = (root / rekey_path).read_bytes()
        if ordinal < 4:
            assert stationary_bytes == rekey_bytes
        plaintext = (root / f"oracle/checker/{agent_id}/stage-{ordinal:02d}.txt").read_text(
            encoding="utf-8"
        )
        assert (root / stationary_path).read_text(encoding="utf-8") == apply_mapping(
            plaintext,
            base_key,
        )
        expected_rekey_key = revised_key if ordinal >= 4 else base_key
        assert (root / rekey_path).read_text(encoding="utf-8") == apply_mapping(
            plaintext,
            expected_rekey_key,
        )

    paragraphs = load_paragraphs(load_text_source(CALIBRATION_SOURCE))
    selected = paragraphs[build.window.paragraph_start - 1 : build.window.paragraph_end]
    plaintext = serialize_paragraphs(selected)
    assert (root / build.stationary.public_ciphertext_path).read_text(
        encoding="utf-8"
    ) == apply_mapping(plaintext, base_key)

    assignments = allocation["assignments"]
    assert isinstance(assignments, list)
    assignment_by_ordinal = {
        assignment["paragraphOrdinal"]: assignment for assignment in assignments
    }
    expected_ordinals = list(range(build.window.paragraph_start, build.window.paragraph_end + 1))
    assert sorted(assignment_by_ordinal) == expected_ordinals
    for agent_id in AGENT_IDS:
        for ordinal in range(1, 7):
            stage_ordinals = [
                assignment["paragraphOrdinal"]
                for assignment in assignments
                if assignment["agentId"] == agent_id and assignment["stage"] == ordinal
            ]
            assert stage_ordinals
            assert stage_ordinals == sorted(stage_ordinals)

    expected_rekey = serialize_paragraphs(
        tuple(
            apply_mapping(
                paragraph,
                revised_key if assignment_by_ordinal[source_ordinal]["stage"] >= 4 else base_key,
            )
            for source_ordinal, paragraph in zip(expected_ordinals, selected, strict=True)
        )
    )
    assert (root / build.rekey.public_ciphertext_path).read_text(encoding="utf-8") == expected_rekey

    post_words_by_agent = {
        agent_id: tuple(
            word
            for ordinal in range(4, 7)
            for word in _normalized_words(
                (root / f"oracle/checker/{agent_id}/stage-{ordinal:02d}.txt").read_text(
                    encoding="utf-8"
                )
            )
        )
        for agent_id in AGENT_IDS
    }
    changed_mass = {
        agent_id: sum(word in changed for word in words) / len(words)
        for agent_id, words in post_words_by_agent.items()
    }
    assert changed_mass == pytest.approx(build.manipulation_check.changed_token_mass_by_agent)
    all_post_words = tuple(word for words in post_words_by_agent.values() for word in words)
    assert sum(word in changed for word in all_post_words) / len(all_post_words) == pytest.approx(
        build.manipulation_check.rekey_old_key_loss
    )
    assert build.manipulation_check.stationary_old_key_loss == 0
    assert build.manipulation_check.rekey_old_key_loss >= 0.15


def test_agent_visible_variant_trees_contain_no_oracle_records(
    built_blocks: Mapping[str, BuiltBlock],
) -> None:
    forbidden_labels = (
        b'"anchors"',
        b'"sentinels"',
        b'"specialists"',
        b'"controls"',
        b'"rejectedTiers"',
        b'"preBoundaryIdentical"',
        b'"rekeyOldKeyLoss"',
        b'"changedTokenMassByAgent"',
        b"oracle/",
    )
    for built in built_blocks.values():
        visible = _files(built.first_root / "variants")
        assert visible
        assert all(path.suffix != ".json" for path in visible)
        assert all("oracle" not in path.parts for path in visible)
        for content in visible.values():
            assert not any(label in content for label in forbidden_labels)
