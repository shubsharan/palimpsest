from __future__ import annotations

import json
from pathlib import Path

import pytest
from palimpsest.puzzle.build import build_puzzle
from palimpsest.puzzle.cipher import apply_mapping
from palimpsest.puzzle.manifest import PuzzleBuild

ROOT = Path(__file__).resolve().parents[3]


def definition(
    *,
    agent_count: int = 3,
    stage_count: int = 6,
    rekeys: list[dict[str, int | float]] | None = None,
) -> dict[str, object]:
    return {
        "target": {"corpus": "middlemarch", "chapters": {"start": 10, "end": 15}},
        "references": ["jane-eyre", "moby-dick"],
        "seed": 17,
        "agentCount": agent_count,
        "stageCount": stage_count,
        "stageIntervalMs": 120_000,
        "rekeys": [{"atStage": 4, "changedTokenMass": 0.2}] if rekeys is None else rekeys,
    }


def files(root: Path) -> dict[Path, bytes]:
    return {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}


@pytest.mark.parametrize(
    "puzzle",
    [
        definition(agent_count=2, stage_count=4, rekeys=[]),
        definition(agent_count=3, stage_count=6),
        definition(
            agent_count=3,
            stage_count=6,
            rekeys=[
                {"atStage": 3, "changedTokenMass": 0.2},
                {"atStage": 5, "changedTokenMass": 0.2},
            ],
        ),
        definition(agent_count=5, stage_count=6, rekeys=[]),
    ],
)
def test_dynamic_builds_are_byte_deterministic(tmp_path: Path, puzzle: dict[str, object]) -> None:
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"

    first = build_puzzle(ROOT, first_root, puzzle)
    second = build_puzzle(ROOT, second_root, puzzle)

    assert first == second
    assert files(first_root) == files(second_root)
    assert first.agent_count == puzzle["agentCount"]
    assert len(first.stages) == puzzle["agentCount"] * puzzle["stageCount"]
    assert (
        PuzzleBuild.from_dict(
            json.loads((first_root / "puzzle-build.json").read_text(encoding="utf-8"))
        )
        == first
    )


def test_successive_rekeys_use_versioned_keys_and_preserve_prior_stage_bytes(
    tmp_path: Path,
) -> None:
    puzzle = definition(
        rekeys=[
            {"atStage": 3, "changedTokenMass": 0.2},
            {"atStage": 5, "changedTokenMass": 0.2},
        ]
    )
    root = tmp_path / "build"
    build = build_puzzle(ROOT, root, puzzle)
    keys = [
        json.loads((root / path).read_text(encoding="utf-8")) for path in build.oracle_key_paths
    ]

    assert [transition.at_stage for transition in build.rekeys] == [3, 5]
    assert [stage.key_version for stage in build.stages if stage.agent_id == "agent-1"] == [
        0,
        0,
        1,
        1,
        2,
        2,
    ]
    for transition in build.rekeys:
        prior = keys[transition.key_version - 1]
        current = keys[transition.key_version]
        changed = set(transition.changed_symbols)
        assert all(prior[word] != current[word] for word in changed)
        assert all(prior[word] == current[word] for word in set(prior) - changed)

    for ordinal in (2, 3, 4, 5):
        stage = next(
            stage
            for stage in build.stages
            if stage.agent_id == "agent-1" and stage.ordinal == ordinal
        )
        truth = (root / f"oracle/checker/agent-1/stage-{ordinal:02d}.txt").read_text(
            encoding="utf-8"
        )
        ciphertext = (root / stage.source_path).read_text(encoding="utf-8")
        assert ciphertext.strip() == apply_mapping(truth.strip(), keys[stage.key_version])


def test_zero_rekeys_uses_one_stationary_key(tmp_path: Path) -> None:
    build = build_puzzle(ROOT, tmp_path / "build", definition(rekeys=[]))

    assert build.rekeys == ()
    assert len(build.oracle_key_paths) == 1
    assert {stage.key_version for stage in build.stages} == {0}


def test_build_rejects_infeasible_rekey_geometry_without_publishing(
    tmp_path: Path,
) -> None:
    output = tmp_path / "build"
    puzzle = definition(
        agent_count=5,
        rekeys=[
            {"atStage": 3, "changedTokenMass": 0.2},
            {"atStage": 5, "changedTokenMass": 0.2},
        ],
    )

    with pytest.raises(ValueError, match=r"[Rr]e-key at stage"):
        build_puzzle(ROOT, output, puzzle)
    assert not output.exists()


def test_build_refuses_an_existing_nonempty_destination(tmp_path: Path) -> None:
    output = tmp_path / "occupied"
    output.mkdir()
    (output / "keep.txt").write_text("user data\n", encoding="utf-8")

    with pytest.raises(FileExistsError, match="non-empty"):
        build_puzzle(ROOT, output, definition())
    assert (output / "keep.txt").read_text(encoding="utf-8") == "user data\n"
