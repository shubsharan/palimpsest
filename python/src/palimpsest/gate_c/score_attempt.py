from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from palimpsest.contracts import sha256_hex, validate_value

from .artifacts import (
    AttemptIdentity,
    finalize_attempt,
    resolve_attempt,
    write_canonical,
    write_current_pointer,
)
from .decision import decide_gate_c
from .replay import REPLAY_FILES
from .scoring import build_trajectory
from .validation import validate_solver_evidence


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _artifact(path: Path) -> dict[str, Any]:
    content = path.read_bytes()
    return {"byteLength": len(content), "sha256": sha256_hex(content)}


def score_attempt(*, attempts_root: Path, identity: AttemptIdentity) -> dict[str, Any]:
    attempt = resolve_attempt(attempts_root=attempts_root, identity=identity)
    if (attempt / "terminal.json").exists():
        raise FileExistsError("A terminal attempt cannot be rescored.")
    manifest = _load(attempt / "attempt.json")
    completion = _load(attempt / "solver-completion.json")
    if (
        manifest.get("phase") != "running"
        or completion.get("status") != "solver-completed"
        or completion.get("attemptId") != identity.attempt_id
        or completion.get("model") != manifest.get("model")
    ):
        raise ValueError("Only an exact solver-completed attempt can be scored.")
    instance = _load(attempt / "inputs/private-instance.json")
    plan = _load(attempt / "inputs/reveal-plan.json")
    changed = _load(attempt / "inputs/changed-entries.json")
    controls = _load(attempt / "inputs/matched-controls.json")
    events = _load(attempt / "reveal-events.json")
    checkpoints = _load(attempt / "checkpoints.json")
    reveal_times = validate_solver_evidence(
        identity=identity,
        instance=instance,
        plan=plan,
        events=events,
        checkpoints=checkpoints,
        completion=completion,
    )
    trajectory = build_trajectory(
        attempt_id=identity.attempt_id,
        checkpoints=checkpoints,
        changed_entries=changed,
        matched_controls=controls,
        contradiction_reveal_ordinal=plan["contradictionThreshold"]["firstRevealOrdinal"],
        switch_after_chapter=instance["switchAfterChapter"],
        reveal_times_ms=reveal_times,
    )
    decision = decide_gate_c(
        trajectory,
        final_reveal_time_ms=max(reveal_times.values()),
        contradiction_time_ms=reveal_times[plan["contradictionThreshold"]["firstRevealOrdinal"]],
    )
    for contract_id, value in (
        ("revision-trajectory", trajectory),
        ("gate-c-decision", decision),
    ):
        verdict = validate_value(contract_id, value)
        if not verdict.accepted:
            raise ValueError(
                f"{contract_id} validation failed: {verdict.reason} at {verdict.pointer}."
            )
    write_canonical(attempt / "trajectory.json", trajectory)
    write_canonical(attempt / "decision.json", decision)
    write_canonical(
        attempt / "replay-inputs.json",
        {
            "schemaVersion": 1,
            "attemptId": identity.attempt_id,
            "artifacts": {relative: _artifact(attempt / relative) for relative in REPLAY_FILES},
        },
    )
    finalize_attempt(
        path=attempt,
        identity=identity,
        status="scored",
        terminal_fields={
            "classification": decision["classification"],
            "startedAt": manifest["startedAt"],
            "model": manifest["model"],
            "environment": manifest["environment"],
            "containerId": completion["containerId"],
            "responseChain": completion["responseChain"],
        },
    )
    write_current_pointer(
        attempts_root.parent / "current.json",
        identity=identity,
        path=attempt,
        started_at=manifest["startedAt"],
        status="scored",
    )
    return decision


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
    decision = score_attempt(
        attempts_root=args.attempts_root,
        identity=AttemptIdentity(args.declaration_digest, args.run_id),
    )
    print(json.dumps(decision, separators=(",", ":")))


if __name__ == "__main__":
    main()
