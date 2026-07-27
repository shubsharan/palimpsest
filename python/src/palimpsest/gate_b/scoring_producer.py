from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex, validate_value
from palimpsest.corpus.sources import strip_gutenberg
from palimpsest.generation.text import word_tokens
from palimpsest.grading.reconstruction import score_reconstruction

from .artifacts import write_canonical
from .config import GATE_B_INSTANCES
from .pre_solve_canary import require_admitted_matrix

ROOT = Path(__file__).resolve().parents[4]
GATE_B_ROOT = ROOT / "artifacts" / "gate-b"
REFERENCE_PATH = ROOT / "artifacts" / "gate-a" / "inputs" / "sources" / "count-of-monte-cristo.txt"


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _resolve(reference: dict[str, Any]) -> bytes:
    path = GATE_B_ROOT / "by-digest" / reference["sha256"]
    content = path.read_bytes()
    if len(content) != reference["byteLength"] or sha256_hex(content) != reference["sha256"]:
        raise ValueError(f"Digest-store mismatch for {reference['sha256']}.")
    return content


def _reference_counts() -> dict[str, int]:
    reference = strip_gutenberg(REFERENCE_PATH.read_text(encoding="utf-8"))
    counts: dict[str, int] = {}
    for token in word_tokens(reference):
        assert token.normalized is not None
        counts[token.normalized] = counts.get(token.normalized, 0) + 1
    return counts


def _entity_types(instance_root: Path) -> set[str]:
    entity_map = _load(instance_root / "sealed" / "entity-map.json")
    return {
        token.normalized
        for entity in entity_map["entities"]
        for token in word_tokens(entity["replacement"])
        if token.normalized is not None
    }


def _selected_agent_attempt(instance_id: str) -> Path:
    selection_path = GATE_B_ROOT / "attempts" / "agent" / instance_id / "selected.json"
    selection = _load(selection_path)
    predeclaration = _load(GATE_B_ROOT / "predeclaration.json")
    required = {
        "schemaVersion",
        "instanceId",
        "condition",
        "predeclarationDigest",
        "runId",
        "attemptId",
        "producerVersion",
        "terminalStatus",
        "attemptPath",
    }
    if set(selection) != required:
        raise ValueError(f"{selection_path} has missing or undeclared fields.")
    if (
        selection["schemaVersion"] != 2
        or selection["instanceId"] != instance_id
        or selection["condition"] != "frontier-agent-tools"
        or selection["terminalStatus"] != "completed"
        or selection["predeclarationDigest"] != predeclaration["predeclarationDigest"]
    ):
        raise ValueError(f"{selection_path} does not select a current completed agent attempt.")
    attempt_root = ROOT / selection["attemptPath"]
    expected = (
        GATE_B_ROOT
        / "attempts"
        / "agent"
        / instance_id
        / selection["predeclarationDigest"]
        / selection["runId"]
    )
    if attempt_root.resolve() != expected.resolve():
        raise ValueError(f"{selection_path} points outside its declared attempt directory.")
    manifest = _load(attempt_root / "manifest.json")
    for field in (
        "schemaVersion",
        "instanceId",
        "condition",
        "predeclarationDigest",
        "runId",
        "attemptId",
        "producerVersion",
        "terminalStatus",
    ):
        if manifest.get(field) != selection[field]:
            raise ValueError(f"Selected attempt manifest disagrees on {field}.")
    return attempt_root


def build_score_table() -> dict[str, Any]:
    require_admitted_matrix()
    mechanical = _load(GATE_B_ROOT / "raw" / "mechanical-scores.json")
    rows = list(mechanical["rows"])
    reference_counts = _reference_counts()
    for config in GATE_B_INSTANCES:
        instance_root = GATE_B_ROOT / "instances" / config.instance_id
        truth = (instance_root / "sealed" / "prepared.txt").read_text(encoding="utf-8")
        entity_types = _entity_types(instance_root)
        for condition_root, condition in (
            ("agent", "frontier-agent-tools"),
            ("human", "human-tools"),
        ):
            attempt_root = (
                _selected_agent_attempt(config.instance_id)
                if condition_root == "agent"
                else GATE_B_ROOT / "attempts" / condition_root / config.instance_id
            )
            manifest = _load(attempt_root / "manifest.json")
            if manifest.get("checkpointCount") != 3:
                raise ValueError(
                    f"{config.instance_id}/{condition} must contain exactly three checkpoints."
                )
            for sequence in range(3):
                checkpoint = _load(attempt_root / f"checkpoint-{sequence}.json")
                verdict = validate_value("gate-b-solver-checkpoint", checkpoint)
                if not verdict.accepted:
                    raise ValueError(f"checkpoint rejected: {verdict.reason} at {verdict.pointer}")
                if (
                    checkpoint["instanceId"] != config.instance_id
                    or checkpoint["condition"] != condition
                    or checkpoint["sequence"] != sequence
                ):
                    raise ValueError("Checkpoint identity does not match its attempt path.")
                reconstruction = _resolve(checkpoint["reconstruction"]).decode("utf-8")
                rows.append(
                    {
                        "rowId": f"{config.instance_id}-{condition}-{sequence}",
                        "instanceId": config.instance_id,
                        "condition": f"{condition}-checkpoint-{sequence}",
                        "slices": score_reconstruction(
                            truth,
                            reconstruction,
                            reference_counts=reference_counts,
                            entity_types=entity_types,
                        ),
                    }
                )
    table = {
        "schemaVersion": 1,
        "contractId": "gate-b-score-table",
        "scoringVersion": "1.0.0",
        "rows": rows,
    }
    verdict = validate_value("gate-b-score-table", table)
    if not verdict.accepted:
        raise ValueError(f"score table rejected: {verdict.reason} at {verdict.pointer}")
    return table


def produce_scores() -> dict[str, Any]:
    table = build_score_table()
    write_canonical(GATE_B_ROOT / "raw" / "all-scores.json", table)
    return table


def check_scores() -> dict[str, Any]:
    expected = canonical_json_bytes(build_score_table())
    recorded = (GATE_B_ROOT / "raw" / "all-scores.json").read_bytes()
    if expected != recorded:
        raise ValueError("Recomputed Gate B score table differs from recorded evidence.")
    return {"schemaVersion": 1, "rowCount": len(json.loads(recorded)["rows"])}


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = check_scores() if args.check else produce_scores()
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
