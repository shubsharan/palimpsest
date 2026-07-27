from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex, validate_value
from palimpsest.generation.text import word_tokens
from palimpsest.grading.reconstruction import FUNCTION_WORDS

from .artifacts import artifact_reference, write_canonical
from .config import GATE_B_INSTANCES
from .decision import classify_gate_b
from .pre_solve_canary import require_admitted_matrix

ROOT = Path(__file__).resolve().parents[4]
GATE_B_ROOT = ROOT / "artifacts" / "gate-b"


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _accuracy(matches: list[bool]) -> float:
    return sum(matches) / len(matches) if matches else 0.0


def _entity_types(instance_root: Path) -> set[str]:
    entity_map = _load(instance_root / "sealed" / "entity-map.json")
    return {
        token.normalized
        for entity in entity_map["entities"]
        for token in word_tokens(entity["replacement"])
        if token.normalized is not None
    }


def _designed_residual(
    strongest_rows: dict[str, dict[str, Any]],
) -> tuple[float, float, float]:
    function_matches: list[bool] = []
    rare_content_matches: list[bool] = []
    entity_matches: list[bool] = []
    for config in GATE_B_INSTANCES:
        row = strongest_rows[config.instance_id]
        rung = int(row["condition"].removeprefix("mechanical-rung-"))
        instance_root = GATE_B_ROOT / "instances" / config.instance_id
        truth_types = [
            token.normalized
            for token in word_tokens(
                (instance_root / "sealed" / "prepared.txt").read_text(encoding="utf-8")
            )
        ]
        predicted_types = [
            token.normalized
            for token in word_tokens(
                (
                    GATE_B_ROOT
                    / "attempts"
                    / "mechanical"
                    / config.instance_id
                    / f"rung-{rung}"
                    / "reconstruction.txt"
                ).read_text(encoding="utf-8")
            )
        ]
        if len(truth_types) != len(predicted_types):
            raise ValueError("Mechanical reconstruction token count changed during analysis.")
        counts = Counter(truth_types)
        ordered = sorted(counts, key=lambda word: (-counts[word], str(word)))
        rare_start = len(ordered) * 8 // 10
        rare_types = set(ordered[rare_start:])
        entity_types = _entity_types(instance_root)
        for truth, predicted in zip(truth_types, predicted_types, strict=True):
            assert truth is not None
            matched = truth == predicted
            if truth in entity_types:
                entity_matches.append(matched)
            elif truth in FUNCTION_WORDS:
                function_matches.append(matched)
            elif truth in rare_types:
                rare_content_matches.append(matched)
    return (
        _accuracy(function_matches),
        _accuracy(rare_content_matches),
        _accuracy(entity_matches),
    )


def build_analysis() -> tuple[dict[str, Any], dict[str, Any]]:
    require_admitted_matrix()
    score_path = GATE_B_ROOT / "raw" / "all-scores.json"
    score_table = _load(score_path)
    rows = score_table["rows"]
    strongest_rows: dict[str, dict[str, Any]] = {}
    agent: dict[str, list[float]] = {}
    human: dict[str, list[float]] = {}
    for config in GATE_B_INSTANCES:
        mechanical_rows = [
            row
            for row in rows
            if row["instanceId"] == config.instance_id
            and row["condition"].startswith("mechanical-rung-")
        ]
        if len(mechanical_rows) != 5:
            raise ValueError(f"{config.instance_id} does not have five mechanical rows.")
        strongest_rows[config.instance_id] = max(
            mechanical_rows,
            key=lambda row: (row["slices"]["weightedTokenAccuracy"], row["rowId"]),
        )
        for destination, condition in (
            (agent, "frontier-agent-tools"),
            (human, "human-tools"),
        ):
            capable_rows = sorted(
                (
                    row
                    for row in rows
                    if row["instanceId"] == config.instance_id
                    and row["condition"].startswith(f"{condition}-checkpoint-")
                ),
                key=lambda row: row["condition"],
            )
            if len(capable_rows) != 3:
                raise ValueError(
                    f"{config.instance_id}/{condition} does not have three score rows."
                )
            destination[config.instance_id] = [
                row["slices"]["weightedTokenAccuracy"] for row in capable_rows
            ]
    audit_summary = _load(GATE_B_ROOT / "raw" / "entity-audit-summary.json")
    audits = {record["instanceId"]: record for record in audit_summary["metrics"]}
    recognition: dict[str, bool] = {}
    for config in GATE_B_INSTANCES:
        attempts = [
            _load(path)
            for path in sorted(
                (GATE_B_ROOT / "attempts" / "identification" / config.instance_id).glob(
                    "*/attempt.json"
                )
            )
        ]
        if len(attempts) != 4:
            raise ValueError(f"{config.instance_id} does not have four identification tracks.")
        recognition[config.instance_id] = any(
            attempt["exactAlignedSource"] or attempt["copiedReconstruction"] for attempt in attempts
        )
    function_accuracy, rare_content_accuracy, entity_accuracy = _designed_residual(strongest_rows)
    mechanical = {
        instance_id: row["slices"]["weightedTokenAccuracy"]
        for instance_id, row in strongest_rows.items()
    }
    decision = classify_gate_b(
        mechanical=mechanical,
        agent=agent,
        human=human,
        audits=audits,
        recognition=recognition,
        function_accuracy=function_accuracy,
        rare_content_accuracy=rare_content_accuracy,
        entity_accuracy=entity_accuracy,
    )
    verdict = validate_value("gate-b-decision-analysis", decision)
    if not verdict.accepted:
        raise ValueError(f"decision rejected: {verdict.reason} at {verdict.pointer}")
    decision_bytes = canonical_json_bytes(decision)
    summary = {
        "schemaVersion": 1,
        "mechanical": mechanical,
        "strongestMechanicalRows": {
            instance_id: row["rowId"] for instance_id, row in strongest_rows.items()
        },
        "agentTrajectories": agent,
        "humanTrajectories": human,
        "recognition": recognition,
        "designedResidualMetrics": {
            "functionAccuracy": function_accuracy,
            "rareContentAccuracy": rare_content_accuracy,
            "entityAccuracy": entity_accuracy,
        },
        "scoreTable": artifact_reference(score_path, "gate-b-score-table"),
        "decisionAnalysis": {
            "artifactType": "gate-b-decision-analysis",
            "byteLength": len(decision_bytes),
            "sha256": sha256_hex(decision_bytes),
        },
        "classification": decision["classification"],
    }
    return decision, summary


def produce_analysis() -> dict[str, Any]:
    decision, summary = build_analysis()
    write_canonical(GATE_B_ROOT / "raw" / "decision-analysis.json", decision)
    write_canonical(GATE_B_ROOT / "raw" / "analysis-summary.json", summary)
    return summary


def check_analysis() -> dict[str, Any]:
    decision, summary = build_analysis()
    expected = {
        GATE_B_ROOT / "raw" / "decision-analysis.json": canonical_json_bytes(decision),
        GATE_B_ROOT / "raw" / "analysis-summary.json": canonical_json_bytes(summary),
    }
    for path, content in expected.items():
        if path.read_bytes() != content:
            raise ValueError(f"Recomputed Gate B analysis differs from {path}.")
    return {
        "schemaVersion": 1,
        "classification": decision["classification"],
        "integrityFailureCount": len(decision["integrityFailures"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = check_analysis() if args.check else produce_analysis()
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
