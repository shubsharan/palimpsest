from __future__ import annotations

import hashlib
import hmac


def derive_seed(master_seed_hex: str, domain: str) -> bytes:
    if len(master_seed_hex) != 64:
        raise ValueError("Master seed must be exactly 32 bytes rendered as lowercase hex.")
    try:
        master = bytes.fromhex(master_seed_hex)
    except ValueError as error:
        raise ValueError("Master seed must be lowercase hexadecimal.") from error
    if master_seed_hex != master_seed_hex.lower():
        raise ValueError("Master seed must be lowercase hexadecimal.")
    return hmac.new(master, domain.encode("ascii"), hashlib.sha256).digest()


class DeterministicStream:
    def __init__(self, seed: bytes) -> None:
        self._seed = seed
        self._counter = 0
        self._buffer = b""

    def _take(self, length: int) -> bytes:
        while len(self._buffer) < length:
            counter = self._counter.to_bytes(8, "big")
            self._buffer += hmac.new(self._seed, counter, hashlib.sha256).digest()
            self._counter += 1
        result, self._buffer = self._buffer[:length], self._buffer[length:]
        return result

    def below(self, bound: int) -> int:
        if bound <= 0:
            raise ValueError("Random bound must be positive.")
        ceiling = (1 << 64) - ((1 << 64) % bound)
        while True:
            candidate = int.from_bytes(self._take(8), "big")
            if candidate < ceiling:
                return candidate % bound
