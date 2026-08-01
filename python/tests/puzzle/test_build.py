from __future__ import annotations

from pathlib import Path

import pytest
from palimpsest.puzzle import build as build_module

ROOT = Path(__file__).resolve().parents[3]
pytestmark = pytest.mark.material


def _definition() -> dict[str, object]:
    return {
        "fixtureId": "fixture-streamlined-test",
        "source": {
            "path": "fixtures/corpus/fortunes-fool.txt",
            "format": "plain-text",
            "window": {
                "paragraphStart": 0,
                "paragraphEnd": 0,
                "wordCount": 0,
                "sha256": "",
            },
        },
        "references": [],
        "seed": 73,
        "agentIds": ["agent-1", "agent-2", "agent-3"],
        "stageCount": 6,
        "variants": [
            {"variantId": "stationary", "rekeyFromStage": None},
            {"variantId": "rekey-stage-4", "rekeyFromStage": 4},
        ],
        "allocationConstraints": {
            "minimumAnchors": 12,
            "minimumSentinels": 6,
            "minimumSpecialistsPerAgent": 3,
            "minimumChangedMass": 0.15,
            "tiers": [
                {
                    "tier": "strict",
                    "minimumSpecialistOwnerShare": 0.67,
                    "minimumOwnerOccurrences": 3,
                    "minimumSentinelOccurrences": 3,
                    "maximumSoloCoverage": 0.6,
                    "maximumRegionDeviation": 0.04,
                    "maximumStageDeviation": 0.12,
                    "maximumControlDistance": 0.15,
                },
                {
                    "tier": "balanced",
                    "minimumSpecialistOwnerShare": 0.6,
                    "minimumOwnerOccurrences": 2,
                    "minimumSentinelOccurrences": 2,
                    "maximumSoloCoverage": 0.67,
                    "maximumRegionDeviation": 0.07,
                    "maximumStageDeviation": 0.18,
                    "maximumControlDistance": 0.25,
                },
                {
                    "tier": "fallback",
                    "minimumSpecialistOwnerShare": 0.55,
                    "minimumOwnerOccurrences": 2,
                    "minimumSentinelOccurrences": 1,
                    "maximumSoloCoverage": 0.75,
                    "maximumRegionDeviation": 0.1,
                    "maximumStageDeviation": 0.25,
                    "maximumControlDistance": 0.4,
                },
            ],
        },
    }


def _build(tmp_path: Path, name: str, selected: str) -> tuple[dict[str, object], Path]:
    root = tmp_path / name
    record = build_module.build_realized_fixture(ROOT, root, _definition(), selected)
    return record, root


def test_realized_fixture_build_is_deterministic_and_flat(tmp_path: Path) -> None:
    first, first_root = _build(tmp_path, "first", "stationary")
    second, second_root = _build(tmp_path, "second", "stationary")

    assert first == second
    assert first["schemaVersion"] == 2
    assert first["rekeyAtStage"] is None
    assert "references" not in first
    assert "variants" not in first
    assert sorted(path.name for path in (first_root / "oracle/keys").iterdir()) == ["base.json"]
    assert "seed" not in first
    assert (first_root / "complete/ciphertext.txt").read_bytes() == (
        second_root / "complete/ciphertext.txt"
    ).read_bytes()


def test_stationary_and_rekey_realizations_share_preboundary_evidence(tmp_path: Path) -> None:
    stationary, stationary_root = _build(tmp_path, "stationary", "stationary")
    rekey, rekey_root = _build(tmp_path, "rekey", "rekey-stage-4")
    assert sorted(path.name for path in (rekey_root / "oracle/keys").iterdir()) == [
        "base.json",
        "rekey-stage-04.json",
    ]

    assert stationary["constructionId"] == rekey["constructionId"]
    assert rekey["rekeyAtStage"] == 4
    stationary_stages = stationary["stages"]
    rekey_stages = rekey["stages"]
    assert isinstance(stationary_stages, list) and isinstance(rekey_stages, list)
    for baseline, changed in zip(stationary_stages, rekey_stages, strict=True):
        assert isinstance(baseline, dict) and isinstance(changed, dict)
        if baseline["ordinal"] < 4:
            assert baseline["sha256"] == changed["sha256"]
            assert (stationary_root / str(baseline["sourcePath"])).read_bytes() == (
                rekey_root / str(changed["sourcePath"])
            ).read_bytes()


def test_agent_visible_tree_has_no_references_or_oracle_labels(tmp_path: Path) -> None:
    _, root = _build(tmp_path, "visible", "stationary")
    visible = [
        path
        for directory in (root / "private", root / "complete")
        for path in directory.rglob("*")
        if path.is_file()
    ]
    assert visible
    assert not (root / "references").exists()
    assert not (root / "variants").exists()
    forbidden = (b'"anchors"', b'"sentinels"', b'"specialists"', b'"controls"', b"oracle/")
    assert all(not any(marker in path.read_bytes() for marker in forbidden) for path in visible)


def test_build_refuses_to_overwrite_nonempty_output(tmp_path: Path) -> None:
    output = tmp_path / "occupied"
    output.mkdir()
    sentinel = output / "keep.txt"
    sentinel.write_text("user data\n", encoding="utf-8")

    with pytest.raises(FileExistsError, match="non-empty"):
        build_module.build_realized_fixture(ROOT, output, _definition(), "stationary")

    assert sentinel.read_text(encoding="utf-8") == "user data\n"
