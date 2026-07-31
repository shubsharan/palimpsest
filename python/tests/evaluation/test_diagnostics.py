from __future__ import annotations

from palimpsest.evaluation.score import score_with_diagnostics

ALLOCATION = {
    "assignments": [
        {"paragraphOrdinal": 10, "agentId": "agent-1", "stage": 1},
        {"paragraphOrdinal": 11, "agentId": "agent-2", "stage": 4},
    ]
}
DESIGN = {
    "sentinels": ["alpha"],
    "specialists": {"agent-1": ["beta"], "agent-2": ["delta"], "agent-3": []},
    "controls": [{"changedType": "delta", "controlType": "gamma"}],
    "changedTypes": ["delta"],
}


def test_diagnostics_share_one_position_annotation() -> None:
    scored = score_with_diagnostics(
        "Alpha beta.\n\nGamma delta.\n",
        "alpha wrong gamma delta extra",
        allocation=ALLOCATION,
        design=DESIGN,
    )

    assert scored["aggregate"] == {
        "matchedWords": 3,
        "totalWords": 5,
        "coverage": 1.0,
        "accuracy": 0.6,
    }
    diagnostics = scored["diagnostics"]
    assert diagnostics["overall"] == {"matchedWords": 3, "totalWords": 4, "accuracy": 0.75}
    assert diagnostics["regions"]["preBoundary"] == {
        "matchedWords": 1,
        "totalWords": 2,
        "accuracy": 0.5,
    }
    assert diagnostics["regions"]["postBoundary"] == {
        "matchedWords": 2,
        "totalWords": 2,
        "accuracy": 1.0,
    }
    assert diagnostics["changed"]["postBoundary"]["matchedWords"] == 1
    assert diagnostics["controls"]["postBoundary"]["matchedWords"] == 1
    assert diagnostics["sentinels"]["preBoundary"]["matchedWords"] == 1
    assert diagnostics["specialists"]["preBoundary"]["matchedWords"] == 0
    assert diagnostics["stages"][0]["stage"] == 1
    assert diagnostics["stages"][3]["score"]["matchedWords"] == 2
    assert diagnostics["evidenceOwners"][1]["agentId"] == "agent-2"
    assert diagnostics["changedTypes"] == [
        {
            "changedType": "delta",
            "score": {"matchedWords": 1, "totalWords": 1, "accuracy": 1.0},
        }
    ]
    assert diagnostics["macroChangedTypeAccuracy"] == 1.0
    assert diagnostics["positionHandling"] == {
        "expected": 4,
        "predicted": 5,
        "compared": 4,
        "missing": 0,
        "extra": 1,
        "coverage": 1.0,
    }
    assert scored["correctPositions"] == [True, False, True, True]
    assert scored["predictedWords"] == 5


def test_empty_partitions_are_nullable_and_missing_words_are_incorrect() -> None:
    scored = score_with_diagnostics(
        "Alpha beta.\n\nGamma delta.\n",
        "alpha",
        allocation=ALLOCATION,
        design=DESIGN,
    )

    assert scored["diagnostics"]["evidenceOwners"][2] == {
        "agentId": "agent-3",
        "score": {"matchedWords": 0, "totalWords": 0, "accuracy": None},
    }
    assert scored["diagnostics"]["positionHandling"]["missing"] == 3
    assert scored["correctPositions"] == [True, False, False, False]
