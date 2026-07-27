from __future__ import annotations

from typing import Any

import pytest
from palimpsest.replay.harness import _verify_progressive_reveal

AGENTS = ("agent-1", "agent-2", "agent-3")


def _chapter(index: int) -> dict[str, Any]:
    return {
        "chapterIndex": index,
        "byteLength": index * 10,
        "sha256": f"{index % 10}" * 64,
    }


def _fixture() -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    events = []
    sequence = 0
    for ordinal, offset in ((1, 0), (2, 100)):
        for agent_id in AGENTS:
            sequence += 1
            events.append(
                {
                    "producer": "reveal-control",
                    "effectId": f"reveal-{agent_id}-{ordinal}",
                    "eventType": "reveal.release",
                    "sequence": sequence,
                    "monotonicElapsedNs": str(offset * 1_000_000),
                    "payload": {
                        "agentId": agent_id,
                        "ordinal": ordinal,
                        "boundary": {"kind": "reveal", "ordinal": ordinal},
                        "scheduledOffsetMs": offset,
                        "actualOffsetMs": offset,
                        "driftMs": 0,
                    },
                }
            )

    agent_events = {}
    for number, agent_id in enumerate(AGENTS, start=1):
        initial_tip = f"{number}" * 64
        revised_tip = f"{number + 3}" * 64
        agent_events[agent_id] = [
            {
                "ordinal": 1,
                "type": "file.read",
                "payload": {
                    "path": "input/released/release-manifest.json",
                    "releaseOrdinal": 1,
                    "chapters": [_chapter(number * 10)],
                },
            },
            {"ordinal": 2, "type": "git.clone", "payload": {}},
            {
                "ordinal": 3,
                "type": "git.commit",
                "payload": {"phase": "release-1", "tip": initial_tip},
            },
            {
                "ordinal": 4,
                "type": "git.push",
                "payload": {
                    "phase": "release-1",
                    "ref": f"refs/heads/quarantine/{agent_id}/work",
                    "tip": initial_tip,
                },
            },
            {
                "ordinal": 5,
                "type": "git.fetch",
                "payload": {
                    "snapshot": "collaboration",
                    "refNamespace": "refs/heads/agents",
                    "refCount": 3,
                    "refDigest": f"{number + 6}" * 64,
                },
            },
            {
                "ordinal": 6,
                "type": "file.read",
                "payload": {
                    "path": "input/released/release-manifest.json",
                    "releaseOrdinal": 2,
                    "chapters": [
                        _chapter(number * 10),
                        _chapter(number * 10 + 1),
                    ],
                },
            },
            {
                "ordinal": 7,
                "type": "git.commit",
                "payload": {
                    "phase": "release-2-peer-revision",
                    "predecessor": initial_tip,
                    "peerSnapshotDigest": f"{number + 6}" * 64,
                    "tip": revised_tip,
                },
            },
            {
                "ordinal": 8,
                "type": "git.push",
                "payload": {
                    "phase": "release-2-peer-revision",
                    "ref": f"refs/heads/quarantine/{agent_id}/work",
                    "tip": revised_tip,
                },
            },
            {
                "ordinal": 9,
                "type": "git.fetch",
                "payload": {
                    "snapshot": "frozen",
                    "refNamespace": "refs/heads/agents",
                },
            },
        ]
    return events, agent_events


def test_reconciles_two_progressive_reveals_with_agent_revision_work() -> None:
    events, agent_events = _fixture()

    _verify_progressive_reveal(events, agent_events)


@pytest.mark.parametrize(
    "surface",
    [
        "missing-reveal",
        "timing-drift",
        "ordinal-order",
        "missing-read",
        "nonmonotone-chapters",
        "revision-predecessor",
        "push-before-revision",
    ],
)
def test_rejects_progressive_reveal_or_revision_tampering(surface: str) -> None:
    events, agent_events = _fixture()
    if surface == "missing-reveal":
        events.pop()
    elif surface == "timing-drift":
        events[1]["payload"]["actualOffsetMs"] = 1
        events[1]["payload"]["driftMs"] = 1
    elif surface == "ordinal-order":
        events[3]["sequence"] = 2
    elif surface == "missing-read":
        agent_events["agent-1"].pop(0)
    elif surface == "nonmonotone-chapters":
        agent_events["agent-1"][5]["payload"]["chapters"] = [_chapter(11)]
    elif surface == "revision-predecessor":
        agent_events["agent-1"][6]["payload"]["predecessor"] = "f" * 64
    else:
        agent_events["agent-1"][7]["ordinal"] = 6

    with pytest.raises(ValueError, match=r"reveal|Reveal|Progressive|revision|push"):
        _verify_progressive_reveal(events, agent_events)
