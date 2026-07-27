from __future__ import annotations

import hashlib
import hmac

from .text import TextSpan, apply_capitalization, render, tokenize


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


def _derange(words: list[str], master_seed_hex: str, domain: str) -> dict[str, str]:
    ranked = sorted(
        words,
        key=lambda word: (
            hashlib.sha256(derive_seed(master_seed_hex, f"{domain}:rank") + word.encode()).digest(),
            word,
        ),
    )
    images = ranked.copy()
    stream = DeterministicStream(derive_seed(master_seed_hex, f"{domain}:sattolo"))
    for index in range(len(images) - 1, 0, -1):
        other = stream.below(index)
        images[index], images[other] = images[other], images[index]
    return dict(zip(ranked, images, strict=True))


def stationary_key(vocabulary: list[str], master_seed_hex: str) -> dict[str, str]:
    ordered = sorted(set(vocabulary))
    if len(ordered) != len(vocabulary):
        raise ValueError("Vocabulary must contain unique types.")
    if len(ordered) < 2:
        raise ValueError("A derangement requires at least two vocabulary types.")
    groups = {
        "single-letter": [word for word in ordered if len(word) == 1],
        "multi-letter": [word for word in ordered if len(word) != 1],
    }
    if any(len(group) == 1 for group in groups.values()):
        raise ValueError(
            "Rendering-safe derangement requires zero or at least two types in each "
            "capitalization-ambiguity class."
        )
    mapping = {
        plain: cipher
        for name, group in groups.items()
        for plain, cipher in _derange(
            group,
            master_seed_hex,
            f"stationary-key:{name}",
        ).items()
    }
    if set(mapping) != set(mapping.values()) or any(
        plain == cipher for plain, cipher in mapping.items()
    ):
        raise RuntimeError(
            "Stationary key construction failed its bijection/derangement invariant."
        )
    return dict(sorted(mapping.items()))


def apply_mapping(value: str, mapping: dict[str, str]) -> str:
    output: list[TextSpan] = []
    for span in tokenize(value):
        if not span.is_word:
            output.append(span)
            continue
        assert span.normalized is not None
        replacement = mapping.get(span.normalized)
        if replacement is None:
            raise ValueError(f"Mapping omits normalized word type: {span.normalized}")
        output.append(TextSpan(apply_capitalization(span.surface, replacement), replacement, True))
    return render(output)
