from __future__ import annotations

import json
from pathlib import Path

import pytest
from palimpsest.evaluation.checker import check_candidate_file, check_reconstruction


@pytest.fixture()
def fixture_root(tmp_path: Path) -> Path:
    root = tmp_path / "fixture"
    stages = [
        {
            "agentId": agent_id,
            "ordinal": ordinal,
            "sourcePath": f"variants/stationary/private/{agent_id}/stages/stage-{ordinal:02d}.txt",
        }
        for agent_id in ("agent-1", "agent-2")
        for ordinal in range(1, 4)
    ]
    rekey_stages = [
        {
            **stage,
            "sourcePath": str(stage["sourcePath"]).replace("/stationary/", "/rekey/"),
        }
        for stage in stages
    ]
    root.mkdir()
    (root / "fixture.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "agentIds": ["agent-1", "agent-2"],
                "stageCount": 3,
                "variants": {
                    "stationary": {"variantId": "stationary", "stages": stages},
                    "rekey": {"variantId": "rekey", "stages": rekey_stages},
                },
            }
        ),
        encoding="utf-8",
    )
    for agent_id in ("agent-1", "agent-2"):
        checker_root = root / "oracle" / "checker" / agent_id
        checker_root.mkdir(parents=True)
        for ordinal in range(1, 4):
            (checker_root / f"stage-{ordinal:02d}.txt").write_text(
                f"{agent_id} truth {ordinal}", encoding="utf-8"
            )
    return root


def test_checker_uses_selected_fixture_variant_and_released_prefix(
    fixture_root: Path,
) -> None:
    truth = (fixture_root / "oracle/checker/agent-2/stage-01.txt").read_text(encoding="utf-8")
    result = check_reconstruction(
        fixture_root=fixture_root,
        variant_id="rekey",
        agent_id="agent-2",
        released_ordinals=(1,),
        candidate=truth,
    )

    assert result.coverage == 1.0
    assert result.accuracy == 1.0


def test_checker_matches_complete_dynamic_stage_prefix(fixture_root: Path) -> None:
    truth = "\n".join(
        (fixture_root / f"oracle/checker/agent-1/stage-{ordinal:02d}.txt").read_text(
            encoding="utf-8"
        )
        for ordinal in range(1, 4)
    )

    result = check_reconstruction(
        fixture_root=fixture_root,
        variant_id="stationary",
        agent_id="agent-1",
        released_ordinals=(1, 2, 3),
        candidate=truth,
    )

    assert result.coverage == 1.0
    assert result.accuracy == 1.0


def test_checker_rejects_gaps_unknown_variants_and_undeclared_agents(
    fixture_root: Path,
) -> None:
    with pytest.raises(ValueError, match="released prefix"):
        check_reconstruction(
            fixture_root=fixture_root,
            variant_id="stationary",
            agent_id="agent-1",
            released_ordinals=(1, 3),
            candidate="candidate",
        )
    with pytest.raises(ValueError, match="variant"):
        check_reconstruction(
            fixture_root=fixture_root,
            variant_id="missing",
            agent_id="agent-1",
            released_ordinals=(1,),
            candidate="candidate",
        )
    with pytest.raises(ValueError, match="agent"):
        check_reconstruction(
            fixture_root=fixture_root,
            variant_id="stationary",
            agent_id="agent-3",
            released_ordinals=(1,),
            candidate="candidate",
        )


def test_checker_result_discloses_only_aggregate_metrics(fixture_root: Path) -> None:
    result = check_reconstruction(
        fixture_root=fixture_root,
        variant_id="stationary",
        agent_id="agent-2",
        released_ordinals=(1,),
        candidate="definitely wrong",
    ).to_dict()

    assert set(result) == {"matchedWords", "totalWords", "coverage", "accuracy"}
    assert not any(isinstance(value, str) for value in result.values())


def test_checker_returns_plain_error_for_an_unreadable_candidate(
    fixture_root: Path, tmp_path: Path
) -> None:
    result = check_candidate_file(
        fixture_root=fixture_root,
        variant_id="stationary",
        agent_id="agent-1",
        released_ordinals=(1,),
        candidate_path=tmp_path / "missing.txt",
    )
    assert result == {"error": "candidate could not be read"}
