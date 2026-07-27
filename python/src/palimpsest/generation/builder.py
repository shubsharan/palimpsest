from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from palimpsest.corpus.sources import SourceDefinition, load_chapters
from palimpsest.corpus.spans import SelectedSpan, select_word_span

from .cipher import apply_mapping, invert_mapping
from .entities import EntityRegenerationResult, regenerate_entities
from .key import stationary_key
from .text import canonicalize_capitalization, word_tokens


@dataclass(frozen=True)
class BuildResult:
    instance_id: str
    source_id: str
    selected_span: SelectedSpan
    prepared_text: str
    cipher_text: str
    vocabulary: tuple[str, ...]
    encryption_key: dict[str, str]
    recovered_mapping: dict[str, str]
    entity_mapping: dict[str, str]
    entities: tuple[dict[str, object], ...]


def build_instance(
    *,
    source_path: Path,
    source_format: str,
    source_id: str,
    instance_id: str,
    seed_hex: str,
    start_chapter: int,
    target_tokens: int,
    entity_review: dict[str, object] | None = None,
) -> BuildResult:
    chapters = load_chapters(
        SourceDefinition(path=source_path, source_format=source_format, source_id=source_id)
    )
    selected = select_word_span(
        chapters,
        start_chapter=start_chapter,
        target_tokens=target_tokens,
    )
    entity_result: EntityRegenerationResult = regenerate_entities(
        canonicalize_capitalization(selected.text),
        seed_hex=seed_hex,
        review_patch=entity_review,
    )
    prepared_tokens = word_tokens(entity_result.text)
    if len(prepared_tokens) != target_tokens:
        raise RuntimeError("Entity regeneration changed the declared word-token geometry.")
    vocabulary = tuple(sorted({token.normalized for token in prepared_tokens if token.normalized}))
    encryption_key = stationary_key(list(vocabulary), seed_hex)
    recovered_mapping = invert_mapping(encryption_key)
    cipher_text = apply_mapping(entity_result.text, encryption_key)
    if apply_mapping(cipher_text, recovered_mapping) != entity_result.text:
        raise RuntimeError("Oracle inversion failed to reproduce the prepared plaintext.")
    return BuildResult(
        instance_id=instance_id,
        source_id=source_id,
        selected_span=selected,
        prepared_text=entity_result.text,
        cipher_text=cipher_text,
        vocabulary=vocabulary,
        encryption_key=encryption_key,
        recovered_mapping=recovered_mapping,
        entity_mapping=entity_result.mapping,
        entities=entity_result.entities,
    )
