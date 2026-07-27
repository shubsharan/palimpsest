from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from palimpsest.contracts import canonical_json_bytes, sha256_hex
from palimpsest.replay.harness import _verify_submissions
from palimpsest.solver.executor import stage_solver_inputs

AGENTS = ("agent-1", "agent-2", "agent-3")
RUN_ID = "run-frozen-release"


def _artifact(content: bytes, artifact_type: str) -> dict[str, Any]:
    return {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def _write_attempt(
    attempt: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, dict[str, bytes]]]:
    released_payloads: dict[str, dict[str, bytes]] = {}
    final_released_shards = []
    submissions = []
    for agent_number, agent_id in enumerate(AGENTS, start=1):
        chapter_indexes = [agent_number * 10, agent_number * 10 + 1]
        chapter_contents = {
            f"{chapter_index:03d}.txt": (f"{agent_id} frozen chapter {chapter_index}\n".encode())
            for chapter_index in chapter_indexes
        }
        manifest = {
            "schemaVersion": 1,
            "releaseOrdinal": 2,
            "chapterIndexes": chapter_indexes,
            "chapters": [
                _artifact(chapter_contents[f"{chapter_index:03d}.txt"], "cipher-chapter")
                for chapter_index in chapter_indexes
            ],
        }
        manifest_bytes = canonical_json_bytes(manifest)
        released = attempt / "agents" / agent_id / "input" / "released"
        released.mkdir(parents=True)
        (released / "release-manifest.json").write_bytes(manifest_bytes)
        for name, content in chapter_contents.items():
            (released / name).write_bytes(content)
        released_payloads[agent_id] = chapter_contents
        final_released_shards.append(
            {
                "agentId": agent_id,
                "manifest": _artifact(manifest_bytes, "released-shard-manifest"),
            }
        )

        private = attempt / "agents" / agent_id / "private-output"
        private.mkdir(parents=True)
        solver = b"#!/bin/sh\nexit 0\n"
        (private / "solver.sh").write_bytes(solver)
        submission = {
            "schemaVersion": 1,
            "contractId": "private-deliverable-manifest",
            "runId": RUN_ID,
            "agentId": agent_id,
            "freezeId": "freeze-frozen-release",
            "releasedShardDigest": sha256_hex(manifest_bytes),
            "outputs": [
                {
                    "path": "solver.sh",
                    "byteLength": len(solver),
                    "sha256": sha256_hex(solver),
                }
            ],
        }
        (private / "manifest.json").write_bytes(canonical_json_bytes(submission))
        submissions.append(submission)

    freeze = {
        "schemaVersion": 1,
        "contractId": "freeze-snapshot",
        "runId": RUN_ID,
        "freezeId": "freeze-frozen-release",
        "refMapDigest": "0" * 64,
        "gitBundle": {
            "artifactType": "git-bundle",
            "byteLength": 0,
            "sha256": "1" * 64,
        },
        "visibilityJournalDigest": "2" * 64,
        "ledgerDigest": "3" * 64,
        "finalEventSequence": 1,
        "eventChainHead": "4" * 64,
        "finalReleasedShards": final_released_shards,
    }
    (attempt / "git").mkdir(parents=True)
    (attempt / "git" / "freeze.json").write_bytes(canonical_json_bytes(freeze))
    (attempt / "submissions.json").write_bytes(canonical_json_bytes(submissions))
    return freeze, submissions, released_payloads


def _rewrite_submission(attempt: Path, submissions: list[dict[str, Any]], agent_id: str) -> None:
    submission = next(item for item in submissions if item["agentId"] == agent_id)
    (attempt / "agents" / agent_id / "private-output" / "manifest.json").write_bytes(
        canonical_json_bytes(submission)
    )
    (attempt / "submissions.json").write_bytes(canonical_json_bytes(submissions))


def test_stages_each_agent_own_frozen_released_shard(tmp_path: Path) -> None:
    attempt = tmp_path / "attempt"
    _, _, expected = _write_attempt(attempt)

    roots = stage_solver_inputs(RUN_ID, attempt)

    assert set(roots) == set(AGENTS)
    for agent_id, root in roots.items():
        released = root / "released"
        manifest = json.loads((released / "release-manifest.json").read_text(encoding="utf-8"))
        assert sorted(path.name for path in released.glob("*.txt")) == sorted(expected[agent_id])
        assert {path.name: path.read_bytes() for path in released.glob("*.txt")} == expected[
            agent_id
        ]
        assert manifest["chapterIndexes"] == [
            int(name.removesuffix(".txt")) for name in sorted(expected[agent_id])
        ]
        for peer_id in set(AGENTS) - {agent_id}:
            assert all(peer_id.encode() not in content for content in expected[agent_id].values())


def test_grading_and_replay_reject_submission_release_binding_drift(tmp_path: Path) -> None:
    attempt = tmp_path / "attempt"
    freeze, submissions, _ = _write_attempt(attempt)
    submissions[0]["releasedShardDigest"] = "f" * 64
    _rewrite_submission(attempt, submissions, "agent-1")

    with pytest.raises(ValueError, match="released-shard binding mismatch"):
        stage_solver_inputs(RUN_ID, attempt)
    with pytest.raises(ValueError, match="released-shard binding mismatch"):
        _verify_submissions(attempt, submissions, RUN_ID, freeze)

    assert not (attempt / "grading").exists()


def test_rejects_tampered_released_chapter_before_staging(tmp_path: Path) -> None:
    attempt = tmp_path / "attempt"
    _write_attempt(attempt)
    (attempt / "agents" / "agent-2" / "input" / "released" / "020.txt").write_text(
        "tampered\n", encoding="utf-8"
    )

    with pytest.raises(ValueError, match="chapter evidence mismatch"):
        stage_solver_inputs(RUN_ID, attempt)

    assert not (attempt / "grading").exists()
