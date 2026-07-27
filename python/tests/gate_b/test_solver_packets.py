from __future__ import annotations

from palimpsest.gate_b.solver_packets import PUBLIC_PACKET_FIELDS


def test_solver_packet_allowlist_has_no_sealed_truth_fields() -> None:
    forbidden = {
        "sourceId",
        "sourceRecord",
        "preparedPlaintext",
        "encryptionKey",
        "recoveredMapping",
        "entityMap",
        "masterSeed",
        "oracle",
    }
    assert forbidden.isdisjoint(PUBLIC_PACKET_FIELDS)
