from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..puzzle.text import word_tokens
from ..serialization import canonical_json_bytes


@dataclass(frozen=True)
class AggregateScore:
    matched_words: int
    total_words: int
    coverage: float
    accuracy: float

    def __post_init__(self) -> None:
        if (
            isinstance(self.matched_words, bool)
            or isinstance(self.total_words, bool)
            or not isinstance(self.matched_words, int)
            or not isinstance(self.total_words, int)
            or self.matched_words < 0
            or self.total_words < 0
            or self.matched_words > self.total_words
        ):
            raise ValueError("Aggregate word counts are invalid.")
        if not 0.0 <= self.coverage <= 1.0 or not 0.0 <= self.accuracy <= 1.0:
            raise ValueError("Aggregate coverage and accuracy must be bounded.")

    def to_dict(self) -> dict[str, int | float]:
        return {
            "matchedWords": self.matched_words,
            "totalWords": self.total_words,
            "coverage": self.coverage,
            "accuracy": self.accuracy,
        }


def _normalized_words(value: str) -> list[str]:
    return [token.normalized for token in word_tokens(value) if token.normalized is not None]


def score_reconstruction(truth: str, candidate: str) -> AggregateScore:
    expected = _normalized_words(truth)
    predicted = _normalized_words(candidate)
    matched = sum(left == right for left, right in zip(expected, predicted, strict=False))
    total = max(len(expected), len(predicted))
    coverage = (
        min(len(predicted), len(expected)) / len(expected) if expected else float(not predicted)
    )
    accuracy = matched / total if total else 1.0
    return AggregateScore(
        matched_words=matched,
        total_words=total,
        coverage=coverage,
        accuracy=accuracy,
    )


def _accuracy(
    correct: list[bool], selected: list[bool] | None = None
) -> dict[str, int | float | None]:
    values = (
        correct
        if selected is None
        else [value for value, keep in zip(correct, selected, strict=True) if keep]
    )
    matched = sum(values)
    total = len(values)
    return {
        "matchedWords": matched,
        "totalWords": total,
        "accuracy": matched / total if total else None,
    }


def _required_mapping(value: object, name: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object.")
    return value


def _required_strings(value: object, name: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{name} must be an array of strings.")
    return tuple(value)


def score_with_diagnostics(
    truth: str,
    candidate: str,
    *,
    allocation: object,
    design: object,
) -> dict[str, object]:
    """Score once, retaining only boolean position facts needed for the team ceiling."""
    allocation_record = _required_mapping(allocation, "Allocation")
    design_record = _required_mapping(design, "Oracle design")
    raw_assignments = allocation_record.get("assignments")
    if not isinstance(raw_assignments, list) or not raw_assignments:
        raise ValueError("Allocation assignments must be a non-empty array.")
    assignment_by_ordinal: dict[int, tuple[str, int]] = {}
    for raw in raw_assignments:
        record = _required_mapping(raw, "Allocation assignment")
        ordinal = record.get("paragraphOrdinal")
        agent_id = record.get("agentId")
        stage = record.get("stage")
        if (
            type(ordinal) is not int
            or not isinstance(agent_id, str)
            or type(stage) is not int
            or stage < 1
            or stage > 6
        ):
            raise ValueError("Allocation assignment is invalid.")
        if ordinal in assignment_by_ordinal:
            raise ValueError("Allocation paragraph ordinals must be unique.")
        assignment_by_ordinal[ordinal] = (agent_id, stage)

    paragraphs = [part for part in truth.strip().split("\n\n") if part.strip()]
    if len(paragraphs) != len(assignment_by_ordinal):
        raise ValueError("Plaintext paragraphs do not match the sealed allocation.")
    first_ordinal = min(assignment_by_ordinal)
    expected: list[str] = []
    owners: list[str] = []
    stages: list[int] = []
    for index, paragraph in enumerate(paragraphs):
        assignment = assignment_by_ordinal.get(first_ordinal + index)
        if assignment is None:
            raise ValueError("Plaintext paragraphs do not match the sealed allocation.")
        words = _normalized_words(paragraph)
        expected.extend(words)
        owners.extend([assignment[0]] * len(words))
        stages.extend([assignment[1]] * len(words))

    predicted = _normalized_words(candidate)
    correct = [
        index < len(predicted) and predicted[index] == word for index, word in enumerate(expected)
    ]
    aggregate = score_reconstruction(truth, candidate)

    sentinels = set(_required_strings(design_record.get("sentinels"), "Oracle sentinels"))
    changed_types = _required_strings(design_record.get("changedTypes"), "Oracle changedTypes")
    raw_specialists = _required_mapping(design_record.get("specialists"), "Oracle specialists")
    specialists = {
        word
        for agent_id in ("agent-1", "agent-2", "agent-3")
        for word in _required_strings(
            raw_specialists.get(agent_id), f"Oracle specialists {agent_id}"
        )
    }
    raw_controls = design_record.get("controls")
    if not isinstance(raw_controls, list):
        raise ValueError("Oracle controls must be an array.")
    control_types: set[str] = set()
    for raw in raw_controls:
        record = _required_mapping(raw, "Oracle control")
        control_type = record.get("controlType")
        if not isinstance(control_type, str):
            raise ValueError("Oracle control controlType must be a string.")
        control_types.add(control_type)
    pre = [stage < 4 for stage in stages]
    post = [not value for value in pre]

    def mask(words: set[str], region: list[bool]) -> list[bool]:
        return [word in words and keep for word, keep in zip(expected, region, strict=True)]

    diagnostics = {
        "overall": _accuracy(correct),
        "regions": {
            "preBoundary": _accuracy(correct, pre),
            "postBoundary": _accuracy(correct, post),
        },
        "changed": {
            "preBoundary": _accuracy(correct, mask(set(changed_types), pre)),
            "postBoundary": _accuracy(correct, mask(set(changed_types), post)),
        },
        "controls": {
            "preBoundary": _accuracy(correct, mask(control_types, pre)),
            "postBoundary": _accuracy(correct, mask(control_types, post)),
        },
        "sentinels": {
            "preBoundary": _accuracy(correct, mask(sentinels, pre)),
            "postBoundary": _accuracy(correct, mask(sentinels, post)),
        },
        "specialists": {
            "preBoundary": _accuracy(correct, mask(specialists, pre)),
            "postBoundary": _accuracy(correct, mask(specialists, post)),
        },
        "stages": [
            {
                "stage": stage,
                "score": _accuracy(correct, [value == stage for value in stages]),
            }
            for stage in range(1, 7)
        ],
        "evidenceOwners": [
            {
                "agentId": agent_id,
                "score": _accuracy(correct, [value == agent_id for value in owners]),
            }
            for agent_id in ("agent-1", "agent-2", "agent-3")
        ],
        "changedTypes": [
            {
                "changedType": changed_type,
                "score": _accuracy(correct, [word == changed_type for word in expected]),
            }
            for changed_type in changed_types
        ],
        "macroChangedTypeAccuracy": None,
        "positionHandling": {
            "expected": len(expected),
            "predicted": len(predicted),
            "compared": min(len(expected), len(predicted)),
            "missing": max(0, len(expected) - len(predicted)),
            "extra": max(0, len(predicted) - len(expected)),
            "coverage": min(len(predicted), len(expected)) / len(expected)
            if expected
            else float(not predicted),
        },
    }
    type_accuracies = [entry["score"]["accuracy"] for entry in diagnostics["changedTypes"]]
    present_accuracies = [value for value in type_accuracies if value is not None]
    diagnostics["macroChangedTypeAccuracy"] = (
        sum(present_accuracies) / len(present_accuracies) if present_accuracies else None
    )
    return {
        "aggregate": aggregate.to_dict(),
        "diagnostics": diagnostics,
        "correctPositions": correct,
        "predictedWords": len(predicted),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--truth", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--allocation", type=Path)
    parser.add_argument("--design", type=Path)
    args = parser.parse_args()
    truth = args.truth.read_text(encoding="utf-8")
    candidate = args.candidate.read_text(encoding="utf-8")
    if (args.allocation is None) != (args.design is None):
        parser.error("--allocation and --design must be supplied together")
    result: object = (
        score_reconstruction(truth, candidate).to_dict()
        if args.allocation is None
        else score_with_diagnostics(
            truth,
            candidate,
            allocation=json.loads(args.allocation.read_text(encoding="utf-8")),
            design=json.loads(args.design.read_text(encoding="utf-8")),
        )
    )
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
