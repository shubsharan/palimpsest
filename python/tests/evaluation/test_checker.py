from __future__ import annotations

import json
from pathlib import Path

import pytest
from palimpsest.evaluation.checker import check_candidate_file, check_reconstruction
from palimpsest.puzzle.build import build_puzzle

ROOT = Path(__file__).resolve().parents[3]
GOLDEN = json.loads((ROOT / "tests/golden/behavior.json").read_text(encoding="utf-8"))
OFFLINE = GOLDEN["offlineFixture"]


@pytest.fixture(scope="module")
def build_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    output = tmp_path_factory.mktemp("checker-build") / "build"
    inputs = OFFLINE["inputs"]
    build = build_puzzle(
        ROOT,
        output,
        seed=inputs["seed"],
        stage_interval_ms=inputs["stageIntervalMs"],
        transition_stage=inputs["transitionStage"],
        changed_token_mass=inputs["changedTokenMass"],
    )
    assert build.build_id == OFFLINE["buildId"]
    return output


def test_checker_uses_only_the_requested_released_prefix_and_returns_aggregates(
    build_root: Path,
) -> None:
    first_truth = (build_root / "oracle/checker/agent-1/stage-01.txt").read_text(encoding="utf-8")
    result = check_reconstruction(
        build_root=build_root,
        agent_id="agent-1",
        released_ordinals=(1,),
        candidate=first_truth,
    )

    assert result.to_dict() == OFFLINE["agent1Stage1Checker"]

    two_stage_result = check_reconstruction(
        build_root=build_root,
        agent_id="agent-1",
        released_ordinals=(1, 2),
        candidate=first_truth,
    )
    assert two_stage_result.matched_words == result.matched_words
    assert two_stage_result.total_words > result.total_words
    assert two_stage_result.coverage < 1.0


def test_checker_rejects_unreleased_gaps_and_peer_or_unknown_inputs(build_root: Path) -> None:
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
            agent_id="agent-4",
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


@pytest.mark.parametrize(
    ("field", "value", "match"),
    [
        ("agentCount", True, "agentCount.*integer"),
        ("stageCount", 5, "exactly three agents"),
        ("publicCiphertextPath", "../oracle.txt", "safe relative path"),
    ],
)
def test_checker_rejects_malformed_build_manifest_before_reading_truth(
    tmp_path: Path, field: str, value: object, match: str
) -> None:
    malformed_root = tmp_path / field
    malformed_root.mkdir()
    manifest = {
        "schemaVersion": 1,
        "buildId": "build-" + "a" * 64,
        "agentCount": 3,
        "stageCount": 6,
        "transitionStage": 4,
        "stageIntervalMs": 10,
        "changedSymbols": ["alpha"],
        "publicCiphertextPath": "evaluation/ciphertext.txt",
        "referenceCorpusPath": "public/reference",
        "privateStageRoots": {
            agent_id: f"private/{agent_id}/stages" for agent_id in ("agent-1", "agent-2", "agent-3")
        },
        "oracleRoot": "oracle",
        "stages": [
            {
                "agentId": agent_id,
                "ordinal": ordinal,
                "releaseOffsetMs": (ordinal - 1) * 10,
                "sourcePath": f"private/{agent_id}/stages/{ordinal:02d}.txt",
                "tokenCount": 1,
                "sha256": "b" * 64,
                "regime": "base" if ordinal < 4 else "revised",
            }
            for agent_id in ("agent-1", "agent-2", "agent-3")
            for ordinal in range(1, 7)
        ],
    }
    manifest[field] = value
    (malformed_root / "puzzle-build.json").write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match=match):
        check_reconstruction(
            build_root=malformed_root,
            agent_id="agent-1",
            released_ordinals=(1,),
            candidate="candidate",
        )
