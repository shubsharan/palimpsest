from __future__ import annotations

from pathlib import Path

import pytest
from palimpsest.evaluation.checker import check_candidate_file, check_reconstruction
from palimpsest.puzzle.build import build_puzzle

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def build_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    output = tmp_path_factory.mktemp("checker-build") / "build"
    build_puzzle(ROOT, output, "calibration-theron-ware")
    return output


def test_checker_uses_declared_agent_and_released_prefix(build_root: Path) -> None:
    truth = (build_root / "oracle/checker/agent-3/stage-01.txt").read_text(encoding="utf-8")
    result = check_reconstruction(
        build_root=build_root,
        agent_id="agent-3",
        released_ordinals=(1,),
        candidate=truth,
    )

    assert result.coverage == 1.0
    assert result.accuracy == 1.0


def test_checker_matches_complete_six_stage_prefix(build_root: Path) -> None:
    truth = "\n\n".join(
        (build_root / f"oracle/checker/agent-1/stage-{ordinal:02d}.txt").read_text(encoding="utf-8")
        for ordinal in range(1, 7)
    )

    result = check_reconstruction(
        build_root=build_root,
        agent_id="agent-1",
        released_ordinals=(1, 2, 3, 4, 5, 6),
        candidate=truth,
    )

    assert result.coverage == 1.0
    assert result.accuracy == 1.0


def test_checker_rejects_gaps_and_undeclared_agents(build_root: Path) -> None:
    with pytest.raises(ValueError, match="released prefix"):
        check_reconstruction(
            build_root=build_root,
            agent_id="agent-1",
            released_ordinals=(1, 3),
            candidate="candidate",
        )
    with pytest.raises(ValueError, match="agent"):
        check_reconstruction(
            build_root=build_root,
            agent_id="agent-6",
            released_ordinals=(1,),
            candidate="candidate",
        )


def test_checker_result_does_not_disclose_truth_or_positions(build_root: Path) -> None:
    result = check_reconstruction(
        build_root=build_root,
        agent_id="agent-2",
        released_ordinals=(1,),
        candidate="definitely wrong",
    ).to_dict()

    assert set(result) == {"matchedWords", "totalWords", "coverage", "accuracy"}
    assert not any(isinstance(value, str) for value in result.values())


def test_checker_returns_plain_error_for_an_unreadable_candidate(
    build_root: Path, tmp_path: Path
) -> None:
    result = check_candidate_file(
        build_root=build_root,
        agent_id="agent-1",
        released_ordinals=(1,),
        candidate_path=tmp_path / "missing.txt",
    )
    assert result == {"error": "candidate could not be read"}
