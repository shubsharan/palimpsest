from __future__ import annotations

import bz2
import hashlib
import lzma
import struct
import zlib

REFERENCE_DELTA_MAGIC = b"PRD1"


def compress_deflate(payload: bytes) -> bytes:
    return zlib.compress(payload, level=9)


def decompress_deflate(payload: bytes) -> bytes:
    return zlib.decompress(payload)


def compress_dictionary_deflate(payload: bytes, dictionary: bytes) -> bytes:
    compressor = zlib.compressobj(level=9, wbits=zlib.MAX_WBITS, zdict=dictionary[-32768:])
    return compressor.compress(payload) + compressor.flush()


def decompress_dictionary_deflate(payload: bytes, dictionary: bytes) -> bytes:
    decompressor = zlib.decompressobj(wbits=zlib.MAX_WBITS, zdict=dictionary[-32768:])
    return decompressor.decompress(payload) + decompressor.flush()


def compress_bzip2(payload: bytes) -> bytes:
    return bz2.compress(payload, compresslevel=9)


def decompress_bzip2(payload: bytes) -> bytes:
    return bz2.decompress(payload)


def compress_lzma(payload: bytes) -> bytes:
    return lzma.compress(payload, format=lzma.FORMAT_XZ, preset=9)


def decompress_lzma(payload: bytes) -> bytes:
    return lzma.decompress(payload, format=lzma.FORMAT_XZ)


def compress_reference_delta(payload: bytes, reference: bytes) -> bytes:
    prefix = 0
    shared_limit = min(len(payload), len(reference))
    while prefix < shared_limit and payload[prefix] == reference[prefix]:
        prefix += 1
    suffix = 0
    while (
        suffix < shared_limit - prefix
        and payload[len(payload) - suffix - 1] == reference[len(reference) - suffix - 1]
    ):
        suffix += 1
    middle = payload[prefix : len(payload) - suffix if suffix else len(payload)]
    envelope = (
        REFERENCE_DELTA_MAGIC
        + hashlib.sha256(reference).digest()
        + struct.pack(">QQQ", prefix, suffix, len(middle))
        + middle
    )
    return zlib.compress(envelope, level=9)


def decompress_reference_delta(payload: bytes, reference: bytes) -> bytes:
    envelope = zlib.decompress(payload)
    if len(envelope) < 60 or envelope[:4] != REFERENCE_DELTA_MAGIC:
        raise ValueError("Reference delta has invalid magic or header.")
    if envelope[4:36] != hashlib.sha256(reference).digest():
        raise ValueError("Reference delta names a different reference.")
    prefix, suffix, middle_length = struct.unpack(">QQQ", envelope[36:60])
    if prefix + suffix > len(reference) or len(envelope) != 60 + middle_length:
        raise ValueError("Reference delta boundaries are invalid.")
    return reference[:prefix] + envelope[60:] + (reference[-suffix:] if suffix else b"")
