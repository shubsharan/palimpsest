from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from palimpsest.gate_c.config import END_CHAPTER, START_CHAPTER
from palimpsest.gate_c.instance import BuiltGateCInstance, build_gate_c_instance

from .shards import AgentShard, build_three_shards


@dataclass(frozen=True)
class ProductionInstance:
    source: BuiltGateCInstance
    shards: tuple[AgentShard, ...]
    chapter_indexes: tuple[int, ...]
    profile_id: str
    instance_id: str
    difficulty: dict[str, Any]
    scoring: dict[str, Any]


def build_production_instance(root: Path = Path(".")) -> ProductionInstance:
    source = build_gate_c_instance(root)
    chapter_indexes = tuple(range(START_CHAPTER, END_CHAPTER + 1))
    shards = build_three_shards(chapter_indexes, source.cipher_chapters)
    return ProductionInstance(
        source=source,
        shards=shards,
        chapter_indexes=chapter_indexes,
        profile_id="three-shard-partial-rekey-v1",
        instance_id="palimpsest-production-001",
        difficulty={
            "schemaVersion": 1,
            "contractId": "difficulty-config",
            "profileId": "three-shard-partial-rekey-v1",
            "communicationBudgetBytes": 65_536,
            "switchCount": 1,
        },
        scoring={
            "schemaVersion": 1,
            "contractId": "scoring-policy",
            "policyId": "palimpsest-score-v1",
            "metricIds": [
                "reconstruction",
                "entity",
                "dictionary",
                "changed",
                "stable",
                "switch",
                "collaboration",
            ],
        },
    )
