from __future__ import annotations

from pathlib import Path

from palimpsest.evaluation.checker import FEEDBACK_ID, check_coverage, check_files


def test_correct_and_incorrect_same_length_outputs_are_identical() -> None:
    ciphertext = "cipher words here"
    correct = check_coverage(ciphertext=ciphertext, candidate="plain words here")
    incorrect = check_coverage(ciphertext=ciphertext, candidate="wrong answer entirely")

    assert correct == incorrect == {
        "feedbackId": FEEDBACK_ID,
        "outputValidity": "valid",
        "ciphertextWords": 3,
        "outputWords": 3,
        "coverage": 1.0,
    }


def test_checker_reports_bounded_word_coverage() -> None:
    assert check_coverage(ciphertext="one two three four", candidate="one two") == {
        "feedbackId": FEEDBACK_ID,
        "outputValidity": "incomplete",
        "ciphertextWords": 4,
        "outputWords": 2,
        "coverage": 0.5,
    }
    assert check_coverage(ciphertext="one two", candidate="one two three") == {
        "feedbackId": FEEDBACK_ID,
        "outputValidity": "valid",
        "ciphertextWords": 2,
        "outputWords": 3,
        "coverage": 1.0,
    }


def test_checker_handles_empty_ciphertext_without_oracle_values() -> None:
    result = check_coverage(ciphertext="", candidate="")
    assert result == {
        "feedbackId": FEEDBACK_ID,
        "outputValidity": "valid",
        "ciphertextWords": 0,
        "outputWords": 0,
        "coverage": 1.0,
    }
    assert not {"matchedWords", "accuracy", "mismatch"} & set(result)


def test_checker_returns_plain_error_for_unreadable_or_malformed_files(tmp_path: Path) -> None:
    ciphertext = tmp_path / "ciphertext.txt"
    ciphertext.write_text("one two\n", encoding="utf-8")

    assert check_files(
        ciphertext_path=ciphertext,
        candidate_path=tmp_path / "missing.txt",
    ) == {
        "feedbackId": FEEDBACK_ID,
        "outputValidity": "malformed",
        "error": "candidate could not be read",
    }

    malformed = tmp_path / "malformed.txt"
    malformed.write_bytes(b"\xff")
    assert check_files(ciphertext_path=ciphertext, candidate_path=malformed) == {
        "feedbackId": FEEDBACK_ID,
        "outputValidity": "malformed",
        "error": "candidate could not be read",
    }


def test_checker_module_has_no_oracle_or_build_dependency() -> None:
    source = Path(__file__).resolve().parents[2] / "palimpsest/evaluation/checker.py"
    text = source.read_text(encoding="utf-8")

    assert "oracle" not in text
    assert "PuzzleBuild" not in text
    assert "--build" not in text
