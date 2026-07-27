from __future__ import annotations


def stationary_oracle_segmentation(
    mapping: dict[str, str],
    *,
    segment_count: int,
) -> dict[str, str]:
    if segment_count != 1:
        raise ValueError("Gate B stationary oracle control requires exactly one segment.")
    return dict(sorted(mapping.items()))
