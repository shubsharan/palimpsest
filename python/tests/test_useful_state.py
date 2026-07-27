from __future__ import annotations

import hashlib
from itertools import pairwise

from palimpsest.channel.useful_state import (
    build_useful_state_checkpoints,
    canonical_bytes,
    decode_useful_state,
    encode_useful_state,
)


def test_useful_state_has_four_cumulative_faithful_checkpoints() -> None:
    checkpoints = build_useful_state_checkpoints()
    assert len(checkpoints) == 4
    assert [len(checkpoint["mappingHypotheses"]) for checkpoint in checkpoints] == [
        128,
        256,
        384,
        512,
    ]
    assert [len(checkpoint["contradictions"]) for checkpoint in checkpoints] == [
        16,
        32,
        48,
        64,
    ]
    for previous, current in pairwise(checkpoints):
        assert (
            current["previousCheckpointSha256"]
            == hashlib.sha256(canonical_bytes(previous)).hexdigest()
        )


def test_useful_state_encodings_preserve_exact_semantics() -> None:
    for checkpoint in build_useful_state_checkpoints():
        for strategy in ("canonical-json", "deflate-9", "field-table-deflate-9"):
            encoded = encode_useful_state(checkpoint, strategy)
            assert decode_useful_state(encoded, strategy) == checkpoint
