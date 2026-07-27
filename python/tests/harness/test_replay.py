from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest
from palimpsest.contracts import canonical_json_bytes, sha256_hex
from palimpsest.replay.harness import (
    _verify_events,
    _verify_git_bundle,
    _verify_ledgers,
    _verify_solver_executions,
    _verify_submissions,
)

ROOT = Path(__file__).resolve().parents[3]
ATTEMPT = (
    ROOT
    / "artifacts/harness/attempts"
    / "a06415240ffd63cdcad45fc1886b7a8989ad4c312b6827d54f5eae6ec62f654d"
    / "container-001"
)
pytestmark = pytest.mark.skipif(
    not ATTEMPT.is_dir(),
    reason="the immutable replay attempt is runtime evidence and is intentionally excluded from Git",
)


def test_reconstructs_event_freeze_git_ledger_and_submission_state() -> None:
    run_id = "container-001"
    events, head = _verify_events(ATTEMPT / "live.jsonl", run_id)
    freeze = json.loads((ATTEMPT / "git/freeze.json").read_text(encoding="utf-8"))
    assert events[freeze["finalEventSequence"] - 1]["digest"] == freeze["eventChainHead"]
    assert head == events[-1]["digest"]

    _verify_git_bundle(ATTEMPT / "git/frozen.bundle", freeze)
    ledgers = json.loads((ATTEMPT / "git/ledgers.json").read_text(encoding="utf-8"))
    _verify_ledgers(ledgers, freeze, run_id)
    submissions = json.loads((ATTEMPT / "submissions.json").read_text(encoding="utf-8"))
    _verify_submissions(ATTEMPT, submissions, run_id, freeze["freezeId"])


def test_rejects_event_and_cumulative_ledger_tampering(tmp_path: Path) -> None:
    events = (ATTEMPT / "live.jsonl").read_text(encoding="utf-8").splitlines()
    event = json.loads(events[0])
    event["payload"]["state"] = "TAMPERED"
    events[0] = canonical_json_bytes(event).decode()
    event_path = tmp_path / "live.jsonl"
    event_path.write_text("\n".join(events), encoding="utf-8")
    with pytest.raises(ValueError, match="digest mismatch"):
        _verify_events(event_path, "container-001")

    ledgers = json.loads((ATTEMPT / "git/ledgers.json").read_text(encoding="utf-8"))
    tampered = deepcopy(ledgers)
    tampered[0]["budgetAfter"] += 1
    freeze = json.loads((ATTEMPT / "git/freeze.json").read_text(encoding="utf-8"))
    freeze["ledgerDigest"] = sha256_hex(canonical_json_bytes(tampered))
    with pytest.raises(ValueError, match="budget transition"):
        _verify_ledgers(tampered, freeze, "container-001")


def test_rejects_solver_output_tampering(tmp_path: Path) -> None:
    attempt = tmp_path / "attempt"
    reconstruction = b"expected\n"
    executions = []
    for index in range(1, 4):
        output = attempt / f"grading/solver-output/agent-{index}"
        output.mkdir(parents=True)
        (output / "reconstruction.txt").write_bytes(reconstruction)
        executions.append(
            {
                "schemaVersion": 1,
                "contractId": "solver-execution",
                "runId": "run-1",
                "executionId": f"agent-{index}-clean-solver-001",
                "bundle": {
                    "artifactType": "solver-executable",
                    "byteLength": 1,
                    "sha256": "0" * 64,
                },
                "networkDisabled": True,
                "exitCode": 0,
                "outputs": [
                    {
                        "path": "reconstruction.txt",
                        "byteLength": len(reconstruction),
                        "sha256": sha256_hex(reconstruction),
                    }
                ],
                "targetByteMatch": False,
            }
        )
    (attempt / "grading/solver-output/agent-1/reconstruction.txt").write_text(
        "tampered\n", encoding="utf-8"
    )
    with pytest.raises(ValueError, match="exact output set"):
        _verify_solver_executions(attempt, executions, "run-1")
