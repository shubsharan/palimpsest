from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path

from palimpsest.channel.codecs import (
    decode_complete_dictionary,
    decode_fixed_width,
    decode_huffman,
    decode_sparse_dictionary,
    decode_varints,
    encode_complete_dictionary,
    encode_fixed_width,
    encode_huffman,
    encode_sparse_dictionary,
    encode_varints,
)
from palimpsest.channel.compressors import (
    compress_bzip2,
    compress_deflate,
    compress_dictionary_deflate,
    compress_lzma,
    compress_reference_delta,
    decompress_bzip2,
    decompress_deflate,
    decompress_dictionary_deflate,
    decompress_lzma,
    decompress_reference_delta,
)
from palimpsest.channel.fixtures import render_token_ids

OPAQUE_TOKEN = re.compile(rb"w([0-9a-f]+)")


@dataclass(frozen=True)
class CodecResult:
    accessed_inputs: tuple[str, ...]
    decoded: bytes
    encoded: bytes


def _token_ids(opaque: bytes, expected_count: int) -> tuple[int, ...]:
    token_ids = tuple(int(match.group(1), 16) for match in OPAQUE_TOKEN.finditer(opaque))
    if len(token_ids) != expected_count:
        raise ValueError(
            f"Opaque shard exposes {len(token_ids)} tokens, expected {expected_count}."
        )
    return token_ids


def run_codec(
    *,
    opaque: bytes,
    source_corpus: str,
    strategy: str,
    token_count: int,
    vocabulary_size: int,
) -> CodecResult:
    token_ids = _token_ids(opaque, token_count)
    source_bytes = source_corpus.encode()
    if strategy == "raw-utf8":
        encoded = opaque
        decoded = encoded
        accessed = ("opaque-shard",)
    elif strategy == "fixed-width-token-ids":
        encoded = encode_fixed_width(token_ids, vocabulary_size=vocabulary_size)
        decoded_ids = decode_fixed_width(
            encoded,
            count=token_count,
            vocabulary_size=vocabulary_size,
        )
        decoded = render_token_ids(
            source_corpus,
            decoded_ids,
            token_count=token_count,
            vocabulary_size=vocabulary_size,
        )
        accessed = ("opaque-shard", "shared-vocabulary-order", "source-corpus")
    elif strategy == "varint-token-ids":
        encoded = encode_varints(token_ids)
        decoded_ids = decode_varints(encoded, count=token_count)
        decoded = render_token_ids(
            source_corpus,
            decoded_ids,
            token_count=token_count,
            vocabulary_size=vocabulary_size,
        )
        accessed = ("opaque-shard", "shared-vocabulary-order", "source-corpus")
    elif strategy == "canonical-huffman-token-ids":
        encoded = encode_huffman(token_ids)
        decoded_ids = decode_huffman(encoded)
        decoded = render_token_ids(
            source_corpus,
            decoded_ids,
            token_count=token_count,
            vocabulary_size=vocabulary_size,
        )
        accessed = ("opaque-shard", "shared-vocabulary-order", "source-corpus")
    elif strategy == "sparse-dictionary":
        encoded = encode_sparse_dictionary(token_ids)
        decoded_ids = decode_sparse_dictionary(encoded)
        decoded = render_token_ids(
            source_corpus,
            decoded_ids,
            token_count=token_count,
            vocabulary_size=vocabulary_size,
        )
        accessed = ("opaque-shard", "shared-vocabulary-order", "source-corpus")
    elif strategy == "complete-dictionary":
        encoded = encode_complete_dictionary(
            token_ids,
            vocabulary_size=vocabulary_size,
        )
        decoded_ids = decode_complete_dictionary(encoded)
        decoded = render_token_ids(
            source_corpus,
            decoded_ids,
            token_count=token_count,
            vocabulary_size=vocabulary_size,
        )
        accessed = ("opaque-shard", "shared-vocabulary-order", "source-corpus")
    elif strategy == "deflate-9":
        encoded = compress_deflate(opaque)
        decoded = decompress_deflate(encoded)
        accessed = ("opaque-shard",)
    elif strategy == "dictionary-deflate-9":
        encoded = compress_dictionary_deflate(opaque, source_bytes)
        decoded = decompress_dictionary_deflate(encoded, source_bytes)
        accessed = ("opaque-shard", "source-corpus")
    elif strategy == "bzip2-9":
        encoded = compress_bzip2(opaque)
        decoded = decompress_bzip2(encoded)
        accessed = ("opaque-shard",)
    elif strategy == "lzma-xz-9":
        encoded = compress_lzma(opaque)
        decoded = decompress_lzma(encoded)
        accessed = ("opaque-shard",)
    elif strategy == "reference-delta-deflate":
        encoded = compress_reference_delta(opaque, source_bytes)
        decoded = decompress_reference_delta(encoded, source_bytes)
        accessed = ("opaque-shard", "source-corpus")
    elif strategy == "cumulative-split-history":
        encoded = compress_deflate(opaque)
        decoded = decompress_deflate(encoded)
        accessed = ("opaque-shard",)
    else:
        raise ValueError(f"Unsupported Python relay strategy: {strategy}.")
    return CodecResult(accessed, decoded, encoded)


def source_corpus(source_root: Path) -> str:
    source_ids = ("middlemarch", "moby-dick", "count-of-monte-cristo", "jane-eyre")
    return "\n\n".join(
        (source_root / f"{source_id}.txt").read_text(encoding="utf-8") for source_id in source_ids
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", required=True, type=Path)
    parser.add_argument("--opaque", required=True, type=Path)
    parser.add_argument("--sources", required=True, type=Path)
    parser.add_argument("--strategy", required=True)
    parser.add_argument("--encoded", required=True, type=Path)
    parser.add_argument("--result", required=True, type=Path)
    args = parser.parse_args()
    metadata = json.loads(args.metadata.read_text())
    opaque = args.opaque.read_bytes()
    result = run_codec(
        opaque=opaque,
        source_corpus=source_corpus(args.sources),
        strategy=args.strategy,
        token_count=metadata["tokenCount"],
        vocabulary_size=metadata["vocabularySize"],
    )
    args.encoded.write_bytes(result.encoded)
    args.result.write_text(
        json.dumps(
            {
                "accessedInputs": result.accessed_inputs,
                "decodedByteLength": len(result.decoded),
                "encodedByteLength": len(result.encoded),
                "exactReconstruction": result.decoded == opaque,
                "strategyId": args.strategy,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
