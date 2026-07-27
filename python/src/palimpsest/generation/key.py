from __future__ import annotations

import hashlib

from .seeds import DeterministicStream, derive_seed


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
