from __future__ import annotations

from palimpsest.channel.analysis import build_budget_sweep, exact_reconstruction


def test_exact_reconstruction_is_byte_exact() -> None:
    assert exact_reconstruction(b"shard", b"shard")
    assert not exact_reconstruction(b"shard", b"Shard")


def test_sweep_uses_useful_and_relay_margins_with_capacity_credit() -> None:
    sweep = build_budget_sweep(
        geometry_id="tokens-27000-vocab-8000",
        maximum_useful_charge=8192,
        minimum_relay_charge=24576,
        relay_capacity_credit_bytes=15,
    )
    points = sweep["points"]
    assert isinstance(points, list)
    assert len(points) == 61
    passing = [point for point in points if point["classification"] == "pass"]
    assert passing[0]["budgetBytes"] == 8192
    assert passing[-1]["budgetBytes"] == 23552
    intervals = sweep["passingIntervals"]
    assert isinstance(intervals, list)
    assert intervals == [
        {
            "minimumBudgetBytes": 8192,
            "maximumBudgetBytes": 23552,
            "pointCount": 16,
        }
    ]
