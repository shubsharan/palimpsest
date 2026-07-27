from __future__ import annotations

from palimpsest.baselines.oracle_segmentation import stationary_oracle_segmentation


def test_stationary_oracle_segmentation_is_identity_control() -> None:
    mapping = {"cipher": "plain", "other": "word"}
    assert stationary_oracle_segmentation(mapping, segment_count=1) == mapping
