from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex
from palimpsest.corpus.sources import SourceDefinition, load_chapters
from palimpsest.generation.entities import regenerate_entities
from palimpsest.generation.key import stationary_key
from palimpsest.generation.text import canonicalize_capitalization, render, tokenize, word_tokens

from .artifacts import write_canonical, write_text
from .config import (
    CHANGED_TOKEN_MASS_TARGET,
    CONTRADICTION_MASS_THRESHOLD,
    END_CHAPTER,
    ENTITY_REVIEW_PATH,
    FREQUENCY_STRATA,
    GATE_C_PROFILE,
    INSTANCE_ID,
    MIN_OCCURRENCES_PER_SEGMENT,
    MIN_SEGMENT_TOKENS,
    PATHS,
    REVEAL_INTERVAL_MS,
    SEED_HEX,
    SOURCE_FORMAT,
    SOURCE_ID,
    SOURCE_PATH,
    START_CHAPTER,
    SWITCH_AFTER_CHAPTER,
    TARGET_TOKEN_COUNT,
)
from .revision import RevisionResult, apply_regimes, build_revision


@dataclass(frozen=True)
class BuiltGateCInstance:
    private_manifest: dict[str, Any]
    public_manifest: dict[str, Any]
    reveal_plan: dict[str, Any]
    cipher_chapters: tuple[str, ...]
    prepared_text: str
    cipher_text: str
    stationary_key: dict[str, str]
    revised_key: dict[str, str]
    changed_entries: list[dict[str, Any]]
    matched_controls: list[dict[str, Any]]
    entity_types: tuple[str, ...]


def _chapter_text(heading: str, text: str) -> str:
    return f"{heading}\n\n{text}"


def _artifact_ref(content: bytes, artifact_type: str) -> dict[str, Any]:
    return {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def _split_by_word_counts(value: str, counts: list[int]) -> tuple[str, ...]:
    spans = tokenize(value)
    outputs: list[str] = []
    start = 0
    word_total = 0
    count_index = 0
    for index, span in enumerate(spans):
        if span.is_word:
            word_total += 1
        if count_index < len(counts) and word_total == sum(counts[: count_index + 1]):
            end = index + 1
            while end < len(spans) and not spans[end].is_word:
                end += 1
            outputs.append(render(spans[start:end]).strip())
            start = end
            count_index += 1
    if count_index != len(counts) or start != len(spans):
        raise RuntimeError("Cipher text could not be split on frozen chapter token boundaries.")
    return tuple(outputs)


def _changed_payload(revision: RevisionResult) -> list[dict[str, Any]]:
    return [
        {
            "plainType": entry.plain_type,
            "priorCipherType": entry.prior_cipher_type,
            "revisedCipherType": entry.revised_cipher_type,
            "preOccurrences": entry.pre_occurrences,
            "postOccurrences": entry.post_occurrences,
            "frequencyStratum": entry.frequency_stratum,
        }
        for entry in revision.changed_entries
    ]


def _control_payload(revision: RevisionResult) -> list[dict[str, Any]]:
    return [
        {
            "plainType": control.plain_type,
            "cipherType": control.cipher_type,
            "preOccurrences": control.pre_occurrences,
            "postOccurrences": control.post_occurrences,
            "frequencyStratum": control.frequency_stratum,
            "matchedChangedType": control.matched_changed_type,
            "distance": control.distance,
        }
        for control in revision.matched_controls
    ]


def build_gate_c_instance(root: Path = Path(".")) -> BuiltGateCInstance:
    source_path = root / SOURCE_PATH
    review_path = root / ENTITY_REVIEW_PATH
    chapters = load_chapters(SourceDefinition(source_path, SOURCE_FORMAT, SOURCE_ID))
    selected = chapters[START_CHAPTER : END_CHAPTER + 1]
    if [chapter.index for chapter in selected] != list(range(START_CHAPTER, END_CHAPTER + 1)):
        raise RuntimeError("Gate C source no longer has the frozen contiguous chapter geometry.")

    raw_parts = [_chapter_text(chapter.heading, chapter.text) for chapter in selected]
    raw_text = "\n\n".join(raw_parts)
    review = json.loads(review_path.read_text(encoding="utf-8"))
    regenerated = regenerate_entities(
        canonicalize_capitalization(raw_text),
        seed_hex=SEED_HEX,
        review_patch=review,
    )
    prepared_tokens = [token.normalized for token in word_tokens(regenerated.text)]
    if any(token is None for token in prepared_tokens):
        raise RuntimeError("Word token normalization unexpectedly produced null.")
    normalized_tokens = [token for token in prepared_tokens if token is not None]
    if len(normalized_tokens) != TARGET_TOKEN_COUNT:
        raise RuntimeError(
            f"Frozen Gate C geometry drifted: {len(normalized_tokens)} != {TARGET_TOKEN_COUNT}."
        )

    chapter_token_counts = [len(word_tokens(part)) for part in raw_parts]
    switch_word_offset = sum(chapter_token_counts[: SWITCH_AFTER_CHAPTER - START_CHAPTER + 1])
    if min(switch_word_offset, TARGET_TOKEN_COUNT - switch_word_offset) < MIN_SEGMENT_TOKENS:
        raise RuntimeError("Frozen switch violates the minimum adjacent-segment geometry.")

    vocabulary = sorted(set(normalized_tokens))
    stationary = stationary_key(vocabulary, SEED_HEX)
    revision = build_revision(
        stationary_key=stationary,
        pre_tokens=normalized_tokens[:switch_word_offset],
        post_tokens=normalized_tokens[switch_word_offset:],
        seed_hex=SEED_HEX,
        minimum_occurrences=MIN_OCCURRENCES_PER_SEGMENT,
        stratum_count=FREQUENCY_STRATA,
        token_mass_target=CHANGED_TOKEN_MASS_TARGET,
    )
    cipher_text = apply_regimes(
        regenerated.text,
        stationary_key=stationary,
        revised_key=revision.revised_key,
        switch_word_offset=switch_word_offset,
    )
    cipher_chapters = _split_by_word_counts(cipher_text, chapter_token_counts)

    changed = _changed_payload(revision)
    controls = _control_payload(revision)
    changed_bytes = canonical_json_bytes(changed)
    controls_bytes = canonical_json_bytes(controls)
    prepared_bytes = regenerated.text.encode("utf-8")
    cipher_bytes = cipher_text.encode("utf-8")
    stationary_bytes = canonical_json_bytes(stationary)
    revised_bytes = canonical_json_bytes(revision.revised_key)

    chapter_slots: list[dict[str, Any]] = []
    cumulative_tokens = 0
    post_changed_total = sum(entry.post_occurrences for entry in revision.changed_entries)
    cumulative_post_changed = 0
    contradiction_ordinal: int | None = None
    changed_types = {entry.plain_type for entry in revision.changed_entries}
    word_cursor = 0
    for ordinal, (chapter, token_count, cipher_chapter) in enumerate(
        zip(selected, chapter_token_counts, cipher_chapters, strict=True),
        start=1,
    ):
        next_cursor = word_cursor + token_count
        if word_cursor >= switch_word_offset:
            cumulative_post_changed += sum(
                token in changed_types for token in normalized_tokens[word_cursor:next_cursor]
            )
        cumulative_tokens += token_count
        if (
            contradiction_ordinal is None
            and cumulative_post_changed / post_changed_total >= CONTRADICTION_MASS_THRESHOLD
        ):
            contradiction_ordinal = ordinal
        chapter_slots.append(
            {
                "ordinal": ordinal,
                "plannedOffsetMs": (ordinal - 1) * REVEAL_INTERVAL_MS,
                "chapterIndex": chapter.index,
                "tokenCount": token_count,
                "cumulativeTokenCount": cumulative_tokens,
                "cipherChapterArtifact": {
                    **_artifact_ref(cipher_chapter.encode("utf-8"), "cipher-chapter"),
                },
                "cumulativeChangedContradictionMass": (
                    cumulative_post_changed / post_changed_total
                ),
            }
        )
        word_cursor = next_cursor
    if contradiction_ordinal is None:
        raise RuntimeError("Reveal plan never reaches the contradiction threshold.")

    private_manifest = {
        "schemaVersion": 1,
        "contractId": "revision-instance",
        "instanceId": INSTANCE_ID,
        "profileId": GATE_C_PROFILE,
        "sourceId": SOURCE_ID,
        "tokenCount": TARGET_TOKEN_COUNT,
        "switchAfterChapter": SWITCH_AFTER_CHAPTER,
        "switchWordOffset": switch_word_offset,
        "preSwitchTokenCount": switch_word_offset,
        "postSwitchTokenCount": TARGET_TOKEN_COUNT - switch_word_offset,
        "preparedText": _artifact_ref(prepared_bytes, "prepared-plaintext"),
        "cipherText": _artifact_ref(cipher_bytes, "cipher-view"),
        "stationaryKey": _artifact_ref(stationary_bytes, "stationary-key"),
        "revisedKey": _artifact_ref(revised_bytes, "revised-key"),
        "changedEntries": _artifact_ref(changed_bytes, "changed-entry-set"),
        "matchedControls": _artifact_ref(controls_bytes, "matched-stable-controls"),
    }
    public_manifest = {
        "schemaVersion": 1,
        "contractId": "revision-instance-public",
        "instanceId": INSTANCE_ID,
        "profileId": GATE_C_PROFILE,
        "tokenCount": TARGET_TOKEN_COUNT,
        "revealSlotCount": len(chapter_slots),
    }
    reveal_plan = {
        "schemaVersion": 1,
        "contractId": "reveal-plan",
        "instanceId": INSTANCE_ID,
        "clock": "monotonic",
        "intervalMs": REVEAL_INTERVAL_MS,
        "slots": chapter_slots,
        "contradictionThreshold": {
            "changedOccurrenceFraction": CONTRADICTION_MASS_THRESHOLD,
            "firstRevealOrdinal": contradiction_ordinal,
        },
    }
    return BuiltGateCInstance(
        private_manifest=private_manifest,
        public_manifest=public_manifest,
        reveal_plan=reveal_plan,
        cipher_chapters=cipher_chapters,
        prepared_text=regenerated.text,
        cipher_text=cipher_text,
        stationary_key=stationary,
        revised_key=revision.revised_key,
        changed_entries=changed,
        matched_controls=controls,
        entity_types=tuple(
            sorted(
                {
                    replacement
                    for entity in regenerated.entities
                    for replacement in entity["replacementAliases"]
                    if isinstance(replacement, str)
                }
            )
        ),
    )


def _write_instance(root: Path, output: Path, *, classification: str) -> dict[str, Any]:
    built = build_gate_c_instance(root)
    write_canonical(output / "private-instance.json", built.private_manifest)
    write_canonical(output / "public-instance.json", built.public_manifest)
    write_canonical(output / "reveal-plan.json", built.reveal_plan)
    write_text(output / "sealed" / "prepared.txt", built.prepared_text, "prepared-plaintext")
    write_text(output / "sealed" / "cipher.txt", built.cipher_text, "cipher-view")
    write_canonical(output / "sealed" / "stationary-key.json", built.stationary_key)
    write_canonical(output / "sealed" / "revised-key.json", built.revised_key)
    write_canonical(output / "sealed" / "changed-entries.json", built.changed_entries)
    write_canonical(output / "sealed" / "matched-controls.json", built.matched_controls)
    for ordinal, cipher_chapter in enumerate(built.cipher_chapters, start=1):
        write_text(
            output / "public" / "chapters" / f"{ordinal:02d}.txt",
            cipher_chapter,
            "cipher-chapter",
        )
    summary = {
        "schemaVersion": 1,
        "classification": classification,
        "promotable": classification == "declared-input",
        "instance": built.private_manifest,
        "revealPlan": built.reveal_plan,
    }
    write_canonical(output / "build.json", summary)
    return summary


def write_calibration(root: Path = Path(".")) -> dict[str, Any]:
    output = root / PATHS.calibration
    summary = _write_instance(root, output, classification="calibration-only")
    write_canonical(output / "calibration.json", summary)
    return summary


def write_declared(root: Path = Path(".")) -> dict[str, Any]:
    return _write_instance(
        root,
        root / PATHS.root / "declared",
        classification="declared-input",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--calibrate", action="store_true")
    parser.add_argument("--build-declared", action="store_true")
    args = parser.parse_args()
    if args.calibrate == args.build_declared:
        parser.error("select exactly one of --calibrate or --build-declared")
    result = write_calibration() if args.calibrate else write_declared()
    print(canonical_json_bytes(result).decode("utf-8"))


if __name__ == "__main__":
    main()
