from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from palimpsest.puzzle.manifest import (
    EvidenceStage,
    PuzzleBuild,
    ReferenceSource,
    RekeyTransition,
    TargetSource,
    make_agent_ids,
)
from palimpsest.serialization import canonical_json_bytes


def _stages(
    agent_ids: tuple[str, ...] = ("agent-1", "agent-2"),
    stage_count: int = 4,
    stage_interval_ms: int = 10,
) -> tuple[EvidenceStage, ...]:
    return tuple(
        EvidenceStage(
            agent_id=agent_id,
            ordinal=ordinal,
            key_version=0 if ordinal < 3 else 1,
            release_offset_ms=(ordinal - 1) * stage_interval_ms,
            source_path=Path(f"private/{agent_id}/stages/stage-{ordinal:02d}.txt"),
            token_count=20,
            sha256="a" * 64,
        )
        for agent_id in agent_ids
        for ordinal in range(1, stage_count + 1)
    )


def _build() -> PuzzleBuild:
    return PuzzleBuild(
        build_id="build-" + "b" * 64,
        seed=17,
        source=TargetSource("middlemarch", "c" * 64, 10, 15),
        references=(
            ReferenceSource(
                "jane-eyre", "d" * 64, Path("public/reference/jane-eyre-reference.txt")
            ),
            ReferenceSource(
                "moby-dick", "e" * 64, Path("public/reference/moby-dick-reference.txt")
            ),
        ),
        agent_ids=("agent-1", "agent-2"),
        stage_count=4,
        stage_interval_ms=10,
        rekeys=(
            RekeyTransition(
                at_stage=3,
                key_version=1,
                changed_token_mass=0.2,
                changed_symbols=("alpha", "beta"),
                key_path=Path("oracle/keys/key-01.json"),
            ),
        ),
        public_ciphertext_path=Path("evaluation/ciphertext.txt"),
        reference_corpus_path=Path("public/reference"),
        private_stage_roots={
            "agent-1": Path("private/agent-1/stages"),
            "agent-2": Path("private/agent-2/stages"),
        },
        oracle_root=Path("oracle"),
        base_key_path=Path("oracle/keys/key-00.json"),
        stages=_stages(),
    )


def _manifest() -> dict[str, Any]:
    return _build().to_dict()


def test_make_agent_ids_is_canonical_and_numeric() -> None:
    assert make_agent_ids(3) == ("agent-1", "agent-2", "agent-3")
    assert make_agent_ids(10)[-1] == "agent-10"
    with pytest.raises(ValueError, match="at least two"):
        make_agent_ids(1)


def test_ten_agent_manifest_survives_canonical_object_key_order() -> None:
    build = _build()
    agent_ids = make_agent_ids(10)
    stages = _stages(agent_ids)
    expanded = replace(
        build,
        agent_ids=agent_ids,
        private_stage_roots={
            agent_id: Path(f"private/{agent_id}/stages") for agent_id in agent_ids
        },
        stages=stages,
    )
    encoded = canonical_json_bytes(expanded.to_dict())

    assert PuzzleBuild.from_dict(json.loads(encoded)) == expanded


def test_schema_v2_round_trips_dynamic_geometry_and_rekeys() -> None:
    build = _build()

    assert build.agent_count == 2
    assert build.to_dict()["schemaVersion"] == 2
    assert build.to_dict()["stages"][2]["keyVersion"] == 1
    assert PuzzleBuild.from_dict(build.to_dict()) == build


def test_zero_rekeys_uses_only_key_version_zero() -> None:
    build = _build()
    stages = tuple(replace(stage, key_version=0) for stage in build.stages)
    no_rekeys = replace(
        build,
        rekeys=(),
        stages=stages,
    )

    assert PuzzleBuild.from_dict(no_rekeys.to_dict()) == no_rekeys


@pytest.mark.parametrize(
    ("field", "value", "match"),
    [
        ("schemaVersion", 1, "schema version"),
        ("agentIds", ["agent-1", "agent-3"], "canonical"),
        ("stageCount", 0, "at least 1"),
        ("stageIntervalMs", 0, "at least 1"),
        ("publicCiphertextPath", "../oracle.txt", "safe relative path"),
    ],
)
def test_manifest_rejects_invalid_top_level_contract(field: str, value: object, match: str) -> None:
    manifest = _manifest()
    manifest[field] = value

    with pytest.raises(ValueError, match=match):
        PuzzleBuild.from_dict(manifest)


def test_manifest_rejects_reordered_or_duplicate_transition_stages() -> None:
    manifest = _manifest()
    rekeys = manifest["rekeys"]
    assert isinstance(rekeys, list)
    rekeys.append(
        {
            "atStage": 3,
            "keyVersion": 2,
            "changedTokenMass": 0.2,
            "changedSymbols": ["gamma", "theta"],
            "keyPath": "oracle/keys/key-02.json",
        }
    )

    with pytest.raises(ValueError, match="strictly ascending"):
        PuzzleBuild.from_dict(manifest)


@pytest.mark.parametrize(
    ("field", "value", "match"),
    [
        ("agentId", "agent-3", "ordered stages"),
        ("ordinal", 2, "ordered stages"),
        ("keyVersion", 1, "key version"),
        ("releaseOffsetMs", 1, "release offsets"),
        ("sourcePath", "../stage.txt", "safe relative path"),
    ],
)
def test_manifest_rejects_invalid_stage_geometry(field: str, value: object, match: str) -> None:
    manifest = _manifest()
    manifest["stages"][0][field] = value

    with pytest.raises(ValueError, match=match):
        PuzzleBuild.from_dict(manifest)


def test_manifest_requires_exact_dynamic_private_root_keys() -> None:
    manifest = _manifest()
    del manifest["privateStageRoots"]["agent-2"]

    with pytest.raises(ValueError, match="privateStageRoots"):
        PuzzleBuild.from_dict(manifest)
