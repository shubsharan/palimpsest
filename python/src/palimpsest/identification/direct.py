from __future__ import annotations

from typing import Any

from .retrieval import rank_candidates


def direct_identification(
    cipher_view: str,
    candidate_catalog: dict[str, str],
) -> list[dict[str, Any]]:
    return rank_candidates(cipher_view, candidate_catalog)
