from __future__ import annotations

import heapq
import struct
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass

HUFFMAN_MAGIC = b"PHF1"
SPARSE_MAGIC = b"PSP1"
COMPLETE_MAGIC = b"PCD1"


def encode_varints(values: Iterable[int]) -> bytes:
    output = bytearray()
    for value in values:
        if value < 0:
            raise ValueError("Varints encode only nonnegative integers.")
        remaining = value
        while True:
            byte = remaining & 0x7F
            remaining >>= 7
            output.append(byte | (0x80 if remaining else 0))
            if not remaining:
                break
    return bytes(output)


def decode_varints(payload: bytes, *, count: int) -> tuple[int, ...]:
    values: list[int] = []
    value = 0
    shift = 0
    for index, byte in enumerate(payload):
        value |= (byte & 0x7F) << shift
        if byte & 0x80:
            shift += 7
            if shift > 63:
                raise ValueError("Varint exceeds 64 bits.")
            continue
        values.append(value)
        value = 0
        shift = 0
        if len(values) == count:
            if index != len(payload) - 1:
                raise ValueError("Varint payload contains trailing bytes.")
            return tuple(values)
    if shift != 0 or len(values) != count:
        raise ValueError("Varint payload is truncated.")
    return tuple(values)


def encode_fixed_width(values: Iterable[int], *, vocabulary_size: int) -> bytes:
    if vocabulary_size < 2:
        raise ValueError("vocabulary_size must be at least two.")
    width = (vocabulary_size - 1).bit_length()
    output = bytearray()
    accumulator = 0
    bits = 0
    for value in values:
        if value < 0 or value >= vocabulary_size:
            raise ValueError("Token identifier is outside the vocabulary.")
        accumulator = (accumulator << width) | value
        bits += width
        while bits >= 8:
            bits -= 8
            output.append((accumulator >> bits) & 0xFF)
            accumulator &= (1 << bits) - 1
    if bits:
        output.append(accumulator << (8 - bits))
    return bytes(output)


def decode_fixed_width(
    payload: bytes,
    *,
    count: int,
    vocabulary_size: int,
) -> tuple[int, ...]:
    width = (vocabulary_size - 1).bit_length()
    expected_bytes = (count * width + 7) // 8
    if len(payload) != expected_bytes:
        raise ValueError("Fixed-width payload length does not match the declared token count.")
    values: list[int] = []
    accumulator = 0
    bits = 0
    for byte in payload:
        accumulator = (accumulator << 8) | byte
        bits += 8
        while bits >= width and len(values) < count:
            bits -= width
            value = (accumulator >> bits) & ((1 << width) - 1)
            if value >= vocabulary_size:
                raise ValueError("Fixed-width payload contains an out-of-vocabulary token.")
            values.append(value)
            accumulator &= (1 << bits) - 1
    if len(values) != count or accumulator != 0:
        raise ValueError("Fixed-width payload is truncated or has nonzero padding.")
    return tuple(values)


@dataclass(frozen=True)
class _HuffmanNode:
    symbol: int | None
    left: _HuffmanNode | None = None
    right: _HuffmanNode | None = None


def _code_lengths(values: tuple[int, ...]) -> dict[int, int]:
    frequencies = Counter(values)
    if not frequencies:
        return {}
    heap: list[tuple[int, int, _HuffmanNode]] = [
        (frequency, symbol, _HuffmanNode(symbol)) for symbol, frequency in frequencies.items()
    ]
    heapq.heapify(heap)
    if len(heap) == 1:
        return {heap[0][1]: 1}
    while len(heap) > 1:
        left_frequency, left_minimum, left = heapq.heappop(heap)
        right_frequency, right_minimum, right = heapq.heappop(heap)
        heapq.heappush(
            heap,
            (
                left_frequency + right_frequency,
                min(left_minimum, right_minimum),
                _HuffmanNode(None, left, right),
            ),
        )
    lengths: dict[int, int] = {}

    def visit(node: _HuffmanNode, depth: int) -> None:
        if node.symbol is not None:
            lengths[node.symbol] = depth
            return
        if node.left is None or node.right is None:
            raise ValueError("Malformed Huffman tree.")
        visit(node.left, depth + 1)
        visit(node.right, depth + 1)

    visit(heap[0][2], 0)
    return lengths


def _canonical_codes(lengths: dict[int, int]) -> dict[int, tuple[int, int]]:
    ordered = sorted((length, symbol) for symbol, length in lengths.items())
    codes: dict[int, tuple[int, int]] = {}
    code = 0
    previous_length = 0
    for length, symbol in ordered:
        if length <= 0 or length > 63:
            raise ValueError("Huffman code length is outside the supported range.")
        code <<= length - previous_length
        codes[symbol] = (code, length)
        code += 1
        previous_length = length
    return codes


def encode_huffman(values: Iterable[int]) -> bytes:
    sequence = tuple(values)
    if any(value < 0 or value > 0xFFFFFFFF for value in sequence):
        raise ValueError("Huffman symbols must fit u32.")
    lengths = _code_lengths(sequence)
    codes = _canonical_codes(lengths)
    bit_length = sum(codes[value][1] for value in sequence)
    header = bytearray(HUFFMAN_MAGIC)
    header.extend(struct.pack(">IIQ", len(lengths), len(sequence), bit_length))
    for symbol, length in sorted(lengths.items()):
        header.extend(struct.pack(">IB", symbol, length))
    body = bytearray()
    accumulator = 0
    bits = 0
    for value in sequence:
        code, length = codes[value]
        accumulator = (accumulator << length) | code
        bits += length
        while bits >= 8:
            bits -= 8
            body.append((accumulator >> bits) & 0xFF)
            accumulator &= (1 << bits) - 1
    if bits:
        body.append(accumulator << (8 - bits))
    return bytes(header + body)


def decode_huffman(payload: bytes) -> tuple[int, ...]:
    if len(payload) < 20 or payload[:4] != HUFFMAN_MAGIC:
        raise ValueError("Huffman payload has invalid magic or header.")
    symbol_count, token_count, bit_length = struct.unpack(">IIQ", payload[4:20])
    header_length = 20 + symbol_count * 5
    if len(payload) < header_length + (bit_length + 7) // 8:
        raise ValueError("Huffman payload is truncated.")
    if len(payload) != header_length + (bit_length + 7) // 8:
        raise ValueError("Huffman payload contains trailing bytes.")
    lengths: dict[int, int] = {}
    offset = 20
    for _ in range(symbol_count):
        symbol, length = struct.unpack(">IB", payload[offset : offset + 5])
        if symbol in lengths:
            raise ValueError("Huffman payload repeats a symbol.")
        lengths[symbol] = length
        offset += 5
    codes = _canonical_codes(lengths)
    decoding = {(code, length): symbol for symbol, (code, length) in codes.items()}
    values: list[int] = []
    code = 0
    length = 0
    for bit_index in range(bit_length):
        byte = payload[offset + bit_index // 8]
        bit = (byte >> (7 - bit_index % 8)) & 1
        code = (code << 1) | bit
        length += 1
        symbol = decoding.get((code, length))
        if symbol is not None:
            values.append(symbol)
            code = 0
            length = 0
    if length != 0 or len(values) != token_count:
        raise ValueError("Huffman payload does not decode to its declared token count.")
    if bit_length % 8 and payload[-1] & ((1 << (8 - bit_length % 8)) - 1):
        raise ValueError("Huffman payload has nonzero padding.")
    return tuple(values)


def encode_sparse_dictionary(values: Iterable[int]) -> bytes:
    sequence = tuple(values)
    if any(value < 0 or value > 0xFFFFFFFF for value in sequence):
        raise ValueError("Sparse dictionary symbols must fit u32.")
    symbols = sorted(set(sequence))
    ranks = {symbol: index for index, symbol in enumerate(symbols)}
    body = encode_fixed_width(
        (ranks[value] for value in sequence),
        vocabulary_size=max(2, len(symbols)),
    )
    header = bytearray(SPARSE_MAGIC)
    header.extend(struct.pack(">IIQ", len(symbols), len(sequence), len(body)))
    for symbol in symbols:
        header.extend(struct.pack(">I", symbol))
    return bytes(header + body)


def decode_sparse_dictionary(payload: bytes) -> tuple[int, ...]:
    if len(payload) < 20 or payload[:4] != SPARSE_MAGIC:
        raise ValueError("Sparse dictionary payload has invalid magic or header.")
    symbol_count, token_count, body_length = struct.unpack(">IIQ", payload[4:20])
    header_length = 20 + symbol_count * 4
    if len(payload) != header_length + body_length:
        raise ValueError("Sparse dictionary payload length is inconsistent.")
    symbols = tuple(
        struct.unpack(">I", payload[offset : offset + 4])[0]
        for offset in range(20, header_length, 4)
    )
    if tuple(sorted(set(symbols))) != symbols:
        raise ValueError("Sparse dictionary symbols must be unique and sorted.")
    ranks = decode_fixed_width(
        payload[header_length:],
        count=token_count,
        vocabulary_size=max(2, symbol_count),
    )
    if any(rank >= symbol_count for rank in ranks):
        raise ValueError("Sparse dictionary rank is outside the codebook.")
    return tuple(symbols[rank] for rank in ranks)


def encode_complete_dictionary(values: Iterable[int], *, vocabulary_size: int) -> bytes:
    sequence = tuple(values)
    body = encode_fixed_width(sequence, vocabulary_size=vocabulary_size)
    return COMPLETE_MAGIC + struct.pack(">IIQ", vocabulary_size, len(sequence), len(body)) + body


def decode_complete_dictionary(payload: bytes) -> tuple[int, ...]:
    if len(payload) < 20 or payload[:4] != COMPLETE_MAGIC:
        raise ValueError("Complete dictionary payload has invalid magic or header.")
    vocabulary_size, token_count, body_length = struct.unpack(">IIQ", payload[4:20])
    if len(payload) != 20 + body_length:
        raise ValueError("Complete dictionary payload length is inconsistent.")
    return decode_fixed_width(
        payload[20:],
        count=token_count,
        vocabulary_size=vocabulary_size,
    )
