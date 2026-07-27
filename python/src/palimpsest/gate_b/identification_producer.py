from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, validate_value
from palimpsest.corpus.sources import strip_gutenberg
from palimpsest.identification.canaries import cipher_view_canary, raw_generation_canary
from palimpsest.identification.direct import direct_identification
from palimpsest.identification.retrieval import rank_candidates

from .artifacts import artifact_reference, write_canonical, write_text
from .config import GATE_B_INSTANCES
from .pre_solve_canary import require_admitted_matrix

ROOT = Path(__file__).resolve().parents[4]
GATE_B_ROOT = ROOT / "artifacts" / "gate-b"
REFERENCE_PATH = ROOT / "artifacts" / "gate-a" / "inputs" / "sources" / "count-of-monte-cristo.txt"


def _validate(value: dict[str, Any]) -> None:
    verdict = validate_value("gate-b-identification-attempt", value)
    if not verdict.accepted:
        raise ValueError(
            "gate-b-identification-attempt rejected generated value: "
            f"{verdict.reason} at {verdict.pointer}"
        )


def _attempt(
    *,
    instance_id: str,
    track: str,
    inputs: list[dict[str, Any]],
    candidates: dict[str, Any],
    exact_aligned_source: bool = False,
    copied_reconstruction: bool = False,
) -> dict[str, Any]:
    root = GATE_B_ROOT / "attempts" / "identification" / instance_id / track
    candidates_ref = write_canonical(root / "candidates.json", candidates)
    attempt = {
        "schemaVersion": 1,
        "contractId": "gate-b-identification-attempt",
        "attemptId": f"{instance_id}-{track}",
        "instanceId": instance_id,
        "track": track,
        "inputs": inputs,
        "status": "no-identification",
        "candidates": candidates_ref,
        "exactAlignedSource": exact_aligned_source,
        "copiedReconstruction": copied_reconstruction,
    }
    _validate(attempt)
    write_canonical(root / "attempt.json", attempt)
    return attempt


def produce_identification_attempts() -> dict[str, Any]:
    require_admitted_matrix()
    reference = strip_gutenberg(REFERENCE_PATH.read_text(encoding="utf-8"))
    catalog = {"count-of-monte-cristo": reference}
    attempts = []
    for config in GATE_B_INSTANCES:
        instance_root = GATE_B_ROOT / "instances" / config.instance_id
        cipher_path = instance_root / "public" / "cipher.txt"
        prepared_path = instance_root / "sealed" / "prepared.txt"
        cipher = cipher_path.read_text(encoding="utf-8")
        prepared = prepared_path.read_text(encoding="utf-8")
        public_inputs = [
            artifact_reference(cipher_path, "cipher-view"),
            artifact_reference(REFERENCE_PATH, "target-excluded-reference-corpus"),
        ]
        attempts.append(
            _attempt(
                instance_id=config.instance_id,
                track="cipher-view-canary",
                inputs=[public_inputs[0]],
                candidates=cipher_view_canary(cipher),
            )
        )
        raw_canary_root = GATE_B_ROOT / "inputs" / "raw-canaries" / config.instance_id
        raw_excerpt_ref = write_text(
            raw_canary_root / "excerpt.txt",
            prepared[:2_000],
            "sealed-raw-canary-excerpt",
        )
        raw_result = write_canonical(
            raw_canary_root / "result.json",
            raw_generation_canary(prepared),
        )
        attempts.append(
            _attempt(
                instance_id=config.instance_id,
                track="raw-generation-canary",
                inputs=[raw_excerpt_ref],
                candidates={
                    "claims": [],
                    "result": raw_result,
                    "status": "valid-no-identification",
                },
            )
        )
        attempts.append(
            _attempt(
                instance_id=config.instance_id,
                track="direct-identification",
                inputs=public_inputs,
                candidates={"ranked": direct_identification(cipher, catalog)},
            )
        )
        attempts.append(
            _attempt(
                instance_id=config.instance_id,
                track="retrieval-alignment",
                inputs=public_inputs,
                candidates={"ranked": rank_candidates(cipher, catalog)},
            )
        )
    result = {
        "schemaVersion": 1,
        "attemptCount": len(attempts),
        "exactAlignedSourceCount": sum(attempt["exactAlignedSource"] for attempt in attempts),
        "copiedReconstructionCount": sum(attempt["copiedReconstruction"] for attempt in attempts),
    }
    write_canonical(GATE_B_ROOT / "raw" / "identification-summary.json", result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if not args.all:
        parser.error("--all is required")
    print(canonical_json_bytes(produce_identification_attempts()).decode())


if __name__ == "__main__":
    main()
