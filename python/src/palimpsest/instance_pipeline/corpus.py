from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from palimpsest.contracts import sha256_hex


@dataclass(frozen=True)
class ReferenceDocument:
    document_id: str
    source_path: Path
    content: str


REFERENCE_SOURCES = (
    ("jane-eyre-reference", Path("artifacts/gate-a/inputs/sources/jane-eyre.txt")),
    ("moby-dick-reference", Path("artifacts/gate-a/inputs/sources/moby-dick.txt")),
)


def build_reference_corpus(
    root: Path, *, excerpt_bytes: int = 8_192
) -> tuple[ReferenceDocument, ...]:
    documents: list[ReferenceDocument] = []
    seen: set[str] = set()
    for document_id, relative_path in REFERENCE_SOURCES:
        source_path = root / relative_path
        source = source_path.read_bytes()
        excerpt = source[:excerpt_bytes].decode("utf-8", errors="ignore").strip() + "\n"
        digest = sha256_hex(excerpt.encode("utf-8"))
        if digest in seen:
            raise ValueError("Reference corpus contains a byte-identical duplicate.")
        seen.add(digest)
        documents.append(ReferenceDocument(document_id, relative_path, excerpt))
    return tuple(documents)
