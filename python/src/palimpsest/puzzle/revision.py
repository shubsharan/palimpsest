from __future__ import annotations

import hashlib
import math
from collections import Counter
from dataclasses import dataclass

from .cipher import DeterministicStream, derive_seed


@dataclass(frozen=True)
class ChangedEntry:
    plain_type: str
    prior_cipher_type: str
    revised_cipher_type: str
    pre_occurrences: int
    post_occurrences: int
    frequency_stratum: int


@dataclass(frozen=True)
class StableControl:
    plain_type: str
    cipher_type: str
    pre_occurrences: int
    post_occurrences: int
    frequency_stratum: int
    matched_changed_type: str
    distance: float


@dataclass(frozen=True)
class RevisionResult:
    revised_key: dict[str, str]
    changed_entries: tuple[ChangedEntry, ...]
    matched_controls: tuple[StableControl, ...]


def _normalized_counts(tokens: list[str]) -> Counter[str]:
    return Counter(token.casefold() for token in tokens)


def _strata(
    eligible: list[str],
    post_counts: Counter[str],
    stratum_count: int,
) -> dict[str, int]:
    ordered = sorted(eligible, key=lambda word: (post_counts[word], word))
    return {
        word: min(stratum_count - 1, index * stratum_count // len(ordered))
        for index, word in enumerate(ordered)
    }


def _seed_rank(seed_hex: str, domain: str, word: str) -> tuple[bytes, str]:
    seed = derive_seed(seed_hex, domain)
    return hashlib.sha256(seed + word.encode("utf-8")).digest(), word


def _select_changed(
    eligible: list[str],
    post_counts: Counter[str],
    strata: dict[str, int],
    *,
    seed_hex: str,
    stratum_count: int,
    token_mass_target: float,
) -> list[str]:
    if not 0 < token_mass_target < 1:
        raise ValueError("Changed token-mass target must be between zero and one.")
    target = math.ceil(sum(post_counts[word] for word in eligible) * token_mass_target)
    by_stratum = {
        stratum: sorted(
            (word for word in eligible if strata[word] == stratum),
            key=lambda word: _seed_rank(seed_hex, f"gate-c:changed:{stratum}", word),
        )
        for stratum in range(stratum_count)
    }
    if any(not words for words in by_stratum.values()):
        raise ValueError("Every declared frequency stratum must contain an eligible type.")

    selected = [words.pop(0) for words in by_stratum.values()]
    remaining = sorted(
        (word for words in by_stratum.values() for word in words),
        key=lambda word: _seed_rank(seed_hex, "gate-c:changed:remaining", word),
    )
    changed_mass = sum(post_counts[word] for word in selected)
    for word in remaining:
        if changed_mass >= target:
            break
        selected.append(word)
        changed_mass += post_counts[word]
    if len(selected) < 2:
        raise ValueError("Partial re-keying requires at least two selected types.")
    return sorted(selected)


def _rotate_images(
    stationary_key: dict[str, str],
    selected: list[str],
    seed_hex: str,
) -> dict[str, str]:
    ordered = sorted(selected)
    images = [stationary_key[word] for word in ordered]
    stream = DeterministicStream(derive_seed(seed_hex, "gate-c:selected-image-cycle"))
    for index in range(len(images) - 1, 0, -1):
        other = stream.below(index)
        images[index], images[other] = images[other], images[index]
    revised = dict(stationary_key)
    revised.update(zip(ordered, images, strict=True))
    if set(revised) != set(revised.values()):
        raise RuntimeError("Partial re-keying broke the vocabulary-wide bijection.")
    if any(revised[word] == stationary_key[word] for word in selected):
        raise RuntimeError("Selected-image cycle left a changed entry unchanged.")
    if any(revised[word] == word for word in selected):
        raise RuntimeError("Selected-image cycle created a plaintext identity mapping.")
    return dict(sorted(revised.items()))


def build_revision(
    *,
    stationary_key: dict[str, str],
    pre_tokens: list[str],
    post_tokens: list[str],
    seed_hex: str,
    minimum_occurrences: int,
    stratum_count: int,
    token_mass_target: float,
) -> RevisionResult:
    pre_counts = _normalized_counts(pre_tokens)
    post_counts = _normalized_counts(post_tokens)
    eligible = sorted(
        word
        for word in stationary_key
        if pre_counts[word] >= minimum_occurrences and post_counts[word] >= minimum_occurrences
    )
    if len(eligible) < stratum_count * 2:
        raise ValueError("Too few active-on-both-sides types for changed entries and controls.")
    strata = _strata(eligible, post_counts, stratum_count)
    selected = _select_changed(
        eligible,
        post_counts,
        strata,
        seed_hex=seed_hex,
        stratum_count=stratum_count,
        token_mass_target=token_mass_target,
    )
    revised_key = _rotate_images(stationary_key, selected, seed_hex)

    available_controls = set(eligible) - set(selected)
    controls: list[StableControl] = []
    for changed in sorted(selected, key=lambda word: (strata[word], word)):
        candidates = [word for word in available_controls if strata[word] == strata[changed]]
        if not candidates:
            raise ValueError(f"No unmatched stable control remains for changed type {changed}.")
        changed_frequency = post_counts[changed] / len(post_tokens)
        control = min(
            candidates,
            key=lambda word: (
                abs(post_counts[word] / len(post_tokens) - changed_frequency),
                word,
            ),
        )
        distance = abs(post_counts[control] / len(post_tokens) - changed_frequency)
        available_controls.remove(control)
        controls.append(
            StableControl(
                plain_type=control,
                cipher_type=stationary_key[control],
                pre_occurrences=pre_counts[control],
                post_occurrences=post_counts[control],
                frequency_stratum=strata[control],
                matched_changed_type=changed,
                distance=distance,
            )
        )

    changed_entries = tuple(
        ChangedEntry(
            plain_type=word,
            prior_cipher_type=stationary_key[word],
            revised_cipher_type=revised_key[word],
            pre_occurrences=pre_counts[word],
            post_occurrences=post_counts[word],
            frequency_stratum=strata[word],
        )
        for word in sorted(selected)
    )
    return RevisionResult(
        revised_key=revised_key,
        changed_entries=changed_entries,
        matched_controls=tuple(controls),
    )
