from __future__ import annotations

from pathlib import Path

import pytest
from palimpsest.evidence.reference_producer import ProducerError, produce


def request() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "requestId": "reference-fixture",
        "producer": {
            "name": "reference-producer",
            "allowedVersions": ["1.0.0"],
        },
        "immutableInputs": [],
        "deadlineMs": 5000,
        "environment": {
            "node": "26.5.0",
            "pnpm": "10.14.0",
            "python": "3.12.4",
            "uv": "0.11.14",
            "git": "2.48.1",
            "platform": "test",
            "revision": "563c9e479d3a3337d26370821d2c3db667919cc3",
        },
        "payload": {"message": "hello\n"},
    }


def test_honest_producer_declares_every_output(tmp_path: Path) -> None:
    records = produce(request(), tmp_path, "honest")
    assert [record["kind"] for record in records] == ["started", "completed"]
    assert (tmp_path / "result.txt").read_text() == "hello\n"
    manifest = records[-1]["responseManifest"]
    assert [entry["path"] for entry in manifest["outputs"]] == ["result.txt"]


@pytest.mark.parametrize(
    "mode",
    [
        "missing-output",
        "undeclared-output",
        "digest-mismatch",
        "length-mismatch",
        "disallowed-producer-version",
    ],
)
def test_failure_modes_are_explicit_fixture_outputs(tmp_path: Path, mode: str) -> None:
    records = produce(request(), tmp_path, mode)
    assert records[-1]["kind"] == "completed"


def test_producer_failure_is_not_success_shaped(tmp_path: Path) -> None:
    with pytest.raises(ProducerError):
        produce(request(), tmp_path, "producer-failure")
