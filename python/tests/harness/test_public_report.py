from __future__ import annotations

import json
from pathlib import Path

import pytest
from palimpsest.contracts import canonical_json_bytes
from palimpsest.grading.score_report import METRIC_IDS
from palimpsest.replay.public_report import FORBIDDEN_MARKERS, build_public_report


def _attempt(tmp_path: Path) -> Path:
    attempt = tmp_path / "attempt"
    (attempt / "replay").mkdir(parents=True)
    (attempt / "grading").mkdir()
    (attempt / "replay/verdict.json").write_bytes(
        canonical_json_bytes(
            {
                "schemaVersion": 1,
                "runId": "run-1",
                "result": "pass",
                "replayDigest": "a" * 64,
            }
        )
    )
    (attempt / "grading/score-report.json").write_bytes(
        canonical_json_bytes(
            {
                "schemaVersion": 1,
                "contractId": "score-report",
                "runId": "run-1",
                "policyId": "palimpsest-score-v1",
                "metrics": {metric: 0.5 for metric in METRIC_IDS},
            }
        )
    )
    (attempt / "live.jsonl").write_bytes(
        canonical_json_bytes(
            {
                "sequence": 1,
                "eventType": "worker.completed",
                "producer": "model-bridge",
                "payload": {"secret": "must-not-project"},
            }
        )
        + b"\n"
    )
    return attempt


def test_builds_deterministic_narrow_public_projection(tmp_path: Path) -> None:
    (tmp_path / ".tool-versions").write_text("nodejs 26.5.0\n", encoding="utf-8")
    attempt = _attempt(tmp_path)

    first = build_public_report("run-1", attempt, tmp_path)
    first_bytes = {
        path.relative_to(attempt / "public"): path.read_bytes()
        for path in (attempt / "public").rglob("*")
        if path.is_file()
    }
    second = build_public_report("run-1", attempt, tmp_path)

    assert first == second
    assert first_bytes == {
        path.relative_to(attempt / "public"): path.read_bytes()
        for path in (attempt / "public").rglob("*")
        if path.is_file()
    }
    assert first["empiricalModelEvidence"] is False
    assert len(first["artifacts"]) == 6
    public_text = "\n".join(content.decode() for content in first_bytes.values()).casefold()
    assert "must-not-project" not in public_text
    assert not any(marker in public_text for marker in FORBIDDEN_MARKERS)


def test_rejects_unapproved_metric_or_nonpassing_replay(tmp_path: Path) -> None:
    (tmp_path / ".tool-versions").write_text("nodejs 26.5.0\n", encoding="utf-8")
    attempt = _attempt(tmp_path)
    score_path = attempt / "grading/score-report.json"
    score = json.loads(score_path.read_text(encoding="utf-8"))
    score["metrics"]["oracle"] = 1
    score_path.write_bytes(canonical_json_bytes(score))
    with pytest.raises(ValueError, match="frozen scoring policy"):
        build_public_report("run-1", attempt, tmp_path)

    score["metrics"].pop("oracle")
    score_path.write_bytes(canonical_json_bytes(score))
    replay_path = attempt / "replay/verdict.json"
    replay = json.loads(replay_path.read_text(encoding="utf-8"))
    replay["result"] = "invalid"
    replay_path.write_bytes(canonical_json_bytes(replay))
    with pytest.raises(ValueError, match="passing replay"):
        build_public_report("run-1", attempt, tmp_path)
