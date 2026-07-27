from __future__ import annotations

import json
from pathlib import Path

import pytest
from palimpsest.contracts import sha256_hex
from palimpsest.gate_c.artifacts import (
    AttemptIdentity,
    create_attempt,
    finalize_attempt,
    write_canonical,
)
from palimpsest.gate_c.decision import decide_gate_c
from palimpsest.gate_c.replay import REPLAY_FILES, replay_attempt
from palimpsest.gate_c.scoring import build_trajectory

ATTEMPT = AttemptIdentity("a" * 64, "run-1")


def mapping(cipher: str, plain: str) -> dict[str, object]:
    return {
        "cipherType": cipher,
        "plainType": plain,
        "confidence": 0.9,
        "status": "active",
        "supportingRevealOrdinals": [1],
        "rationale": "fixture",
    }


def checkpoint(
    ordinal: int,
    reveal: int,
    time_ms: int,
    mappings: list[dict[str, object]],
    switch: bool = False,
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "contractId": "solver-checkpoint",
        "attemptId": ATTEMPT.attempt_id,
        "ordinal": ordinal,
        "revealOrdinal": reveal,
        "observedMonotonicMs": time_ms,
        "responseId": f"resp_{ordinal}",
        "previousResponseId": f"resp_{ordinal - 1}" if ordinal > 1 else None,
        "containerId": "cntr_1",
        "mappings": mappings,
        "switchHypotheses": (
            [{"afterChapter": 12, "confidence": 0.9, "evidence": "localized"}] if switch else []
        ),
        "reconstructionRefs": [],
        "usage": {"inputTokens": 1, "outputTokens": 1, "toolCalls": 1},
    }


def artifact(path: Path) -> dict[str, object]:
    content = path.read_bytes()
    return {"byteLength": len(content), "sha256": sha256_hex(content)}


def build_attempt(tmp_path: Path) -> tuple[Path, Path]:
    attempts_root = tmp_path / "attempts"
    attempt = create_attempt(
        attempts_root=attempts_root,
        current_path=tmp_path / "current.json",
        identity=ATTEMPT,
        started_at="2026-07-26T00:00:00Z",
    )
    fixture_root = Path(__file__).resolve().parents[3] / "artifacts/gate-c/calibration"
    for name in (
        "private-instance.json",
        "reveal-plan.json",
    ):
        write_canonical(
            attempt / "inputs" / name,
            json.loads((fixture_root / name).read_text(encoding="utf-8")),
        )
    changed = [
        {
            "plainType": "plain",
            "priorCipherType": "old",
            "revisedCipherType": "new",
        }
    ]
    controls = [{"plainType": "stable", "cipherType": "stable-cipher"}]
    write_canonical(attempt / "inputs/changed-entries.json", changed)
    write_canonical(attempt / "inputs/matched-controls.json", controls)
    prior = [mapping("old", "plain"), mapping("stable-cipher", "stable")]
    revised = [mapping("new", "plain"), mapping("stable-cipher", "stable")]
    checkpoints = [
        checkpoint(1, 1, 0, []),
        checkpoint(2, 2, 120_000, prior),
        checkpoint(3, 3, 240_000, prior),
        checkpoint(4, 4, 360_000, prior),
        checkpoint(5, 5, 480_000, revised, True),
        checkpoint(6, 6, 600_000, revised),
    ]
    reveal_plan = json.loads((attempt / "inputs/reveal-plan.json").read_text(encoding="utf-8"))
    events = [
        {
            "schemaVersion": 1,
            "contractId": "reveal-event",
            "attemptId": ATTEMPT.attempt_id,
            "ordinal": slot["ordinal"],
            "chapterIndex": slot["chapterIndex"],
            "plannedOffsetMs": slot["plannedOffsetMs"],
            "observedOffsetMs": slot["plannedOffsetMs"],
            "chapterArtifact": slot["cipherChapterArtifact"],
        }
        for slot in reveal_plan["slots"]
    ]
    write_canonical(attempt / "checkpoints.json", checkpoints)
    write_canonical(attempt / "reveal-events.json", events)
    write_canonical(
        attempt / "solver-completion.json",
        {
            "schemaVersion": 1,
            "attemptId": ATTEMPT.attempt_id,
            "status": "solver-completed",
            "model": "gpt-5.6-sol",
            "containerId": "cntr_1",
            "responseChain": [item["responseId"] for item in checkpoints],
            "checkpointCount": len(checkpoints),
        },
    )
    trajectory = build_trajectory(
        attempt_id=ATTEMPT.attempt_id,
        checkpoints=checkpoints,
        changed_entries=changed,
        matched_controls=controls,
        contradiction_reveal_ordinal=4,
        switch_after_chapter=12,
        reveal_times_ms={event["ordinal"]: event["observedOffsetMs"] for event in events},
    )
    decision = decide_gate_c(
        trajectory,
        final_reveal_time_ms=600_000,
        contradiction_time_ms=360_000,
    )
    write_canonical(attempt / "trajectory.json", trajectory)
    write_canonical(attempt / "decision.json", decision)
    write_canonical(
        attempt / "replay-inputs.json",
        {
            "schemaVersion": 1,
            "attemptId": ATTEMPT.attempt_id,
            "artifacts": {relative: artifact(attempt / relative) for relative in REPLAY_FILES},
        },
    )
    finalize_attempt(
        path=attempt,
        identity=ATTEMPT,
        status="scored",
        terminal_fields={
            "classification": decision["classification"],
            "model": "gpt-5.6-sol",
            "environment": {"fixture": True},
            "containerId": "cntr_1",
            "responseChain": [item["responseId"] for item in checkpoints],
        },
    )
    return attempts_root, attempt


def test_replay_recomputes_the_exact_trajectory_and_decision(tmp_path: Path) -> None:
    attempts_root, _ = build_attempt(tmp_path)
    trajectory, decision = replay_attempt(attempts_root=attempts_root, identity=ATTEMPT)
    assert trajectory["localizedDropPp"] == 100
    assert decision["classification"] == "pass"


def test_replay_rejects_tampered_evidence(tmp_path: Path) -> None:
    attempts_root, attempt = build_attempt(tmp_path)
    checkpoints = json.loads((attempt / "checkpoints.json").read_text(encoding="utf-8"))
    checkpoints[-1]["mappings"] = []
    (attempt / "checkpoints.json").write_text(json.dumps(checkpoints), encoding="utf-8")
    with pytest.raises(ValueError, match="match"):
        replay_attempt(attempts_root=attempts_root, identity=ATTEMPT)


def test_replay_ignores_the_mutable_current_pointer(tmp_path: Path) -> None:
    attempts_root, _ = build_attempt(tmp_path)
    (tmp_path / "current.json").write_text("{}", encoding="utf-8")
    _, decision = replay_attempt(attempts_root=attempts_root, identity=ATTEMPT)
    assert decision["classification"] == "pass"
