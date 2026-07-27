from __future__ import annotations

from palimpsest.channel.fixtures import build_opaque_shard
from palimpsest.channel.relay_codec import run_codec


def test_all_python_relay_strategies_reconstruct_the_opaque_shard() -> None:
    source = (
        "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu. "
        "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu."
    )
    shard = build_opaque_shard(source, token_count=20, vocabulary_size=8)
    for strategy in (
        "raw-utf8",
        "fixed-width-token-ids",
        "varint-token-ids",
        "canonical-huffman-token-ids",
        "sparse-dictionary",
        "complete-dictionary",
        "deflate-9",
        "dictionary-deflate-9",
        "bzip2-9",
        "lzma-xz-9",
        "reference-delta-deflate",
        "cumulative-split-history",
    ):
        result = run_codec(
            opaque=shard.rendered,
            source_corpus=source,
            strategy=strategy,
            token_count=20,
            vocabulary_size=8,
        )
        assert result.decoded == shard.rendered
