from __future__ import annotations

import pytest
from palimpsest.grading.score_report import METRIC_IDS, score_metrics


def _events() -> list[dict[str, object]]:
    return [
        {
            "eventType": "worker.completed",
            "monotonicElapsedNs": str(time),
            "payload": {"agentId": f"agent-{index}"},
        }
        for index, time in enumerate((20, 40, 60), start=1)
    ] + [
        {
            "eventType": "lifecycle.transition",
            "monotonicElapsedNs": "100",
            "payload": {"state": "SUBMITTED"},
        }
    ]


def test_scores_every_versioned_metric_from_declared_evidence() -> None:
    metrics = score_metrics(
        target="Alice keeps faith",
        candidates=["Alice keeps faith", "Alice loses faith", ""],
        mappings=[
            {"cipher-alice": "alice", "cipher-keeps-new": "keeps", "cipher-faith": "faith"},
            {"cipher-alice": "alice", "cipher-keeps-new": "wrong", "cipher-faith": "faith"},
            {},
        ],
        hypotheses=[
            {"switchDetected": True, "confidence": 1.0},
            {"switchDetected": False, "confidence": 0.5},
            {"switchDetected": True},
        ],
        stationary_key={
            "alice": "cipher-alice",
            "keeps": "cipher-keeps-old",
            "faith": "cipher-faith",
        },
        changed_entries=[
            {
                "plainType": "keeps",
                "priorCipherType": "cipher-keeps-old",
                "revisedCipherType": "cipher-keeps-new",
            }
        ],
        matched_controls=[{"plainType": "faith", "cipherType": "cipher-faith"}],
        entity_types={"alice"},
        events=_events(),
        ledgers=[
            {"agentId": "agent-1", "result": "accepted"},
            {"agentId": "agent-2", "result": "accepted"},
        ],
        agent_ids=("agent-1", "agent-2", "agent-3"),
    )

    assert tuple(metrics) == METRIC_IDS
    assert metrics["reconstruction"] == pytest.approx((1 + 2 / 3 + 0) / 3)
    assert metrics["entity"] == pytest.approx(2 / 3)
    assert metrics["dictionary"] == pytest.approx(4 / 9)
    assert metrics["changed"] == pytest.approx(1 / 3)
    assert metrics["stable"] == pytest.approx(2 / 3)
    assert metrics["switch"] == pytest.approx(2 / 3)
    assert metrics["latency"] == pytest.approx(0.6)
    assert metrics["collaboration"] == pytest.approx(2 / 3)
    assert 0 <= metrics["confidence"] <= 1


def test_rejects_missing_latency_and_malformed_confidence() -> None:
    arguments = {
        "target": "truth",
        "candidates": ["truth"],
        "mappings": [{}],
        "hypotheses": [{"switchDetected": False, "confidence": 2}],
        "stationary_key": {},
        "changed_entries": [],
        "matched_controls": [],
        "entity_types": set(),
        "events": [],
        "ledgers": [],
        "agent_ids": ("agent-1",),
    }
    with pytest.raises(ValueError, match="confidence"):
        score_metrics(**arguments)

    arguments["hypotheses"] = [{"switchDetected": False}]
    with pytest.raises(ValueError, match="Latency"):
        score_metrics(**arguments)
