from __future__ import annotations

from palimpsest.puzzle.overlap import observe_long_span_overlap


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
