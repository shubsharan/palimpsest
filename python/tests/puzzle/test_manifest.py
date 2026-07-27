from __future__ import annotations

from pathlib import Path

import pytest
from palimpsest.puzzle.manifest import (
    AGENT_IDS,
    STAGE_COUNT,
    EvidenceStage,
    PuzzleBuild,
)


def test_puzzle_build_requires_three_six_stage_streams() -> None:
    stages = tuple(
        EvidenceStage(
            agent_id=agent_id,
            ordinal=ordinal,
            release_offset_ms=(ordinal - 1) * 10,
            source_path=Path(f"private/{agent_id}/stages/{ordinal:02d}.txt"),
            token_count=20,
            sha256="a" * 64,
        )
        for agent_id in AGENT_IDS
        for ordinal in range(1, STAGE_COUNT + 1)
    )
    build = PuzzleBuild(
        build_id="build-" + "b" * 64,
        stage_interval_ms=10,
        transition_stage=4,
        changed_symbols=("alpha", "beta"),
        public_ciphertext_path=Path("evaluation/ciphertext.txt"),
        reference_corpus_path=Path("public/reference"),
        oracle_root=Path("oracle"),
        stages=stages,
    )

    assert build.agent_count == 3
    assert build.stage_count == 6
    assert build.to_dict()["privateStageRoots"]["agent-2"] == "private/agent-2/stages"


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
