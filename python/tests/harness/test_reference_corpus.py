from __future__ import annotations

from pathlib import Path

from palimpsest.contracts import sha256_hex
from palimpsest.instance_pipeline.corpus import build_reference_corpus

ROOT = Path(__file__).resolve().parents[3]


def test_reference_corpus_has_no_exact_duplicates_or_target_source() -> None:
    documents = build_reference_corpus(ROOT)
    digests = [sha256_hex(document.content.encode()) for document in documents]
    assert len(digests) == len(set(digests))
    assert all(document.source_path.name != "middlemarch.txt" for document in documents)
