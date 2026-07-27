from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from palimpsest.contracts import canonical_json_bytes, sha256_hex
from palimpsest.replay.harness import (
    TRUSTED_ARTIFACT_PATHS,
    _load_publications,
    _verify_fetch_evidence,
    _visibility_journal_digest,
)

AGENTS = ("agent-1", "agent-2", "agent-3")
RUN_ID = "run-fetch-replay"


def _fixture() -> tuple[
    list[dict[str, Any]],
    dict[str, Any],
    dict[str, Any],
    dict[str, str],
    dict[str, frozenset[str]],
    list[dict[str, Any]],
]:
    main_oid = "a" * 64
    slot_refs = [
        {
            "refs/heads/main": main_oid,
            **{
                f"refs/heads/agents/{agent_id}/work": character * 64
                for agent_id, character in zip(AGENTS, "bcd", strict=True)
            },
        },
        {
            "refs/heads/main": main_oid,
            **{
                f"refs/heads/agents/{agent_id}/work": character * 64
                for agent_id, character in zip(AGENTS, "ef1", strict=True)
            },
        },
    ]
    publications = []
    visible_oids_by_snapshot: dict[str, frozenset[str]] = {}
    predecessor_snapshot_id: str | None = None
    for ordinal, (slot, refs) in enumerate(
        zip(("collaboration", "final"), slot_refs, strict=True),
        start=1,
    ):
        snapshot_id = f"publication-{ordinal:03d}"
        visible_oids = frozenset(refs.values())
        publication = {
            "schemaVersion": 1,
            "contractId": "published-snapshot",
            "runId": RUN_ID,
            "snapshotId": snapshot_id,
            "ordinal": ordinal,
            "predecessorSnapshotId": predecessor_snapshot_id,
            "refMapDigest": sha256_hex(canonical_json_bytes(refs)),
            "visibilityJournalDigest": _visibility_journal_digest(visible_oids),
            "eventSequence": ordinal * 10,
        }
        publication["snapshotDigest"] = sha256_hex(canonical_json_bytes(publication))
        publications.append(
            {
                "slot": slot,
                "publication": publication,
                "fetchPublication": {
                    "schemaVersion": 1,
                    "slot": slot,
                    "snapshot": deepcopy(publication),
                    "refs": refs,
                    "allowedOidCount": len(visible_oids),
                    "allowedOidsDigest": sha256_hex(canonical_json_bytes(sorted(visible_oids))),
                    "maxFetchesPerAgent": 2,
                },
            }
        )
        visible_oids_by_snapshot[snapshot_id] = visible_oids
        predecessor_snapshot_id = snapshot_id

    fetches = []
    events = []
    for evidence in publications:
        publication = evidence["publication"]
        refs = evidence["fetchPublication"]["refs"]
        for agent_id in AGENTS:
            tuple_body = {
                "snapshotId": publication["snapshotId"],
                "wants": [refs[f"refs/heads/agents/{agent_id}/work"]],
                "haves": [main_oid],
                "capabilityProfile": ["ofs-delta", "thin-pack"],
            }
            tuple_digest = sha256_hex(canonical_json_bytes(tuple_body))
            fetches.append(
                {
                    "schemaVersion": 1,
                    "agentId": agent_id,
                    "sequence": len(fetches) + 1,
                    "tuple": {**tuple_body, "digest": tuple_digest},
                }
            )
            if evidence["slot"] == "final":
                events.append(
                    {
                        "eventType": "worker.final-fetch",
                        "payload": {
                            "agentId": agent_id,
                            "snapshotId": publication["snapshotId"],
                            "tupleDigest": tuple_digest,
                        },
                    }
                )
    fetch_evidence = {
        "schemaVersion": 1,
        "runId": RUN_ID,
        "maxFetchesPerAgent": 2,
        "admittedFetchCounts": {agent_id: 2 for agent_id in AGENTS},
        "fetches": fetches,
    }
    final = publications[-1]["publication"]
    freeze = {
        "refMapDigest": final["refMapDigest"],
        "visibilityJournalDigest": final["visibilityJournalDigest"],
    }
    return (
        publications,
        fetch_evidence,
        freeze,
        slot_refs[-1],
        visible_oids_by_snapshot,
        events,
    )


def _verify(fixture: tuple[Any, ...]) -> None:
    _verify_fetch_evidence(*fixture, RUN_ID)


def test_reconciles_both_canonical_fetch_slots_and_artifact_order() -> None:
    fixture = _fixture()

    _verify(fixture)

    paths = [path for path, _ in TRUSTED_ARTIFACT_PATHS]
    assert paths[3:8] == [
        "git/fetch-publication-001.json",
        "git/fetch-publication-002.json",
        "git/fetches.json",
        "git/publication-001.json",
        "git/publication-002.json",
    ]


@pytest.mark.parametrize(
    ("surface", "value"),
    [
        ("allowed-count", 5),
        ("allowed-digest", "f" * 64),
        ("publication-max", 1),
    ],
)
def test_rejects_fetch_publication_tampering(surface: str, value: Any) -> None:
    fixture = list(_fixture())
    fetch_publication = fixture[0][0]["fetchPublication"]
    if surface == "allowed-count":
        fetch_publication["allowedOidCount"] = value
    elif surface == "allowed-digest":
        fetch_publication["allowedOidsDigest"] = value
    else:
        fetch_publication["maxFetchesPerAgent"] = value

    with pytest.raises(ValueError, match="fetch publication"):
        _verify(tuple(fixture))


@pytest.mark.parametrize(
    "surface",
    ["count", "sequence", "tuple-digest", "want", "have", "worker-seal"],
)
def test_rejects_canonical_fetch_or_worker_seal_tampering(surface: str) -> None:
    fixture = list(_fixture())
    fetch_evidence = fixture[1]
    events = fixture[5]
    if surface == "count":
        fetch_evidence["admittedFetchCounts"]["agent-1"] = 1
    elif surface == "sequence":
        fetch_evidence["fetches"][0]["sequence"] = 2
    elif surface == "tuple-digest":
        fetch_evidence["fetches"][0]["tuple"]["digest"] = "f" * 64
    elif surface == "want":
        fetch_evidence["fetches"][0]["tuple"]["wants"] = ["9" * 64]
    elif surface == "have":
        fetch_evidence["fetches"][0]["tuple"]["haves"] = ["8" * 64]
    else:
        events[0]["payload"]["tupleDigest"] = "7" * 64

    with pytest.raises(ValueError, match=r"fetch|Fetch"):
        _verify(tuple(fixture))


def test_loads_two_slot_publications_with_exact_event_sequence_binding(tmp_path: Path) -> None:
    publications, _, freeze, _, _, _ = _fixture()
    attempt = tmp_path / "attempt"
    (attempt / "git").mkdir(parents=True)
    events = [{"eventType": "fixture", "payload": {}} for _ in range(21)]
    for evidence in publications:
        publication = evidence["publication"]
        ordinal = publication["ordinal"]
        suffix = f"{ordinal:03d}"
        (attempt / f"git/publication-{suffix}.json").write_bytes(canonical_json_bytes(publication))
        (attempt / f"git/fetch-publication-{suffix}.json").write_bytes(
            canonical_json_bytes(evidence["fetchPublication"])
        )
        events[publication["eventSequence"]] = {
            "eventType": "git.publication",
            "payload": {"snapshotId": publication["snapshotId"]},
        }
    freeze["finalEventSequence"] = len(events) + 1

    loaded = _load_publications(attempt, RUN_ID, freeze, events)

    assert [entry["slot"] for entry in loaded] == ["collaboration", "final"]
    events[20]["payload"]["snapshotId"] = "publication-001"
    with pytest.raises(ValueError, match="final publication"):
        _load_publications(attempt, RUN_ID, freeze, events)
