from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex

from .artifacts import AttemptIdentity, resolve_terminal_attempt
from .decision import decide_gate_c
from .scoring import build_trajectory
from .validation import validate_solver_evidence

REPLAY_FILES = (
    "inputs/private-instance.json",
    "inputs/reveal-plan.json",
    "inputs/changed-entries.json",
    "inputs/matched-controls.json",
    "reveal-events.json",
    "checkpoints.json",
    "solver-completion.json",
    "trajectory.json",
    "decision.json",
)


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _verify_artifact(path: Path, reference: dict[str, Any]) -> None:
    content = path.read_bytes()
    if len(content) != reference["byteLength"]:
        raise ValueError(f"Artifact byte length mismatch: {path}.")
    if sha256_hex(content) != reference["sha256"]:
        raise ValueError(f"Artifact digest mismatch: {path}.")


def replay_attempt(
    *,
    attempts_root: Path,
    identity: AttemptIdentity,
) -> tuple[dict[str, Any], dict[str, Any]]:
    attempt, terminal = resolve_terminal_attempt(
        attempts_root=attempts_root,
        identity=identity,
    )
    if terminal.get("status") != "scored":
        raise ValueError("Only a scored terminal attempt can be replayed.")
    manifest = _load_json(attempt / "replay-inputs.json")
    if manifest.get("attemptId") != identity.attempt_id:
        raise ValueError("Replay manifest does not match the explicit attempt identity.")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != set(REPLAY_FILES):
        raise ValueError("Replay manifest must declare the exact replay artifact set.")
    for relative in REPLAY_FILES:
        _verify_artifact(attempt / relative, artifacts[relative])

    instance = _load_json(attempt / "inputs/private-instance.json")
    reveal_plan = _load_json(attempt / "inputs/reveal-plan.json")
    changed_entries = _load_json(attempt / "inputs/changed-entries.json")
    matched_controls = _load_json(attempt / "inputs/matched-controls.json")
    reveal_events = _load_json(attempt / "reveal-events.json")
    checkpoints = _load_json(attempt / "checkpoints.json")
    completion = _load_json(attempt / "solver-completion.json")
    reveal_times = validate_solver_evidence(
        identity=identity,
        instance=instance,
        plan=reveal_plan,
        events=reveal_events,
        checkpoints=checkpoints,
        completion=completion,
    )
    trajectory = build_trajectory(
        attempt_id=identity.attempt_id,
        checkpoints=checkpoints,
        changed_entries=changed_entries,
        matched_controls=matched_controls,
        contradiction_reveal_ordinal=reveal_plan["contradictionThreshold"]["firstRevealOrdinal"],
        switch_after_chapter=instance["switchAfterChapter"],
        reveal_times_ms=reveal_times,
    )
    contradiction_time = reveal_times[reveal_plan["contradictionThreshold"]["firstRevealOrdinal"]]
    decision = decide_gate_c(
        trajectory,
        final_reveal_time_ms=max(reveal_times.values()),
        contradiction_time_ms=contradiction_time,
    )
    recorded_trajectory = _load_json(attempt / "trajectory.json")
    recorded_decision = _load_json(attempt / "decision.json")
    if canonical_json_bytes(trajectory) != canonical_json_bytes(recorded_trajectory):
        raise ValueError("Recorded revision trajectory does not match deterministic replay.")
    if canonical_json_bytes(decision) != canonical_json_bytes(recorded_decision):
        raise ValueError("Recorded Gate C decision does not match deterministic replay.")
    return trajectory, decision


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--declaration-digest", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument(
        "--attempts-root",
        type=Path,
        default=Path("artifacts/gate-c/attempts"),
    )
    args = parser.parse_args()
    identity = AttemptIdentity(args.declaration_digest, args.run_id)
    trajectory, decision = replay_attempt(
        attempts_root=args.attempts_root,
        identity=identity,
    )
    print(
        json.dumps(
            {
                "attemptId": identity.attempt_id,
                "classification": decision["classification"],
                "checkpointCount": len(trajectory["checkpointScores"]),
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
