from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any

import rfc8785


@dataclass(frozen=True)
class CanonicalJsonError(ValueError):
    reason: str
    pointer: str
    message: str

    def __str__(self) -> str:
        return self.message


def _escape_pointer(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def _child_pointer(parent: str, child: str | int) -> str:
    return f"{parent}/{child if isinstance(child, int) else _escape_pointer(child)}"


def _has_surrogate(value: str) -> bool:
    return any(0xD800 <= ord(character) <= 0xDFFF for character in value)


def _assert_canonical_value(value: Any, pointer: str, seen: set[int]) -> None:
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, str):
        if _has_surrogate(value):
            raise CanonicalJsonError("unicode", pointer, "String contains an unpaired surrogate.")
        return
    if isinstance(value, int):
        if abs(value) > 9_007_199_254_740_991:
            raise CanonicalJsonError(
                "number", pointer, "Integer is outside the interoperable range."
            )
        return
    if isinstance(value, float):
        if not math.isfinite(value) or (value == 0 and math.copysign(1, value) < 0):
            raise CanonicalJsonError("number", pointer, "Number is outside the canonical subset.")
        return
    if not isinstance(value, (dict, list)):
        raise CanonicalJsonError("type", pointer, "Value is not representable as JSON.")
    identity = id(value)
    if identity in seen:
        raise CanonicalJsonError("canonical", pointer, "Cyclic values cannot be canonicalized.")
    seen.add(identity)
    if isinstance(value, list):
        for index, child in enumerate(value):
            _assert_canonical_value(child, _child_pointer(pointer, index), seen)
    else:
        for name, child in value.items():
            if not isinstance(name, str):
                raise CanonicalJsonError("type", pointer, "JSON object names must be strings.")
            _assert_canonical_value(child, _child_pointer(pointer, name), seen)
    seen.remove(identity)


def canonical_json_bytes(value: Any) -> bytes:
    _assert_canonical_value(value, "", set())
    try:
        return rfc8785.dumps(value)
    except (rfc8785.CanonicalizationError, UnicodeEncodeError) as error:
        raise CanonicalJsonError("canonical", "", str(error)) from error


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()
