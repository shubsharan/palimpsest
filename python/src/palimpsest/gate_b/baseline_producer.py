from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from palimpsest.baselines.runner import run_ladder
from palimpsest.contracts import canonical_json_bytes, validate_value
from palimpsest.corpus.sources import strip_gutenberg
from palimpsest.generation.text import word_tokens
from palimpsest.grading.reconstruction import score_reconstruction

from .artifacts import artifact_reference, write_canonical, write_text
from .config import GATE_B_INSTANCES
from .pre_solve_canary import require_admitted_matrix

ROOT = Path(__file__).resolve().parents[4]
GATE_B_ROOT = ROOT / "artifacts" / "gate-b"
REFERENCE_PATH = ROOT / "artifacts" / "gate-a" / "inputs" / "sources" / "count-of-monte-cristo.txt"


def _validate(contract_id: str, value: dict[str, Any]) -> None:
    verdict = validate_value(contract_id, value)
    if not verdict.accepted:
        raise ValueError(
            f"{contract_id} rejected generated value: {verdict.reason} at {verdict.pointer}"
        )


def _entity_types(instance_root: Path) -> set[str]:
    entity_map = __import__("json").loads(
        (instance_root / "sealed" / "entity-map.json").read_text(encoding="utf-8")
    )
    return {
        token.normalized
        for entity in entity_map["entities"]
        for token in word_tokens(entity["replacement"])
        if token.normalized is not None
    }


def produce_baselines() -> dict[str, Any]:
    require_admitted_matrix()
    reference_text = strip_gutenberg(REFERENCE_PATH.read_text(encoding="utf-8"))
    reference_counts: dict[str, int] = {}
    for token in word_tokens(reference_text):
        if token.normalized is not None:
            reference_counts[token.normalized] = reference_counts.get(token.normalized, 0) + 1
    score_rows = []
    attempt_refs = []
    for config in GATE_B_INSTANCES:
        instance_root = GATE_B_ROOT / "instances" / config.instance_id
        cipher_path = instance_root / "public" / "cipher.txt"
        truth_path = instance_root / "sealed" / "prepared.txt"
        cipher_text = cipher_path.read_text(encoding="utf-8")
        truth = truth_path.read_text(encoding="utf-8")
        outputs = run_ladder(cipher_text, reference_text, seed_hex=config.seed_hex)
        parent_ref = None
        for output in outputs:
            attempt_root = (
                GATE_B_ROOT / "attempts" / "mechanical" / config.instance_id / f"rung-{output.rung}"
            )
            mapping_ref = write_canonical(attempt_root / "mapping.json", output.mapping)
            reconstruction_ref = write_text(
                attempt_root / "reconstruction.txt",
                output.reconstruction,
                "baseline-reconstruction",
            )
            diagnostics_ref = write_canonical(
                attempt_root / "diagnostics.json",
                output.diagnostics,
            )
            inputs = [
                artifact_reference(cipher_path, "cipher-view"),
                artifact_reference(REFERENCE_PATH, "target-excluded-reference-corpus"),
            ]
            if parent_ref is not None:
                inputs.append(parent_ref)
            attempt = {
                "schemaVersion": 1,
                "contractId": "gate-b-baseline-attempt",
                "attemptId": f"{config.instance_id}-rung-{output.rung}",
                "instanceId": config.instance_id,
                "rung": output.rung,
                "methodId": output.method_id,
                "inputs": inputs,
                "status": "success",
                "wallSeconds": output.wall_seconds,
                "outputs": [mapping_ref, reconstruction_ref],
                "diagnostics": diagnostics_ref,
            }
            _validate("gate-b-baseline-attempt", attempt)
            attempt_ref = write_canonical(attempt_root / "attempt.json", attempt)
            parent_ref = attempt_ref
            attempt_refs.append(attempt_ref)
            score_rows.append(
                {
                    "rowId": f"{config.instance_id}-rung-{output.rung}",
                    "instanceId": config.instance_id,
                    "condition": f"mechanical-rung-{output.rung}",
                    "slices": score_reconstruction(
                        truth,
                        output.reconstruction,
                        reference_counts=reference_counts,
                        entity_types=_entity_types(instance_root),
                    ),
                }
            )
    score_table = {
        "schemaVersion": 1,
        "contractId": "gate-b-score-table",
        "scoringVersion": "1.0.0",
        "rows": score_rows,
    }
    _validate("gate-b-score-table", score_table)
    score_ref = write_canonical(GATE_B_ROOT / "raw" / "mechanical-scores.json", score_table)
    result = {
        "schemaVersion": 1,
        "attemptCount": len(attempt_refs),
        "attempts": attempt_refs,
        "scoreTable": score_ref,
    }
    write_canonical(GATE_B_ROOT / "raw" / "baseline-summary.json", result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if not args.all:
        parser.error("--all is required")
    print(canonical_json_bytes(produce_baselines()).decode())


if __name__ == "__main__":
    main()
