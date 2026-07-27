from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from palimpsest.puzzle.manifest import (
    AGENT_IDS,
    STAGE_COUNT,
    EvidenceStage,
    PuzzleBuild,
)


def _valid_stages(*, stage_interval_ms: int = 10) -> tuple[EvidenceStage, ...]:
    return tuple(
        EvidenceStage(
            agent_id=agent_id,
            ordinal=ordinal,
            release_offset_ms=(ordinal - 1) * stage_interval_ms,
            source_path=Path(f"private/{agent_id}/stages/{ordinal:02d}.txt"),
            token_count=20,
            sha256="a" * 64,
            regime="base" if ordinal < 4 else "revised",
        )
        for agent_id in AGENT_IDS
        for ordinal in range(1, STAGE_COUNT + 1)
    )


def _valid_build() -> PuzzleBuild:
    return PuzzleBuild(
        build_id="build-" + "b" * 64,
        stage_interval_ms=10,
        transition_stage=4,
        changed_symbols=("alpha", "beta"),
        public_ciphertext_path=Path("evaluation/ciphertext.txt"),
        reference_corpus_path=Path("public/reference"),
        oracle_root=Path("oracle"),
        stages=_valid_stages(),
    )


def _valid_manifest() -> dict[str, Any]:
    return _valid_build().to_dict()


def _first_stage(manifest: dict[str, Any]) -> dict[str, Any]:
    stages = manifest["stages"]
    assert isinstance(stages, list)
    stage = stages[0]
    assert isinstance(stage, dict)
    return stage


def test_puzzle_build_requires_three_six_stage_streams() -> None:
    build = _valid_build()

    assert build.agent_count == 3
    assert build.stage_count == 6
    assert build.to_dict()["privateStageRoots"]["agent-2"] == "private/agent-2/stages"
    assert PuzzleBuild.from_dict(build.to_dict()) == build


def test_puzzle_build_rejects_missing_or_duplicate_stages() -> None:
    stage = EvidenceStage(
        agent_id="agent-1",
        ordinal=1,
        release_offset_ms=0,
        source_path=Path("private/agent-1/stages/01.txt"),
        token_count=1,
        sha256="a" * 64,
    )
    with pytest.raises(ValueError, match="exactly six ordered stages"):
        PuzzleBuild(
            build_id="build-" + "b" * 64,
            stage_interval_ms=10,
            transition_stage=4,
            changed_symbols=("alpha",),
            public_ciphertext_path=Path("evaluation/ciphertext.txt"),
            reference_corpus_path=Path("public/reference"),
            oracle_root=Path("oracle"),
            stages=(stage, stage),
        )


def test_puzzle_build_rejects_offsets_or_regimes_outside_the_shared_transition() -> None:
    stages = tuple(
        EvidenceStage(
            agent_id=agent_id,
            ordinal=ordinal,
            release_offset_ms=(ordinal - 1) * 10 + (1 if agent_id == "agent-2" else 0),
            source_path=Path(f"private/{agent_id}/stages/{ordinal:02d}.txt"),
            token_count=20,
            sha256="a" * 64,
            regime="base" if ordinal < 4 else "revised",
        )
        for agent_id in AGENT_IDS
        for ordinal in range(1, STAGE_COUNT + 1)
    )

    with pytest.raises(ValueError, match="release offsets"):
        PuzzleBuild(
            build_id="build-" + "b" * 64,
            stage_interval_ms=10,
            transition_stage=4,
            changed_symbols=("alpha",),
            public_ciphertext_path=Path("evaluation/ciphertext.txt"),
            reference_corpus_path=Path("public/reference"),
            oracle_root=Path("oracle"),
            stages=stages,
        )


@pytest.mark.parametrize(
    "field",
    [
        "schemaVersion",
        "buildId",
        "agentCount",
        "stageCount",
        "transitionStage",
        "stageIntervalMs",
        "changedSymbols",
        "publicCiphertextPath",
        "referenceCorpusPath",
        "privateStageRoots",
        "oracleRoot",
        "stages",
    ],
)
def test_manifest_decoder_requires_every_top_level_field(field: str) -> None:
    manifest = _valid_manifest()
    del manifest[field]

    with pytest.raises(ValueError, match=field):
        PuzzleBuild.from_dict(manifest)


@pytest.mark.parametrize(
    ("field", "value", "match"),
    [
        ("schemaVersion", True, "schemaVersion.*integer"),
        ("schemaVersion", 2, "schema version"),
        ("buildId", False, "buildId.*string"),
        ("buildId", "build-invalid", "Build ID"),
        ("agentCount", True, "agentCount.*integer"),
        ("agentCount", 2, "exactly three agents"),
        ("stageCount", True, "stageCount.*integer"),
        ("stageCount", 5, "exactly three agents"),
        ("transitionStage", True, "transitionStage.*integer"),
        ("transitionStage", 7, "between 2 and 6"),
        ("stageIntervalMs", True, "stageIntervalMs.*integer"),
        ("stageIntervalMs", 0, "stageIntervalMs.*at least 1"),
    ],
)
def test_manifest_decoder_rejects_invalid_scalar_fields(
    field: str, value: object, match: str
) -> None:
    manifest = _valid_manifest()
    manifest[field] = value

    with pytest.raises(ValueError, match=match):
        PuzzleBuild.from_dict(manifest)


@pytest.mark.parametrize(
    ("value", "match"),
    [
        ([], "non-empty array"),
        ("alpha", "non-empty array"),
        (["alpha", True], r"changedSymbols\[1\].*string"),
        (["alpha", "alpha"], "unique and sorted"),
        (["beta", "alpha"], "unique and sorted"),
    ],
)
def test_manifest_decoder_rejects_invalid_changed_symbols(value: object, match: str) -> None:
    manifest = _valid_manifest()
    manifest["changedSymbols"] = value

    with pytest.raises(ValueError, match=match):
        PuzzleBuild.from_dict(manifest)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("publicCiphertextPath", "../oracle.txt"),
        ("referenceCorpusPath", "/private/reference"),
        ("oracleRoot", r"C:\oracle"),
        ("oracleRoot", "oracle//nested"),
    ],
)
def test_manifest_decoder_rejects_unsafe_or_mistyped_paths(field: str, value: object) -> None:
    manifest = _valid_manifest()
    manifest[field] = value

    with pytest.raises(ValueError, match=f"{field}.*safe relative path"):
        PuzzleBuild.from_dict(manifest)

    manifest = _valid_manifest()
    manifest[field] = True
    with pytest.raises(ValueError, match=f"{field}.*string"):
        PuzzleBuild.from_dict(manifest)


@pytest.mark.parametrize(
    "roots",
    [
        [],
        {"agent-1": "private/agent-1/stages"},
        {
            "agent-1": "private/agent-1/stages",
            "agent-2": "private/agent-2/stages",
            "agent-3": "private/agent-3/stages",
            "agent-4": "private/agent-4/stages",
        },
    ],
)
def test_manifest_decoder_requires_exact_private_stage_root_keys(roots: object) -> None:
    manifest = _valid_manifest()
    manifest["privateStageRoots"] = roots

    with pytest.raises(
        ValueError, match=r"privateStageRoots.*exactly three agents|must be an object"
    ):
        PuzzleBuild.from_dict(manifest)


def test_manifest_decoder_rejects_unsafe_private_stage_roots() -> None:
    manifest = _valid_manifest()
    roots = manifest["privateStageRoots"]
    assert isinstance(roots, dict)
    roots["agent-2"] = r"..\oracle"

    with pytest.raises(ValueError, match=r"agent-2 private stage root.*safe relative path"):
        PuzzleBuild.from_dict(manifest)


@pytest.mark.parametrize(
    "field",
    ["agentId", "ordinal", "releaseOffsetMs", "sourcePath", "tokenCount", "sha256", "regime"],
)
def test_manifest_decoder_requires_every_stage_field(field: str) -> None:
    manifest = _valid_manifest()
    del _first_stage(manifest)[field]

    with pytest.raises(ValueError, match=field):
        PuzzleBuild.from_dict(manifest)


@pytest.mark.parametrize(
    ("field", "value", "match"),
    [
        ("agentId", "agent-4", "agentId.*declared agent"),
        ("ordinal", True, "ordinal.*integer"),
        ("releaseOffsetMs", False, "releaseOffsetMs.*integer"),
        ("sourcePath", "../stage.txt", "sourcePath.*safe relative path"),
        ("tokenCount", True, "tokenCount.*integer"),
        ("tokenCount", 0, "tokenCount.*at least 1"),
        ("sha256", "A" * 64, "lowercase SHA-256"),
        ("regime", "transition", "regime.*base or revised"),
    ],
)
def test_manifest_decoder_rejects_invalid_stage_fields(
    field: str, value: object, match: str
) -> None:
    manifest = _valid_manifest()
    _first_stage(manifest)[field] = value

    with pytest.raises(ValueError, match=match):
        PuzzleBuild.from_dict(manifest)


def test_manifest_decoder_rejects_non_object_or_reordered_stages() -> None:
    manifest = _valid_manifest()
    manifest["stages"][0] = []
    with pytest.raises(ValueError, match="stage 1 must be an object"):
        PuzzleBuild.from_dict(manifest)

    manifest = _valid_manifest()
    manifest["stages"][0], manifest["stages"][1] = (
        manifest["stages"][1],
        manifest["stages"][0],
    )
    with pytest.raises(ValueError, match="six ordered stages per agent"):
        PuzzleBuild.from_dict(manifest)


@pytest.mark.parametrize(
    ("field", "value", "match"),
    [
        ("releaseOffsetMs", 1, "release offsets"),
        ("regime", "revised", "regime does not match"),
    ],
)
def test_manifest_decoder_rejects_inconsistent_stage_geometry(
    field: str, value: object, match: str
) -> None:
    manifest = _valid_manifest()
    _first_stage(manifest)[field] = value

    with pytest.raises(ValueError, match=match):
        PuzzleBuild.from_dict(manifest)
