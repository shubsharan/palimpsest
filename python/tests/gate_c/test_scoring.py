from __future__ import annotations

from copy import deepcopy

from palimpsest.gate_c.scoring import build_trajectory, score_mapping_accuracy

ATTEMPT_ID = f"gate-c/{'a' * 64}/run-1"
CHANGED = [
    {
        "plainType": "plain-a",
        "priorCipherType": "old-a",
        "revisedCipherType": "new-a",
    },
    {
        "plainType": "plain-b",
        "priorCipherType": "old-b",
        "revisedCipherType": "new-b",
    },
]
CONTROLS = [
    {"plainType": "stable-a", "cipherType": "stable-cipher-a"},
    {"plainType": "stable-b", "cipherType": "stable-cipher-b"},
]


def mapping(cipher: str, plain: str, status: str = "active") -> dict[str, object]:
    return {
        "cipherType": cipher,
        "plainType": plain,
        "confidence": 0.8,
        "status": status,
        "supportingRevealOrdinals": [1],
        "rationale": "fixture",
    }


def checkpoint(
    ordinal: int,
    reveal: int,
    time_ms: int,
    mappings: list[dict[str, object]],
    *,
    switch: bool = False,
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "contractId": "solver-checkpoint",
        "attemptId": ATTEMPT_ID,
        "ordinal": ordinal,
        "revealOrdinal": reveal,
        "observedMonotonicMs": time_ms,
        "responseId": f"resp_{ordinal}",
        "previousResponseId": f"resp_{ordinal - 1}" if ordinal > 1 else None,
        "containerId": "cntr_1",
        "mappings": mappings,
        "switchHypotheses": (
            [{"afterChapter": 12, "confidence": 0.9, "evidence": "localized failures"}]
            if switch
            else []
        ),
        "reconstructionRefs": [],
        "usage": {"inputTokens": 1, "outputTokens": 1, "toolCalls": 1},
    }


def correct_prior() -> list[dict[str, object]]:
    return [
        mapping("old-a", "plain-a"),
        mapping("old-b", "plain-b"),
        mapping("stable-cipher-a", "stable-a"),
        mapping("stable-cipher-b", "stable-b"),
    ]


def correct_revised() -> list[dict[str, object]]:
    return [
        mapping("new-a", "plain-a"),
        mapping("new-b", "plain-b"),
        mapping("stable-cipher-a", "stable-a"),
        mapping("stable-cipher-b", "stable-b"),
    ]


def test_stationary_control_does_not_create_a_synthetic_drop() -> None:
    item = checkpoint(1, 4, 300, correct_prior())
    before = score_mapping_accuracy(
        item,
        changed_entries=CHANGED,
        matched_controls=CONTROLS,
        revised_regime=False,
    )
    repeated = score_mapping_accuracy(
        item,
        changed_entries=CHANGED,
        matched_controls=CONTROLS,
        revised_regime=False,
    )
    assert before == repeated == (1.0, 1.0)


def test_trajectory_measures_localized_drop_recovery_and_latency() -> None:
    checkpoints = [
        checkpoint(1, 1, 0, []),
        checkpoint(2, 3, 200, correct_prior()),
        checkpoint(3, 4, 310, correct_prior()),
        checkpoint(4, 5, 410, correct_revised(), switch=True),
        checkpoint(5, 6, 500, correct_revised()),
    ]
    trajectory = build_trajectory(
        attempt_id=ATTEMPT_ID,
        checkpoints=checkpoints,
        changed_entries=CHANGED,
        matched_controls=CONTROLS,
        contradiction_reveal_ordinal=4,
        switch_after_chapter=12,
        reveal_times_ms={1: 0, 2: 100, 3: 200, 4: 300, 5: 400, 6: 500},
    )
    assert trajectory["preSwitchGainPp"] == 100
    assert trajectory["localizedDropPp"] == 100
    assert trajectory["changedRecoveryPp"] == 100
    assert trajectory["stableRetentionPp"] == 0
    assert trajectory["falseRetractionRate"] == 0
    assert trajectory["detectionLatencyMs"] == 110
    assert trajectory["adaptationLatencyMs"] == 0
    assert trajectory["integrityFailures"] == []


def test_false_retractions_and_identity_mismatch_are_explicit() -> None:
    final_mappings = correct_revised()
    final_mappings[-1] = mapping("stable-cipher-b", "wrong")
    checkpoints = [
        checkpoint(1, 3, 200, correct_prior()),
        checkpoint(2, 4, 300, correct_prior()),
        checkpoint(3, 5, 400, final_mappings, switch=True),
    ]
    mismatched = deepcopy(checkpoints[1])
    mismatched["attemptId"] = f"gate-c/{'b' * 64}/run-1"
    checkpoints[1] = mismatched
    trajectory = build_trajectory(
        attempt_id=ATTEMPT_ID,
        checkpoints=checkpoints,
        changed_entries=CHANGED,
        matched_controls=CONTROLS,
        contradiction_reveal_ordinal=4,
        switch_after_chapter=12,
        reveal_times_ms={4: 300, 5: 400},
    )
    assert trajectory["falseRetractionRate"] == 0.5
    assert trajectory["integrityFailures"] == ["checkpoint 2 attempt identity mismatch"]
