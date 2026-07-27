from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st
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


@given(st.lists(st.integers(min_value=0, max_value=8191), min_size=1, max_size=500))
def test_token_codecs_round_trip(values: list[int]) -> None:
    sequence = tuple(values)
    assert decode_varints(encode_varints(sequence), count=len(sequence)) == sequence
    assert (
        decode_fixed_width(
            encode_fixed_width(sequence, vocabulary_size=8192),
            count=len(sequence),
            vocabulary_size=8192,
        )
        == sequence
    )
    assert decode_huffman(encode_huffman(sequence)) == sequence


@given(st.binary(min_size=0, max_size=4096), st.binary(min_size=1, max_size=4096))
def test_standard_compressors_round_trip(payload: bytes, dictionary: bytes) -> None:
    assert decompress_deflate(compress_deflate(payload)) == payload
    assert decompress_bzip2(compress_bzip2(payload)) == payload
    assert decompress_lzma(compress_lzma(payload)) == payload
    compressed = compress_dictionary_deflate(payload, dictionary)
    assert decompress_dictionary_deflate(compressed, dictionary) == payload


@given(st.lists(st.integers(min_value=0, max_value=4095), min_size=1, max_size=256).map(tuple))
def test_dictionary_codecs_round_trip(values: tuple[int, ...]) -> None:
    assert decode_sparse_dictionary(encode_sparse_dictionary(values)) == values
    assert (
        decode_complete_dictionary(encode_complete_dictionary(values, vocabulary_size=4096))
        == values
    )


@given(st.binary(max_size=2048), st.binary(max_size=2048))
def test_reference_delta_round_trip(payload: bytes, reference: bytes) -> None:
    assert (
        decompress_reference_delta(
            compress_reference_delta(payload, reference),
            reference,
        )
        == payload
    )
