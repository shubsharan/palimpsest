from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any
from unicodedata import normalize

from .canonical_json import ContractInputError, child_pointer

BLOCK_SIZE = 512


@dataclass(frozen=True)
class _Entry:
    path: str
    kind: str
    content: bytes
    input_index: int


def _invalid_path(pointer: str, message: str) -> None:
    raise ContractInputError("unsafe_path", pointer, message)


def _normalize_entry(entry: dict[str, Any], index: int) -> _Entry:
    pointer = child_pointer(child_pointer("", "entries"), index)
    path_pointer = child_pointer(pointer, "path")
    path = entry.get("path")
    kind = entry.get("kind")
    if not isinstance(path, str) or kind not in {"file", "directory"}:
        raise ContractInputError("type", pointer, "Archive entry has an invalid path or kind.")
    normalized = normalize("NFC", path)
    parts = normalized.split("/")
    if (
        normalized != path
        or normalized.startswith("/")
        or "\\" in normalized
        or "\0" in normalized
        or any(part in {"", ".", ".."} for part in parts)
    ):
        _invalid_path(path_pointer, f"Unsafe archive path: {path}")
    archive_path = f"{normalized}/" if kind == "directory" else normalized
    if len(archive_path.encode("utf-8")) > 100:
        _invalid_path(path_pointer, "Canonical ustar paths are limited to 100 UTF-8 bytes.")

    content = b""
    if kind == "file":
        encoded = entry.get("contentBase64")
        if not isinstance(encoded, str):
            raise ContractInputError(
                "required",
                child_pointer(pointer, "contentBase64"),
                "File content is required.",
            )
        try:
            content = base64.b64decode(encoded, validate=True)
        except ValueError as error:
            raise ContractInputError(
                "format",
                child_pointer(pointer, "contentBase64"),
                "Invalid canonical base64.",
            ) from error
        if base64.b64encode(content).decode("ascii") != encoded:
            raise ContractInputError(
                "format",
                child_pointer(pointer, "contentBase64"),
                "Invalid canonical base64.",
            )
    return _Entry(path=archive_path, kind=kind, content=content, input_index=index)


def normalize_archive_entries(entries: list[dict[str, Any]]) -> list[_Entry]:
    normalized = [_normalize_entry(entry, index) for index, entry in enumerate(entries)]
    normalized.sort(key=lambda entry: entry.path.encode("utf-8"))
    for index, entry in enumerate(normalized):
        entry_base = entry.path.removesuffix("/").lower()
        for prior in normalized[:index]:
            prior_base = prior.path.removesuffix("/").lower()
            if (
                entry_base == prior_base
                or (entry_base.startswith(f"{prior_base}/") and prior.kind == "file")
                or (prior_base.startswith(f"{entry_base}/") and entry.kind == "file")
            ):
                target = entry if entry.input_index > prior.input_index else prior
                _invalid_path(
                    f"/entries/{target.input_index}/path",
                    f"Colliding archive path: {target.path}",
                )
    return normalized


def _octal(value: int, width: int) -> bytes:
    digits = format(value, "o")
    if len(digits) > width - 1:
        raise ContractInputError("range", "", f"Value {value} exceeds ustar field width {width}.")
    return f"{digits:0>{width - 1}}\0".encode("ascii")


def _header(entry: _Entry) -> bytes:
    header = bytearray(BLOCK_SIZE)
    path = entry.path.encode("utf-8")
    header[0 : len(path)] = path
    header[100:108] = _octal(0o755 if entry.kind == "directory" else 0o644, 8)
    header[108:116] = _octal(0, 8)
    header[116:124] = _octal(0, 8)
    header[124:136] = _octal(len(entry.content), 12)
    header[136:148] = _octal(0, 12)
    header[148:156] = b" " * 8
    header[156:157] = b"5" if entry.kind == "directory" else b"0"
    header[257:263] = b"ustar\0"
    header[263:265] = b"00"
    header[329:337] = _octal(0, 8)
    header[337:345] = _octal(0, 8)
    checksum = sum(header)
    header[148:156] = f"{checksum:06o}\0 ".encode("ascii")
    return bytes(header)


def canonical_archive_bytes(value: Any) -> bytes:
    if not isinstance(value, dict) or not isinstance(value.get("entries"), list):
        raise ContractInputError(
            "type",
            "/entries",
            "Canonical archive input requires an entries array.",
        )
    entries = normalize_archive_entries(value["entries"])
    chunks: list[bytes] = []
    for entry in entries:
        chunks.append(_header(entry))
        if entry.kind == "file":
            chunks.append(entry.content)
            padding = (-len(entry.content)) % BLOCK_SIZE
            if padding:
                chunks.append(bytes(padding))
    chunks.append(bytes(BLOCK_SIZE * 2))
    return b"".join(chunks)
