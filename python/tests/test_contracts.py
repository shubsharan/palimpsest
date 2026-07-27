from __future__ import annotations

import base64
from typing import Any

from hypothesis import given
from hypothesis import strategies as st
from palimpsest.contracts import (
    canonical_archive_bytes,
    canonical_json_bytes,
    sha256_hex,
    validate_fixture,
)

from .helpers import FIXTURES_ROOT, load_fixture_raw


def test_shared_contract_fixtures(fixture_cases: list[dict[str, Any]]) -> None:
    for fixture in fixture_cases:
        verdict = validate_fixture(fixture["contractId"], load_fixture_raw(fixture))
        expected = fixture["expected"]

        assert verdict.accepted is expected["accepted"], fixture["fixtureId"]
        assert verdict.reason == expected["reason"], fixture["fixtureId"]
        assert verdict.pointer == expected["pointer"], fixture["fixtureId"]

        if not verdict.accepted:
            continue

        if expected.get("canonicalUtf8Base64"):
            canonical = canonical_json_bytes(verdict.value)
            assert base64.b64encode(canonical).decode("ascii") == expected["canonicalUtf8Base64"]
            assert sha256_hex(canonical) == expected["sha256"]

        if fixture["contractId"] == "canonical-archive":
            assert expected.get("archivePath") is not None
            assert expected["sha256"] is not None
            archive = canonical_archive_bytes(verdict.value)
            assert archive == (FIXTURES_ROOT / expected["archivePath"]).read_bytes()
            assert len(archive) == expected["byteLength"]
            assert sha256_hex(archive) == expected["sha256"]


@given(st.permutations(["a.txt", "m.txt", "z.txt"]))
def test_archive_entry_order_is_irrelevant(paths: list[str]) -> None:
    payload = {
        "schemaVersion": 1,
        "contractId": "canonical-archive",
        "entries": [
            {
                "path": path,
                "kind": "file",
                "contentBase64": base64.b64encode(path.encode()).decode(),
            }
            for path in paths
        ],
    }
    reverse_payload = {**payload, "entries": list(reversed(payload["entries"]))}
    assert canonical_archive_bytes(payload) == canonical_archive_bytes(reverse_payload)
