from __future__ import annotations

from collections import Counter
from collections.abc import Mapping

from .text import render, tokenize, word_tokens

MINIMUM_POST_CHANGED_TOKEN_MASS = 0.15


def _words(value: str) -> list[str]:
    return [token.normalized for token in word_tokens(value) if token.normalized is not None]


def split_text(value: str, part_count: int) -> tuple[str, ...]:
    total_words = len(word_tokens(value))
    if type(part_count) is not int or part_count < 1:
        raise ValueError("Puzzle part count must be positive.")
    if total_words < part_count:
        raise ValueError("Puzzle text is too short for the requested stage geometry.")

    width, remainder = divmod(total_words, part_count)
    counts = [width + (index < remainder) for index in range(part_count)]
    boundaries: list[int] = []
    cumulative = 0
    for count in counts:
        cumulative += count
        boundaries.append(cumulative)

    spans = tokenize(value)
    outputs: list[str] = []
    start = 0
    words_seen = 0
    boundary_index = 0
    for index, span in enumerate(spans):
        if span.is_word:
            words_seen += 1
        if boundary_index < len(boundaries) and words_seen == boundaries[boundary_index]:
            end = index + 1
            while end < len(spans) and not spans[end].is_word:
                end += 1
            outputs.append(render(spans[start:end]).strip())
            start = end
            boundary_index += 1

    if len(outputs) != part_count or start != len(spans):
        raise RuntimeError("Puzzle text could not be split on deterministic word boundaries.")
    return tuple(outputs)


def assign_streams(
    segments: tuple[str, ...],
    agent_ids: tuple[str, ...],
    stage_count: int,
) -> dict[str, tuple[str, ...]]:
    expected_count = len(agent_ids) * stage_count
    if len(segments) != expected_count:
        raise ValueError(f"Puzzle geometry requires exactly {expected_count} stage segments.")
    return {
        agent_id: segments[agent_index * stage_count : (agent_index + 1) * stage_count]
        for agent_index, agent_id in enumerate(agent_ids)
    }


def _validate_regions(
    streams: Mapping[str, tuple[str, ...]],
    *,
    pre_start: int,
    pre_end: int,
    post_start: int,
    post_end: int,
) -> None:
    if not streams:
        raise ValueError("Adjacent stage regions require at least one agent stream.")
    lengths = {len(stages) for stages in streams.values()}
    if (
        len(lengths) != 1
        or pre_start < 1
        or pre_end < pre_start
        or post_start != pre_end + 1
        or post_end < post_start
        or post_end > next(iter(lengths))
    ):
        raise ValueError("Invalid adjacent stage regions for puzzle geometry.")


def eligible_symbols(
    streams: Mapping[str, tuple[str, ...]],
    *,
    pre_start: int,
    pre_end: int,
    post_start: int,
    post_end: int,
    minimum_occurrences: int,
) -> set[str]:
    _validate_regions(
        streams,
        pre_start=pre_start,
        pre_end=pre_end,
        post_start=post_start,
        post_end=post_end,
    )
    eligible: set[str] | None = None
    for stages in streams.values():
        pre = Counter(word for stage in stages[pre_start - 1 : pre_end] for word in _words(stage))
        post = Counter(
            word for stage in stages[post_start - 1 : post_end] for word in _words(stage)
        )
        stream_eligible = {
            word
            for word in pre.keys() & post.keys()
            if pre[word] >= minimum_occurrences and post[word] >= minimum_occurrences
        }
        eligible = stream_eligible if eligible is None else eligible & stream_eligible
    return eligible or set()


def contradiction_metrics(
    streams: Mapping[str, tuple[str, ...]],
    *,
    pre_start: int,
    pre_end: int,
    post_start: int,
    post_end: int,
    changed_symbols: set[str],
) -> dict[str, dict[str, int | float]]:
    _validate_regions(
        streams,
        pre_start=pre_start,
        pre_end=pre_end,
        post_start=post_start,
        post_end=post_end,
    )
    result: dict[str, dict[str, int | float]] = {}
    for agent_id, stages in streams.items():
        pre = Counter(word for stage in stages[pre_start - 1 : pre_end] for word in _words(stage))
        post_words = [word for stage in stages[post_start - 1 : post_end] for word in _words(stage)]
        post = Counter(post_words)
        if any(pre[word] == 0 or post[word] == 0 for word in changed_symbols):
            raise RuntimeError(f"{agent_id} lacks changed-symbol evidence on both sides.")

        pre_changed = sum(pre[word] for word in changed_symbols)
        post_changed = sum(post[word] for word in changed_symbols)
        post_mass = post_changed / len(post_words)
        if post_mass < MINIMUM_POST_CHANGED_TOKEN_MASS:
            raise RuntimeError(f"{agent_id} revised evidence is not consequential enough.")
        result[agent_id] = {
            "preChangedOccurrences": pre_changed,
            "postChangedOccurrences": post_changed,
            "postChangedTokenMass": post_mass,
        }
    return result
