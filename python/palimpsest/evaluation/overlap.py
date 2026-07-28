from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from ..puzzle.text import word_tokens
from ..serialization import canonical_json_bytes

SourceKind = Literal["private-ciphertext", "plaintext"]
MatchKind = Literal["exact", "normalized"]

_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_GIT_OBJECT_ID = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")


@dataclass(frozen=True)
class CommittedContent:
    committed_path: str
    committed_blob_id: str
    content: str | bytes

    def __post_init__(self) -> None:
        if not self.committed_path:
            raise ValueError("Committed path must be non-empty.")
        if _GIT_OBJECT_ID.fullmatch(self.committed_blob_id) is None:
            raise ValueError("Committed blob ID must be a lowercase Git object ID.")


@dataclass(frozen=True)
class OverlapFinding:
    committed_path: str
    committed_blob_id: str
    source_kind: SourceKind
    source_id: str
    match_kind: MatchKind
    word_count: int
    sha256: str

    def __post_init__(self) -> None:
        if not self.committed_path or not self.source_id:
            raise ValueError("Overlap finding paths and source identities must be non-empty.")
        if _GIT_OBJECT_ID.fullmatch(self.committed_blob_id) is None:
            raise ValueError("Overlap finding blob ID must be a lowercase Git object ID.")
        if self.word_count < 1 or _DIGEST.fullmatch(self.sha256) is None:
            raise ValueError("Overlap finding span evidence is invalid.")

    def to_dict(self) -> dict[str, str | int]:
        return {
            "committedPath": self.committed_path,
            "committedBlobId": self.committed_blob_id,
            "sourceKind": self.source_kind,
            "sourceId": self.source_id,
            "matchKind": self.match_kind,
            "wordCount": self.word_count,
            "sha256": self.sha256,
        }


SCAN_FIELDS = (
    "reachableObjectCount",
    "reachableBlobReferenceCount",
    "uniqueReachableBlobCount",
    "uniqueTextBlobCount",
    "repeatedTreeReferenceCount",
    "skippedNonTextBlobCount",
)


def _text(value: str | bytes) -> str | None:
    if isinstance(value, str):
        return value
    try:
        decoded = value.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return None if "\x00" in decoded else decoded


def _normalized_words(value: str) -> list[str]:
    return [token.normalized for token in word_tokens(value) if token.normalized is not None]


def _longest_normalized_match(left: list[str], right: list[str], minimum: int) -> tuple[int, str]:
    if len(left) < minimum or len(right) < minimum:
        return 0, ""
    right_windows: dict[tuple[str, ...], list[int]] = {}
    for index in range(len(right) - minimum + 1):
        right_windows.setdefault(tuple(right[index : index + minimum]), []).append(index)

    best_count = 0
    best_digest = ""
    for left_index in range(len(left) - minimum + 1):
        window = tuple(left[left_index : left_index + minimum])
        for right_index in right_windows.get(window, ()):
            count = minimum
            while (
                left_index + count < len(left)
                and right_index + count < len(right)
                and left[left_index + count] == right[right_index + count]
            ):
                count += 1
            if count > best_count:
                payload = " ".join(left[left_index : left_index + count]).encode("utf-8")
                best_count = count
                best_digest = hashlib.sha256(payload).hexdigest()
    return best_count, best_digest


def _exact_match(candidate: str, source: str, minimum_words: int) -> tuple[int, str]:
    fragments = [source, *re.split(r"\n[ \t]*\n", source)]
    best = ""
    best_count = 0
    for fragment in fragments:
        count = len(word_tokens(fragment))
        if count >= minimum_words and count > best_count and fragment in candidate:
            best = fragment
            best_count = count
    return best_count, hashlib.sha256(best.encode("utf-8")).hexdigest() if best else ""


def observe_long_span_overlap(
    *,
    committed: Iterable[CommittedContent],
    private_sources: Mapping[str, str],
    plaintext_sources: Mapping[str, str],
    minimum_words: int = 32,
) -> tuple[OverlapFinding, ...]:
    if minimum_words < 8:
        raise ValueError("Long-span overlap threshold must be at least eight words.")
    sources: list[tuple[SourceKind, str, str]] = [
        *(
            ("private-ciphertext", source_id, source)
            for source_id, source in sorted(private_sources.items())
        ),
        *(
            ("plaintext", source_id, source)
            for source_id, source in sorted(plaintext_sources.items())
        ),
    ]
    findings: list[OverlapFinding] = []
    for committed_entry in sorted(
        committed,
        key=lambda item: (item.committed_path, item.committed_blob_id),
    ):
        candidate = _text(committed_entry.content)
        if candidate is None:
            continue
        candidate_words = _normalized_words(candidate)
        for source_kind, source_id, source in sources:
            word_count, digest = _exact_match(candidate, source, minimum_words)
            match_kind: MatchKind = "exact"
            if word_count == 0:
                word_count, digest = _longest_normalized_match(
                    candidate_words,
                    _normalized_words(source),
                    minimum_words,
                )
                match_kind = "normalized"
            if word_count < minimum_words:
                continue
            findings.append(
                OverlapFinding(
                    committed_path=committed_entry.committed_path,
                    committed_blob_id=committed_entry.committed_blob_id,
                    source_kind=source_kind,
                    source_id=source_id,
                    match_kind=match_kind,
                    word_count=word_count,
                    sha256=digest,
                )
            )
    return tuple(
        sorted(
            findings,
            key=lambda item: (
                item.committed_path,
                item.committed_blob_id,
                item.source_kind,
                item.source_id,
                item.match_kind,
            ),
        )
    )


def _path_map(value: object, name: str) -> dict[str, str | bytes]:
    if not isinstance(value, dict) or any(
        not isinstance(item_id, str) or not isinstance(path, str) for item_id, path in value.items()
    ):
        raise ValueError(f"{name} must map logical identifiers to file paths.")
    return {item_id: Path(path).read_bytes() for item_id, path in value.items()}


def _committed_entries(value: object) -> tuple[CommittedContent, ...]:
    if not isinstance(value, list):
        raise ValueError("committed must be an array of provenance entries.")
    entries: list[CommittedContent] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict) or set(item) != {
            "committedPath",
            "committedBlobId",
            "contentPath",
        }:
            raise ValueError(f"committed entry {index + 1} must contain exactly its provenance.")
        committed_path = item["committedPath"]
        committed_blob_id = item["committedBlobId"]
        content_path = item["contentPath"]
        if (
            not isinstance(committed_path, str)
            or not isinstance(committed_blob_id, str)
            or not isinstance(content_path, str)
        ):
            raise ValueError(f"committed entry {index + 1} provenance must be strings.")
        entries.append(
            CommittedContent(
                committed_path=committed_path,
                committed_blob_id=committed_blob_id,
                content=Path(content_path).read_bytes(),
            )
        )
    keys = [(entry.committed_path, entry.committed_blob_id) for entry in entries]
    if len(set(keys)) != len(keys):
        raise ValueError("committed provenance entries must contain unique path and blob pairs.")
    return tuple(entries)


def validate_scan_metadata(value: object) -> dict[str, int]:
    if not isinstance(value, dict) or set(value) != set(SCAN_FIELDS):
        raise ValueError("scan must contain exactly the declared reachability counters.")
    if any(
        isinstance(value[field], bool) or not isinstance(value[field], int) or value[field] < 0
        for field in SCAN_FIELDS
    ):
        raise ValueError("scan counters must be non-negative integers.")
    return {field: value[field] for field in SCAN_FIELDS}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--minimum-words", type=int, default=32)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    if not isinstance(request, dict):
        raise ValueError("Overlap request must be an object.")
    committed = _committed_entries(request.get("committed"))
    private = _path_map(request.get("privateSources"), "privateSources")
    plaintext = _path_map(request.get("plaintextSources"), "plaintextSources")
    scan = validate_scan_metadata(request.get("scan"))
    findings = observe_long_span_overlap(
        committed=committed,
        private_sources={
            source_id: content.decode("utf-8") for source_id, content in private.items()
        },
        plaintext_sources={
            source_id: content.decode("utf-8") for source_id, content in plaintext.items()
        },
        minimum_words=args.minimum_words,
    )
    print(
        canonical_json_bytes(
            {
                "findings": [finding.to_dict() for finding in findings],
                "scan": scan,
            }
        ).decode()
    )


if __name__ == "__main__":
    main()
