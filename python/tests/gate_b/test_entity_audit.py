from __future__ import annotations

from palimpsest.gate_b.entity_audit import audit_entity_mapping


def test_entity_audit_reports_consistency_misses_and_overcapture() -> None:
    original = (
        "Alice met Rowan. Alice thanked Rowan. "
        "Morning came. morning ended. Paris shone. Paris slept."
    )
    mapping = {"alice": "beatrice", "morning": "dawn"}
    audit = audit_entity_mapping(original, mapping)
    assert audit["repeatedMentionConsistency"] == 1
    assert audit["generatedNameCollisions"] == 0
    assert "paris" in audit["missedTypes"]
    assert "morning" in audit["overCapturedTypes"]
