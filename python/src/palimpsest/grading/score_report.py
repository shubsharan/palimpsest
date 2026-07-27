from __future__ import annotations

import argparse
import json
from difflib import SequenceMatcher
from pathlib import Path

from palimpsest.contracts import canonical_json_bytes


def _similarity(candidate: str, target: str) -> float:
    return SequenceMatcher(None, candidate, target, autojunk=False).ratio()


def score_attempt(run_id: str, attempt: Path, bundle: Path) -> dict[str, object]:
    target = (bundle / "sealed/prepared.txt").read_text(encoding="utf-8")
    reconstruction_scores = []
    switch_scores = []
    for agent_number in range(1, 4):
        agent_id = f"agent-{agent_number}"
        output = attempt / "grading" / "solver-output" / agent_id / "reconstruction.txt"
        candidate = output.read_text(encoding="utf-8") if output.is_file() else ""
        reconstruction_scores.append(_similarity(candidate, target))
        hypothesis = json.loads(
            (attempt / "agents" / agent_id / "private-output" / "hypothesis.json").read_text()
        )
        switch_scores.append(1.0 if hypothesis.get("switchDetected") is True else 0.0)
    reconstruction = sum(reconstruction_scores) / len(reconstruction_scores)
    switch = sum(switch_scores) / len(switch_scores)
    metrics = {
        "reconstruction": reconstruction,
        "entity": 0.0,
        "dictionary": 0.0,
        "changed": 0.0,
        "stable": 0.0,
        "switch": switch,
        "latency": 1.0,
        "collaboration": 1.0,
        "confidence": 0.5,
    }
    report = {
        "schemaVersion": 1,
        "contractId": "score-report",
        "runId": run_id,
        "policyId": "palimpsest-score-v1",
        "metrics": metrics,
    }
    (attempt / "grading" / "score-report.json").write_bytes(canonical_json_bytes(report))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--attempt", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    args = parser.parse_args()
    print(canonical_json_bytes(score_attempt(args.run_id, args.attempt, args.bundle)).decode())


if __name__ == "__main__":
    main()
