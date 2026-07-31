from __future__ import annotations

import argparse
from pathlib import Path

from ..puzzle.text import word_tokens
from ..serialization import canonical_json_bytes

FEEDBACK_ID = "published-runnability-coverage-v1"


def _word_count(value: str) -> int:
    return sum(token.normalized is not None for token in word_tokens(value))


def check_coverage(*, ciphertext: str, candidate: str) -> dict[str, object]:
    ciphertext_words = _word_count(ciphertext)
    output_words = _word_count(candidate)
    coverage = (
        min(output_words, ciphertext_words) / ciphertext_words
        if ciphertext_words
        else float(output_words == 0)
    )
    return {
        "feedbackId": FEEDBACK_ID,
        "outputValidity": "valid" if output_words >= ciphertext_words else "incomplete",
        "ciphertextWords": ciphertext_words,
        "outputWords": output_words,
        "coverage": coverage,
    }


def check_files(*, ciphertext_path: Path, candidate_path: Path) -> dict[str, object]:
    try:
        ciphertext = ciphertext_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return {
            "feedbackId": FEEDBACK_ID,
            "outputValidity": "malformed",
            "error": "ciphertext could not be read",
        }
    try:
        candidate = candidate_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return {
            "feedbackId": FEEDBACK_ID,
            "outputValidity": "malformed",
            "error": "candidate could not be read",
        }
    return check_coverage(ciphertext=ciphertext, candidate=candidate)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ciphertext", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    args = parser.parse_args()
    result = check_files(
        ciphertext_path=args.ciphertext,
        candidate_path=args.candidate,
    )
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
