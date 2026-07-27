from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from palimpsest.puzzle.overlap import main, observe_long_span_overlap, validate_scan_metadata


def words(prefix: str, count: int) -> str:
    return " ".join(f"{prefix}{index}" for index in range(count))


def test_reports_obvious_exact_and_normalized_long_spans_without_content() -> None:
    raw = words("cipher", 48)
    normalized_copy = raw.upper().replace(" ", "  \n")
    findings = observe_long_span_overlap(
        committed={"raw.txt": raw, "normalized.txt": normalized_copy},
        private_sources={"agent-1/stage-01": raw},
        plaintext_sources={},
        minimum_words=32,
    )

    assert {(finding.committed_path, finding.match_kind) for finding in findings} == {
        ("normalized.txt", "normalized"),
        ("raw.txt", "exact"),
    }
    assert all(finding.word_count >= 32 for finding in findings)
    assert all("cipher0" not in str(finding.to_dict()) for finding in findings)


def test_ignores_short_common_phrases_binary_blobs_and_encoded_content() -> None:
    raw = words("cipher", 20)
    findings = observe_long_span_overlap(
        committed={
            "short.txt": f"prefix {raw} suffix",
            "binary.bin": b"\xff\xfe\x00\x01",
            "encoded.txt": raw.encode().hex(),
        },
        private_sources={"agent-1/stage-01": raw},
        plaintext_sources={},
        minimum_words=32,
    )

    assert findings == ()


def test_labels_plaintext_and_private_cipher_sources_separately() -> None:
    private = words("opaque", 40)
    plaintext = words("plain", 40)
    findings = observe_long_span_overlap(
        committed={"relay.txt": private, "answer.txt": plaintext},
        private_sources={"agent-3/stage-06": private},
        plaintext_sources={"complete": plaintext},
        minimum_words=32,
    )

    assert {(finding.source_kind, finding.source_id) for finding in findings} == {
        ("private-ciphertext", "agent-3/stage-06"),
        ("plaintext", "complete"),
    }


def test_cli_preserves_findings_and_echoes_validated_scan(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    raw = words("cipher", 40)
    committed = tmp_path / "committed.txt"
    private = tmp_path / "private.txt"
    committed.write_text(raw, encoding="utf-8")
    private.write_text(raw, encoding="utf-8")
    scan = {
        "reachableObjectCount": 7,
        "reachableBlobReferenceCount": 3,
        "uniqueReachableBlobCount": 2,
        "uniqueTextBlobCount": 1,
        "repeatedTreeReferenceCount": 1,
        "skippedNonTextBlobCount": 1,
    }
    request = tmp_path / "request.json"
    request.write_text(
        json.dumps(
            {
                "committed": {"raw.txt": str(committed)},
                "privateSources": {"agent-1/stage-01": str(private)},
                "plaintextSources": {},
                "scan": scan,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(sys, "argv", ["palimpsest.puzzle.overlap", "--request", str(request)])

    main()

    result = json.loads(capsys.readouterr().out)
    assert result["scan"] == scan
    assert [(finding["committedPath"], finding["matchKind"]) for finding in result["findings"]] == [
        ("raw.txt", "exact")
    ]


@pytest.mark.parametrize(
    "value",
    [
        {},
        {
            "reachableObjectCount": True,
            "reachableBlobReferenceCount": 0,
            "uniqueReachableBlobCount": 0,
            "uniqueTextBlobCount": 0,
            "repeatedTreeReferenceCount": 0,
            "skippedNonTextBlobCount": 0,
        },
    ],
)
def test_scan_metadata_rejects_missing_or_non_integer_counters(value: object) -> None:
    with pytest.raises(ValueError, match="scan"):
        validate_scan_metadata(value)
