from __future__ import annotations

from dataclasses import dataclass

from .config import AGENT_IDS


@dataclass(frozen=True)
class AgentShard:
    agent_id: str
    chapter_indexes: tuple[int, ...]
    cipher_chapters: tuple[str, ...]


def build_three_shards(
    chapter_indexes: tuple[int, ...],
    cipher_chapters: tuple[str, ...],
) -> tuple[AgentShard, ...]:
    if len(chapter_indexes) != len(cipher_chapters) or len(chapter_indexes) % 3 != 0:
        raise ValueError("Chapter-aligned cipher text must divide evenly across three agents.")
    width = len(chapter_indexes) // 3
    shards = tuple(
        AgentShard(
            agent_id=agent_id,
            chapter_indexes=chapter_indexes[index * width : (index + 1) * width],
            cipher_chapters=cipher_chapters[index * width : (index + 1) * width],
        )
        for index, agent_id in enumerate(AGENT_IDS)
    )
    flattened = tuple(chapter for shard in shards for chapter in shard.chapter_indexes)
    if flattened != chapter_indexes:
        raise RuntimeError("Shard assembly changed chapter order or coverage.")
    return shards
