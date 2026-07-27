from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex, validate_value


def _artifact(path: Path, artifact_type: str) -> dict[str, Any]:
    content = path.read_bytes()
    return {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def _verify_events(path: Path) -> str:
    previous = None
    effects: set[str] = set()
    for sequence, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        event = json.loads(line)
        if (
            event["sequence"] != sequence
            or event["previousDigest"] != previous
            or event["effectId"] in effects
        ):
            raise ValueError("Run event order, predecessor, or effect ID is invalid.")
        digest = event.pop("digest")
        if sha256_hex(canonical_json_bytes(event)) != digest:
            raise ValueError("Run event digest mismatch.")
        event["digest"] = digest
        previous = digest
        effects.add(event["effectId"])
    if previous is None:
        raise ValueError("Run event stream is empty.")
    return previous


def replay_attempt(run_id: str, attempt: Path) -> dict[str, Any]:
    event_head = _verify_events(attempt / "live.jsonl")
    freeze_path = attempt / "git/freeze.json"
    freeze = json.loads(freeze_path.read_text())
    verdict = validate_value("freeze-snapshot", freeze)
    if not verdict.accepted:
        raise ValueError(f"Freeze snapshot is invalid: {verdict}")
    subprocess.run(
        ["git", "bundle", "verify", str(attempt / "git/frozen.bundle")],
        check=True,
        capture_output=True,
    )
    artifacts = [
        _artifact(attempt / "run-manifest.json", "run-manifest"),
        _artifact(attempt / "git/ledgers.json", "git-ledgers"),
        _artifact(freeze_path, "freeze-snapshot"),
        _artifact(attempt / "submissions.json", "private-submissions"),
        _artifact(attempt / "grading/solver-executions.json", "solver-executions"),
        _artifact(attempt / "grading/score-report.json", "score-report"),
    ]
    replay = {
        "schemaVersion": 1,
        "contractId": "trusted-replay-bundle",
        "runId": run_id,
        "freezeId": freeze["freezeId"],
        "artifacts": artifacts,
    }
    replay_path = attempt / "replay/trusted-replay.json"
    replay_path.parent.mkdir(parents=True, exist_ok=True)
    replay_path.write_bytes(canonical_json_bytes(replay))
    verdict_record = {
        "schemaVersion": 1,
        "runId": run_id,
        "eventChainHead": event_head,
        "freezeId": freeze["freezeId"],
        "replayDigest": sha256_hex(canonical_json_bytes(replay)),
        "result": "pass",
    }
    (attempt / "replay/verdict.json").write_bytes(canonical_json_bytes(verdict_record))
    return verdict_record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--attempt", type=Path, required=True)
    args = parser.parse_args()
    replay = replay_attempt(args.run_id, args.attempt)
    from .public_report import build_public_report

    public = build_public_report(args.run_id, args.attempt)
    print(canonical_json_bytes({"replay": replay, "public": public}).decode())


if __name__ == "__main__":
    main()
