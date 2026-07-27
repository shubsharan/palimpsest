from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from palimpsest.generation.text import word_tokens


@dataclass(frozen=True)
class ReferenceStatistics:
    token_counts: dict[str, int]
    total_tokens: int


def reference_statistics(documents: list[str]) -> ReferenceStatistics:
    counts: Counter[str] = Counter()
    for document in documents:
        counts.update(token.normalized for token in word_tokens(document))
    return ReferenceStatistics(
        token_counts=dict(sorted(counts.items())), total_tokens=sum(counts.values())
    )
