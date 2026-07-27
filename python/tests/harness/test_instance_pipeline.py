from __future__ import annotations

from pathlib import Path

from palimpsest.instance_pipeline.instance import build_production_instance

ROOT = Path(__file__).resolve().parents[3]


def test_production_instance_is_deterministic_and_has_three_contiguous_shards() -> None:
    first = build_production_instance(ROOT)
    second = build_production_instance(ROOT)
    assert first == second
    assert len(first.shards) == 3
    assert tuple(chapter for shard in first.shards for chapter in shard.chapter_indexes) == tuple(
        range(10, 16)
    )
    assert all(len(shard.chapter_indexes) == 2 for shard in first.shards)
    assert first.difficulty["communicationBudgetBytes"] == 38_912
    assert first.difficulty["switchCount"] == 1


def test_agent_shards_are_pairwise_disjoint() -> None:
    instance = build_production_instance(ROOT)
    chapter_sets = [set(shard.chapter_indexes) for shard in instance.shards]
    assert all(
        not chapter_sets[left] & chapter_sets[right]
        for left in range(3)
        for right in range(left + 1, 3)
    )
