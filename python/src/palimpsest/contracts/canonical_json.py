from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any

import rfc8785


@dataclass(frozen=True)
class ContractInputError(ValueError):
    reason: str
    pointer: str
    message: str

    def __str__(self) -> str:
        return self.message


@dataclass(frozen=True)
class _NumberToken:
    raw: str


class _ObjectPairs(list[tuple[str, Any]]):
    pass


def _escape_pointer(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def child_pointer(parent: str, child: str | int) -> str:
    return f"{parent}/{child if isinstance(child, int) else _escape_pointer(child)}"


def _has_surrogate(value: str) -> bool:
    return any(0xD800 <= ord(character) <= 0xDFFF for character in value)


def _convert_number(token: _NumberToken, pointer: str) -> int | float:
    raw = token.raw
    if any(character in raw for character in ".eE"):
        value = float(raw)
        if not math.isfinite(value) or (value == 0 and raw.startswith("-")):
            raise ContractInputError(
                "number",
                pointer,
                "Non-finite and negative-zero numbers are forbidden.",
            )
        return value

    value = int(raw)
    if raw == "-0":
        raise ContractInputError("number", pointer, "Negative zero is forbidden.")
    if abs(value) > 9_007_199_254_740_991:
        raise ContractInputError(
            "number",
            pointer,
            "Integers outside the interoperable range must be encoded as strings.",
        )
    return value


def _convert(value: Any, pointer: str) -> Any:
    if isinstance(value, _ObjectPairs):
        result: dict[str, Any] = {}
        for name, child in value:
            member_pointer = child_pointer(pointer, name)
            if name in result:
                raise ContractInputError(
                    "duplicate_key",
                    member_pointer,
                    f"Duplicate object key: {name}",
                )
            if _has_surrogate(name):
                raise ContractInputError(
                    "unicode",
                    pointer,
                    "Object key contains a surrogate.",
                )
            result[name] = _convert(child, member_pointer)
        return result
    if isinstance(value, list):
        return [_convert(child, child_pointer(pointer, index)) for index, child in enumerate(value)]
    if isinstance(value, _NumberToken):
        return _convert_number(value, pointer)
    if isinstance(value, str) and _has_surrogate(value):
        raise ContractInputError("unicode", pointer, "String contains an unpaired surrogate.")
    return value


def _reject_constant(raw: str) -> None:
    raise ContractInputError("number", "/value", f"Non-finite number is forbidden: {raw}")


def parse_json_strict(source: str) -> Any:
    try:
        parsed = json.loads(
            source,
            object_pairs_hook=_ObjectPairs,
            parse_constant=_reject_constant,
            parse_float=_NumberToken,
            parse_int=_NumberToken,
        )
    except ContractInputError:
        raise
    except json.JSONDecodeError as error:
        raise ContractInputError("canonical", "", str(error)) from error
    return _convert(parsed, "")


def _assert_canonical_value(value: Any, pointer: str, seen: set[int]) -> None:
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, str):
        if _has_surrogate(value):
            raise ContractInputError("unicode", pointer, "String contains an unpaired surrogate.")
        return
    if isinstance(value, int):
        if abs(value) > 9_007_199_254_740_991:
            raise ContractInputError(
                "number",
                pointer,
                "Integer is outside the interoperable range.",
            )
        return
    if isinstance(value, float):
        if not math.isfinite(value) or (value == 0 and math.copysign(1, value) < 0):
            raise ContractInputError("number", pointer, "Number is outside the canonical subset.")
        return
    if not isinstance(value, (dict, list)):
        raise ContractInputError("type", pointer, "Value is not representable as JSON.")
    identity = id(value)
    if identity in seen:
        raise ContractInputError("canonical", pointer, "Cyclic values cannot be canonicalized.")
    seen.add(identity)
    if isinstance(value, list):
        for index, child in enumerate(value):
            _assert_canonical_value(child, child_pointer(pointer, index), seen)
    else:
        for name, child in value.items():
            if not isinstance(name, str):
                raise ContractInputError("type", pointer, "JSON object names must be strings.")
            _assert_canonical_value(child, child_pointer(pointer, name), seen)
    seen.remove(identity)


def canonical_json_bytes(value: Any) -> bytes:
    _assert_canonical_value(value, "", set())
    try:
        return rfc8785.dumps(value)
    except (rfc8785.CanonicalizationError, UnicodeEncodeError) as error:
        raise ContractInputError("canonical", "", str(error)) from error
