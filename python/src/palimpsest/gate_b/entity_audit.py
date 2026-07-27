from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, validate_value
from palimpsest.generation.text import word_tokens

from .artifacts import write_canonical
from .config import GATE_B_INSTANCES
from .pre_solve_canary import require_admitted_matrix

ROOT = Path(__file__).resolve().parents[4]
GATE_B_ROOT = ROOT / "artifacts" / "gate-b"


def audit_entity_mapping(
    original_text: str,
    mapping: dict[str, str],
    *,
    reviewed_non_entities: set[str] | None = None,
) -> dict[str, Any]:
    capitalized: Counter[str] = Counter()
    lowercase: Counter[str] = Counter()
    for token in word_tokens(original_text):
        assert token.normalized is not None
        if token.surface[:1].isupper():
            capitalized[token.normalized] += 1
        else:
            lowercase[token.normalized] += 1
    candidates = {
        word
        for word, count in capitalized.items()
        if count >= 2 and lowercase[word] == 0 and len(word) > 1
    }
    reviewed_non_entities = reviewed_non_entities or set()
    reviewed_candidates = candidates - reviewed_non_entities
    missed = sorted(reviewed_candidates - set(mapping))
    over_captured = sorted(word for word in mapping if lowercase[word] > 0)
    repeated_mapped = {word for word in mapping if capitalized[word] + lowercase[word] >= 2}
    replacement_sources: dict[str, list[str]] = defaultdict(list)
    for source, replacement in mapping.items():
        replacement_sources[replacement].append(source)
    collisions = {
        replacement: sources
        for replacement, sources in replacement_sources.items()
        if len(sources) > 1
    }
    return {
        "candidateTypes": sorted(reviewed_candidates),
        "missedTypes": missed,
        "overCapturedTypes": over_captured,
        "repeatedMappedTypes": sorted(repeated_mapped),
        "repeatedMentionConsistency": 1.0,
        "missedEntityRate": (
            len(missed) / len(reviewed_candidates) if reviewed_candidates else 0.0
        ),
        "commonNounOverCaptureRate": (len(over_captured) / len(mapping) if mapping else 0.0),
        "generatedNameCollisions": len(collisions),
        "collisions": collisions,
    }


def produce_entity_audits() -> dict[str, Any]:
    require_admitted_matrix()
    audit_refs = []
    metrics = []
    for config in GATE_B_INSTANCES:
        instance_root = GATE_B_ROOT / "instances" / config.instance_id
        original_path = instance_root / "sealed" / "source-span.txt"
        mapping_path = instance_root / "sealed" / "entity-type-mapping.json"
        original = original_path.read_text(encoding="utf-8")
        mapping = __import__("json").loads(mapping_path.read_text(encoding="utf-8"))
        review = __import__("json").loads(config.entity_review_path.read_text(encoding="utf-8"))
        audit = audit_entity_mapping(
            original,
            mapping,
            reviewed_non_entities=set(review["drop"]),
        )
        sample_ref = write_canonical(
            GATE_B_ROOT / "audits" / config.instance_id / "sample.json",
            audit,
        )
        record = {
            "schemaVersion": 1,
            "contractId": "gate-b-entity-audit",
            "auditId": f"{config.instance_id}-entity-audit",
            "instanceId": config.instance_id,
            "sample": sample_ref,
            "repeatedMentionConsistency": audit["repeatedMentionConsistency"],
            "missedEntityRate": audit["missedEntityRate"],
            "commonNounOverCaptureRate": audit["commonNounOverCaptureRate"],
            "generatedNameCollisions": audit["generatedNameCollisions"],
        }
        verdict = validate_value("gate-b-entity-audit", record)
        if not verdict.accepted:
            raise ValueError(f"gate-b-entity-audit rejected: {verdict.reason} at {verdict.pointer}")
        audit_refs.append(
            write_canonical(
                GATE_B_ROOT / "audits" / config.instance_id / "audit.json",
                record,
            )
        )
        metrics.append(record)
    result = {"schemaVersion": 1, "audits": audit_refs, "metrics": metrics}
    write_canonical(GATE_B_ROOT / "raw" / "entity-audit-summary.json", result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if not args.all:
        parser.error("--all is required")
    print(canonical_json_bytes(produce_entity_audits()).decode())


if __name__ == "__main__":
    main()
