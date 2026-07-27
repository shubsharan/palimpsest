from __future__ import annotations

from pathlib import Path

from palimpsest.gate_c.instance import build_gate_c_instance

ROOT = Path(__file__).resolve().parents[3]


def test_gate_c_geometry_and_reveal_plan_are_frozen() -> None:
    first = build_gate_c_instance(ROOT)
    second = build_gate_c_instance(ROOT)
    assert first == second
    assert first.private_manifest["tokenCount"] == 27_504
    assert first.private_manifest["preSwitchTokenCount"] == 14_645
    assert first.private_manifest["postSwitchTokenCount"] == 12_859
    assert len(first.reveal_plan["slots"]) == 6
    assert first.reveal_plan["contradictionThreshold"]["firstRevealOrdinal"] in {4, 5, 6}


def test_public_projection_excludes_oracle_and_source_fields() -> None:
    public = build_gate_c_instance(ROOT).public_manifest
    assert set(public) == {
        "schemaVersion",
        "contractId",
        "instanceId",
        "profileId",
        "tokenCount",
        "revealSlotCount",
    }
