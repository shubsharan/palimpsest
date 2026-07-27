from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex, validate_value
from palimpsest.grading.score_report import build_score_report
from palimpsest.solver.executor import verify_frozen_submissions

AGENT_IDS = ("agent-1", "agent-2", "agent-3")
EXPECTED_AGENTS = frozenset(AGENT_IDS)
PUBLICATION_SLOTS = (("collaboration", 1), ("final", 2))
TRUSTED_ARTIFACT_PATHS = (
    ("run-manifest.json", "run-manifest"),
    ("live.jsonl", "run-event-stream"),
    ("git/drain.json", "git-drain-evidence"),
    ("git/fetch-publication-001.json", "git-fetch-publication"),
    ("git/fetch-publication-002.json", "git-fetch-publication"),
    ("git/fetches.json", "git-fetch-evidence"),
    ("git/publication-001.json", "published-snapshot"),
    ("git/publication-002.json", "published-snapshot"),
    ("git/ledgers.json", "git-ledgers"),
    ("git/freeze.json", "freeze-snapshot"),
    ("git/frozen.bundle", "git-bundle"),
    ("agents/agent-1/events.json", "agent-event-stream"),
    ("agents/agent-2/events.json", "agent-event-stream"),
    ("agents/agent-3/events.json", "agent-event-stream"),
    ("submissions.json", "private-submissions"),
    ("grading/solver-executions.json", "solver-executions"),
    ("grading/score-report.json", "score-report"),
)


def _artifact(path: Path, artifact_type: str) -> dict[str, Any]:
    content = path.read_bytes()
    return {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _validate(contract_id: str, value: Any) -> None:
    verdict = validate_value(contract_id, value)
    if not verdict.accepted:
        raise ValueError(f"{contract_id} is invalid: {verdict.reason} at {verdict.pointer}")


def _visibility_journal_digest(oids: frozenset[str]) -> str:
    digest = hashlib.sha256()
    digest.update(b"PalimpsestVisibilityJournalV1\0")
    for oid in sorted(oids):
        digest.update(bytes.fromhex(oid))
    return digest.hexdigest()


def _verify_events(path: Path, run_id: str) -> tuple[list[dict[str, Any]], str]:
    previous = None
    effects: set[str] = set()
    events = []
    for sequence, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        event = json.loads(line)
        _validate("run-event", event)
        if (
            event["runId"] != run_id
            or event["sequence"] != sequence
            or event["previousDigest"] != previous
            or event["effectId"] in effects
        ):
            raise ValueError("Run event identity, order, predecessor, or effect ID is invalid.")
        digest = event.pop("digest")
        if sha256_hex(canonical_json_bytes(event)) != digest:
            raise ValueError("Run event digest mismatch.")
        event["digest"] = digest
        previous = digest
        effects.add(event["effectId"])
        events.append(event)
    if previous is None:
        raise ValueError("Run event stream is empty.")
    return events, previous


def _verify_git_bundle(
    path: Path,
    freeze: dict[str, Any],
    publication_refs: dict[str, dict[str, str]],
) -> tuple[dict[str, str], dict[str, frozenset[str]]]:
    content = path.read_bytes()
    reference = freeze["gitBundle"]
    if len(content) != reference["byteLength"] or sha256_hex(content) != reference["sha256"]:
        raise ValueError("Frozen Git bundle does not match its artifact reference.")
    subprocess.run(["git", "bundle", "verify", str(path)], check=True, capture_output=True)
    heads = subprocess.run(
        ["git", "bundle", "list-heads", str(path)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    refs = {
        reference_name: object_id
        for object_id, reference_name in (line.split(maxsplit=1) for line in heads)
        if reference_name.startswith("refs/")
    }
    if sha256_hex(canonical_json_bytes(refs)) != freeze["refMapDigest"]:
        raise ValueError("Frozen Git refs do not match the declared ref-map digest.")
    with tempfile.TemporaryDirectory(prefix="palimpsest-replay-git-") as temporary:
        mirror = Path(temporary) / "mirror.git"
        subprocess.run(
            ["git", "clone", "--quiet", "--mirror", str(path), str(mirror)],
            check=True,
            capture_output=True,
        )
        visible_oids_by_snapshot = {
            snapshot_id: frozenset(
                subprocess.run(
                    [
                        "git",
                        "-C",
                        str(mirror),
                        "rev-list",
                        "--objects",
                        "--no-object-names",
                        *snapshot_refs.values(),
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout.splitlines()
            )
            for snapshot_id, snapshot_refs in publication_refs.items()
        }
    if any(
        not visible_oids
        or any(
            len(oid) != 64 or any(character not in "0123456789abcdef" for character in oid)
            for oid in visible_oids
        )
        for visible_oids in visible_oids_by_snapshot.values()
    ):
        raise ValueError("Frozen Git bundle contains an invalid publication object set.")
    return refs, visible_oids_by_snapshot


def _verify_ledgers(entries: list[dict[str, Any]], freeze: dict[str, Any], run_id: str) -> None:
    if sha256_hex(canonical_json_bytes(entries)) != freeze["ledgerDigest"]:
        raise ValueError("Ledger digest does not match the freeze snapshot.")
    remaining: dict[str, int] = {}
    transactions: set[str] = set()
    for entry in entries:
        _validate("push-ledger-entry", entry)
        if entry["runId"] != run_id or entry["transactionId"] in transactions:
            raise ValueError("Ledger run identity or transaction uniqueness is invalid.")
        prior = remaining.get(entry["agentId"], entry["budgetBefore"])
        expected_after = (
            entry["budgetBefore"] - entry["chargeBytes"]
            if entry["result"] == "accepted"
            else entry["budgetBefore"]
        )
        if prior != entry["budgetBefore"] or expected_after != entry["budgetAfter"]:
            raise ValueError("Ledger cumulative budget transition is invalid.")
        remaining[entry["agentId"]] = entry["budgetAfter"]
        transactions.add(entry["transactionId"])


def _verify_drain(drain: Any, ledgers: list[dict[str, Any]], run_id: str) -> None:
    expected_keys = {
        "schemaVersion",
        "runId",
        "pendingReceives",
        "pendingReservations",
        "ledgerEntryCount",
        "policy",
    }
    policy = drain.get("policy") if isinstance(drain, dict) else None
    repositories = policy.get("inspectedRepositories") if isinstance(policy, dict) else None
    resource_limits = policy.get("resourceLimits") if isinstance(policy, dict) else None
    inspected = (
        [repositories.get(agent_id) for agent_id in AGENT_IDS]
        if isinstance(repositories, dict) and set(repositories) == EXPECTED_AGENTS
        else []
    )
    expected_hidden_refs = ["refs/heads/agents", "refs/heads/quarantine"]
    expected_resource_limits = {
        "maxFetchesPerAgent": 2,
        "maxReceiveAttemptsPerAgent": 2,
        "maxReceiveBodyBytes": 8 * 1024 * 1024,
        "receiveTimeoutMs": 30_000,
    }
    if (
        not isinstance(drain, dict)
        or set(drain) != expected_keys
        or type(drain["schemaVersion"]) is not int
        or drain["schemaVersion"] != 1
        or drain["runId"] != run_id
        or type(drain["pendingReceives"]) is not int
        or drain["pendingReceives"] != 0
        or type(drain["pendingReservations"]) is not int
        or drain["pendingReservations"] != 0
        or type(drain["ledgerEntryCount"]) is not int
        or drain["ledgerEntryCount"] != 6
        or len(ledgers) != 6
        or {ledger.get("agentId") for ledger in ledgers} != EXPECTED_AGENTS
        or any(
            sum(ledger.get("agentId") == agent_id for ledger in ledgers) != 2
            for agent_id in AGENT_IDS
        )
        or not isinstance(policy, dict)
        or set(policy)
        != {
            "schemaVersion",
            "resourceLimits",
            "perAgentPrivateObjectDatabases",
            "inspectedRepositories",
        }
        or type(policy["schemaVersion"]) is not int
        or policy["schemaVersion"] != 2
        or not isinstance(resource_limits, dict)
        or any(type(value) is not int for value in resource_limits.values())
        or resource_limits != expected_resource_limits
        or policy["perAgentPrivateObjectDatabases"] is not True
        or len(inspected) != 3
        or any(
            not isinstance(entry, dict)
            or set(entry)
            != {
                "gitDirectory",
                "objectDirectory",
                "hooksPath",
                "alternates",
                "receiveHiddenRefs",
                "uploadHiddenRefs",
                "quarantineRefCount",
            }
            or not isinstance(entry["gitDirectory"], str)
            or not entry["gitDirectory"]
            or not isinstance(entry["objectDirectory"], str)
            or not entry["objectDirectory"]
            or not isinstance(entry["hooksPath"], str)
            or not entry["hooksPath"].startswith("/run/palimpsest-hooks/")
            or entry["alternates"] != []
            or entry["receiveHiddenRefs"] != expected_hidden_refs
            or entry["uploadHiddenRefs"] != expected_hidden_refs
            or type(entry["quarantineRefCount"]) is not int
            or entry["quarantineRefCount"] != 0
            for entry in inspected
        )
        or len({entry["gitDirectory"] for entry in inspected}) != 3
        or len({entry["objectDirectory"] for entry in inspected}) != 3
        or len({entry["hooksPath"] for entry in inspected}) != 3
    ):
        raise ValueError(
            "Git drain evidence must prove zero pending work, two ledgers per agent, "
            "and policy v2 isolation."
        )


def _load_agent_events(
    attempt: Path, run_id: str, events: list[dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    trusted_fetches = [event for event in events if event["eventType"] == "worker.final-fetch"]
    if len(trusted_fetches) != 3:
        raise ValueError("Replay requires exactly three trusted worker final-fetch events.")
    trusted_by_agent: dict[str, dict[str, Any]] = {}
    for event in trusted_fetches:
        payload = event["payload"]
        agent_id = payload.get("agentId")
        if (
            event["producer"] != "model-bridge"
            or agent_id not in EXPECTED_AGENTS
            or agent_id in trusted_by_agent
            or event["effectId"] != f"worker-{agent_id}-final-fetch"
            or set(payload) != {"agentId", "invocationId", "ordinal", "snapshotId", "tupleDigest"}
            or not isinstance(payload.get("invocationId"), str)
            or type(payload.get("ordinal")) is not int
            or not isinstance(payload.get("snapshotId"), str)
            or not isinstance(payload.get("tupleDigest"), str)
            or len(payload["tupleDigest"]) != 64
            or any(character not in "0123456789abcdef" for character in payload["tupleDigest"])
        ):
            raise ValueError("Trusted worker final-fetch event identity is invalid.")
        trusted_by_agent[agent_id] = event
    if trusted_by_agent.keys() != EXPECTED_AGENTS:
        raise ValueError("Replay requires one trusted final-fetch event per declared agent.")

    loaded: dict[str, list[dict[str, Any]]] = {}
    expected_keys = {
        "schemaVersion",
        "runId",
        "agentId",
        "invocationId",
        "ordinal",
        "type",
        "payload",
    }
    for agent_id in AGENT_IDS:
        agent_events = _json(attempt / "agents" / agent_id / "events.json")
        if not isinstance(agent_events, list) or not agent_events:
            raise ValueError(f"Agent event stream is missing or invalid for {agent_id}.")
        invocation_id: str | None = None
        for ordinal, event in enumerate(agent_events, start=1):
            if (
                not isinstance(event, dict)
                or set(event) != expected_keys
                or type(event["schemaVersion"]) is not int
                or event["schemaVersion"] != 1
                or event["runId"] != run_id
                or event["agentId"] != agent_id
                or not isinstance(event["invocationId"], str)
                or not event["invocationId"]
                or type(event["ordinal"]) is not int
                or event["ordinal"] != ordinal
                or not isinstance(event["type"], str)
                or not isinstance(event["payload"], dict)
                or "reasoning" in event["payload"]
                or "chainOfThought" in event["payload"]
            ):
                raise ValueError(f"Agent event identity or ordering is invalid for {agent_id}.")
            invocation_id = invocation_id or event["invocationId"]
            if event["invocationId"] != invocation_id:
                raise ValueError(
                    f"Agent event invocation changed within the stream for {agent_id}."
                )

        final_fetches = [
            event
            for event in agent_events
            if event["type"] == "git.fetch" and event["payload"].get("snapshot") == "frozen"
        ]
        if (
            len(final_fetches) != 1
            or set(final_fetches[0]["payload"]) != {"snapshot", "refNamespace"}
            or final_fetches[0]["payload"].get("snapshot") != "frozen"
            or final_fetches[0]["payload"].get("refNamespace") != "refs/heads/agents"
        ):
            raise ValueError(f"Agent event stream lacks one exact frozen Git fetch for {agent_id}.")
        trusted = trusted_by_agent[agent_id]["payload"]
        final_fetch = final_fetches[0]
        if (
            final_fetch["invocationId"] != trusted["invocationId"]
            or final_fetch["ordinal"] != trusted["ordinal"]
        ):
            raise ValueError(f"Agent frozen fetch does not match trusted evidence for {agent_id}.")
        loaded[agent_id] = agent_events
    return loaded


def _load_publications(
    attempt: Path,
    run_id: str,
    freeze: dict[str, Any],
    events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    publications: list[dict[str, Any]] = []
    previous_event_sequence = -1
    previous_snapshot_id: str | None = None
    for slot, ordinal in PUBLICATION_SLOTS:
        suffix = f"{ordinal:03d}"
        publication = _json(attempt / f"git/publication-{suffix}.json")
        fetch_publication = _json(attempt / f"git/fetch-publication-{suffix}.json")
        _validate("published-snapshot", publication)
        fetch_snapshot = (
            fetch_publication.get("snapshot") if isinstance(fetch_publication, dict) else None
        )
        refs = fetch_publication.get("refs") if isinstance(fetch_publication, dict) else None
        if (
            publication["runId"] != run_id
            or publication["ordinal"] != ordinal
            or publication["snapshotId"] != f"publication-{suffix}"
            or publication["predecessorSnapshotId"] != previous_snapshot_id
            or publication["snapshotDigest"]
            != sha256_hex(
                canonical_json_bytes(
                    {key: value for key, value in publication.items() if key != "snapshotDigest"}
                )
            )
            or publication["eventSequence"] <= previous_event_sequence
            or publication["eventSequence"] >= freeze["finalEventSequence"]
            or not isinstance(fetch_publication, dict)
            or set(fetch_publication)
            != {
                "schemaVersion",
                "slot",
                "snapshot",
                "refs",
                "allowedOidCount",
                "allowedOidsDigest",
                "maxFetchesPerAgent",
            }
            or type(fetch_publication["schemaVersion"]) is not int
            or fetch_publication["schemaVersion"] != 1
            or fetch_publication["slot"] != slot
            or fetch_snapshot != publication
            or not isinstance(refs, dict)
            or not refs
            or any(
                not isinstance(ref_name, str)
                or not isinstance(oid, str)
                or len(oid) != 64
                or any(character not in "0123456789abcdef" for character in oid)
                for ref_name, oid in refs.items()
            )
            or sha256_hex(canonical_json_bytes(refs)) != publication["refMapDigest"]
            or type(fetch_publication["maxFetchesPerAgent"]) is not int
            or fetch_publication["maxFetchesPerAgent"] != 2
        ):
            raise ValueError(f"Canonical {slot} publication evidence is invalid.")
        _validate("published-snapshot", fetch_snapshot)
        publication_event_sequence = publication["eventSequence"] + 1
        if (
            publication_event_sequence > len(events)
            or (publication_event := events[publication_event_sequence - 1])["eventType"]
            != "git.publication"
            or publication_event["payload"].get("snapshotId") != publication["snapshotId"]
        ):
            raise ValueError(f"Canonical {slot} publication is not bound to its run event.")
        publications.append(
            {
                "slot": slot,
                "publication": publication,
                "fetchPublication": fetch_publication,
            }
        )
        previous_event_sequence = publication["eventSequence"]
        previous_snapshot_id = publication["snapshotId"]
    final = publications[-1]["publication"]
    if (
        final["refMapDigest"] != freeze["refMapDigest"]
        or final["visibilityJournalDigest"] != freeze["visibilityJournalDigest"]
    ):
        raise ValueError("Final publication does not reconcile with the freeze snapshot.")
    return publications


def _verify_fetch_evidence(
    publications: list[dict[str, Any]],
    fetch_evidence: Any,
    freeze: dict[str, Any],
    frozen_refs: dict[str, str],
    visible_oids_by_snapshot: dict[str, frozenset[str]],
    events: list[dict[str, Any]],
    run_id: str,
) -> None:
    by_snapshot = {evidence["publication"]["snapshotId"]: evidence for evidence in publications}
    for snapshot_id, evidence in by_snapshot.items():
        fetch_publication = evidence["fetchPublication"]
        visible_oids = visible_oids_by_snapshot.get(snapshot_id)
        if (
            visible_oids is None
            or fetch_publication["maxFetchesPerAgent"] != 2
            or type(fetch_publication["allowedOidCount"]) is not int
            or fetch_publication["allowedOidCount"] != len(visible_oids)
            or not isinstance(fetch_publication["allowedOidsDigest"], str)
            or fetch_publication["allowedOidsDigest"]
            != sha256_hex(canonical_json_bytes(sorted(visible_oids)))
            or evidence["publication"]["visibilityJournalDigest"]
            != _visibility_journal_digest(visible_oids)
        ):
            raise ValueError(
                f"Canonical {evidence['slot']} fetch publication object evidence is invalid."
            )
    final_publication = publications[-1]["publication"]
    if publications[-1]["fetchPublication"]["refs"] != frozen_refs:
        raise ValueError("Final fetch publication refs do not match the frozen Git refs.")

    if (
        not isinstance(fetch_evidence, dict)
        or set(fetch_evidence)
        != {
            "schemaVersion",
            "runId",
            "maxFetchesPerAgent",
            "admittedFetchCounts",
            "fetches",
        }
        or type(fetch_evidence["schemaVersion"]) is not int
        or fetch_evidence["schemaVersion"] != 1
        or fetch_evidence["runId"] != run_id
        or type(fetch_evidence["maxFetchesPerAgent"]) is not int
        or fetch_evidence["maxFetchesPerAgent"] != 2
        or not isinstance(fetch_evidence["admittedFetchCounts"], dict)
        or set(fetch_evidence["admittedFetchCounts"]) != EXPECTED_AGENTS
        or any(
            type(count) is not int or count != 2
            for count in fetch_evidence["admittedFetchCounts"].values()
        )
        or not isinstance(fetch_evidence["fetches"], list)
        or len(fetch_evidence["fetches"]) != 6
    ):
        raise ValueError("Canonical fetch evidence must contain both fetches per declared agent.")

    by_agent_snapshot: dict[tuple[str, str], dict[str, Any]] = {}
    for sequence, fetch in enumerate(fetch_evidence["fetches"], start=1):
        tuple_record = fetch.get("tuple") if isinstance(fetch, dict) else None
        snapshot_id = tuple_record.get("snapshotId") if isinstance(tuple_record, dict) else None
        identity = (fetch.get("agentId"), snapshot_id) if isinstance(fetch, dict) else None
        if (
            not isinstance(fetch, dict)
            or set(fetch) != {"schemaVersion", "agentId", "sequence", "tuple"}
            or type(fetch["schemaVersion"]) is not int
            or fetch["schemaVersion"] != 1
            or fetch["agentId"] not in EXPECTED_AGENTS
            or identity in by_agent_snapshot
            or type(fetch["sequence"]) is not int
            or fetch["sequence"] != sequence
            or not isinstance(fetch["tuple"], dict)
            or set(fetch["tuple"])
            != {"snapshotId", "wants", "haves", "capabilityProfile", "digest"}
        ):
            raise ValueError("Canonical fetch identity or sequence is invalid.")
        tuple_record = fetch["tuple"]
        publication_evidence = by_snapshot.get(tuple_record["snapshotId"])
        if publication_evidence is None:
            raise ValueError("Canonical fetch references an unknown publication snapshot.")
        advertised_oids = frozenset(publication_evidence["fetchPublication"]["refs"].values())
        visible_oids = visible_oids_by_snapshot[tuple_record["snapshotId"]]
        wants = tuple_record["wants"]
        haves = tuple_record["haves"]
        capabilities = tuple_record["capabilityProfile"]
        if (
            not isinstance(wants, list)
            or not wants
            or not isinstance(haves, list)
            or not isinstance(capabilities, list)
            or any(not isinstance(value, str) for value in wants + haves + capabilities)
            or wants != sorted(set(wants))
            or haves != sorted(set(haves))
            or capabilities != sorted(set(capabilities))
            or any(oid not in advertised_oids for oid in wants)
            or any(oid not in visible_oids for oid in haves)
        ):
            raise ValueError("Canonical fetch tuple is not valid for the frozen Git view.")
        body = {
            "snapshotId": tuple_record["snapshotId"],
            "wants": wants,
            "haves": haves,
            "capabilityProfile": capabilities,
        }
        if tuple_record["digest"] != sha256_hex(canonical_json_bytes(body)):
            raise ValueError("Canonical fetch tuple digest mismatch.")
        by_agent_snapshot[(fetch["agentId"], tuple_record["snapshotId"])] = fetch
    expected_fetch_identities = {
        (agent_id, snapshot_id) for agent_id in AGENT_IDS for snapshot_id in by_snapshot
    }
    if by_agent_snapshot.keys() != expected_fetch_identities:
        raise ValueError("Canonical fetch evidence does not cover every agent and publication.")

    final_fetches = [event for event in events if event["eventType"] == "worker.final-fetch"]
    if len(final_fetches) != 3:
        raise ValueError("Canonical fetch replay requires three trusted worker fetch seals.")
    for event in final_fetches:
        payload = event["payload"]
        fetch = by_agent_snapshot.get((payload.get("agentId"), final_publication["snapshotId"]))
        if (
            not fetch
            or payload.get("snapshotId") != fetch["tuple"]["snapshotId"]
            or payload.get("tupleDigest") != fetch["tuple"]["digest"]
        ):
            raise ValueError("Trusted worker final-fetch seal does not match canonical fetch.")


def _verify_progressive_reveal(
    events: list[dict[str, Any]],
    agent_events: dict[str, list[dict[str, Any]]],
) -> None:
    reveals = [event for event in events if event["eventType"] == "reveal.release"]
    if len(reveals) != 6:
        raise ValueError("Replay requires exactly six trusted progressive reveal events.")
    reveal_by_key: dict[tuple[str, int], dict[str, Any]] = {}
    observations: dict[int, bytes] = {}
    sequences: dict[int, list[int]] = {1: [], 2: []}
    monotonic_times: dict[int, list[int]] = {1: [], 2: []}
    for event in reveals:
        payload = event["payload"]
        agent_id = payload.get("agentId")
        ordinal = payload.get("ordinal")
        boundary = payload.get("boundary")
        numeric_fields = [
            payload.get("scheduledOffsetMs"),
            payload.get("actualOffsetMs"),
            payload.get("driftMs"),
        ]
        if (
            event["producer"] != "reveal-control"
            or agent_id not in EXPECTED_AGENTS
            or type(ordinal) is not int
            or ordinal not in {1, 2}
            or (agent_id, ordinal) in reveal_by_key
            or event["effectId"] != f"reveal-{agent_id}-{ordinal}"
            or set(payload)
            != {
                "agentId",
                "ordinal",
                "boundary",
                "scheduledOffsetMs",
                "actualOffsetMs",
                "driftMs",
            }
            or not isinstance(boundary, dict)
            or boundary != {"kind": "reveal", "ordinal": ordinal}
            or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                for value in numeric_fields
            )
            or payload["scheduledOffsetMs"] < 0
            or payload["actualOffsetMs"] < 0
            or not math.isclose(
                payload["actualOffsetMs"] - payload["scheduledOffsetMs"],
                payload["driftMs"],
                abs_tol=1e-6,
            )
            or type(event["sequence"]) is not int
            or not isinstance(event["monotonicElapsedNs"], str)
            or not event["monotonicElapsedNs"].isdigit()
        ):
            raise ValueError("Trusted progressive reveal identity or timing is invalid.")
        reveal_by_key[agent_id, ordinal] = event
        observation = {
            key: payload[key]
            for key in (
                "ordinal",
                "boundary",
                "scheduledOffsetMs",
                "actualOffsetMs",
                "driftMs",
            )
        }
        encoded = canonical_json_bytes(observation)
        prior = observations.setdefault(ordinal, encoded)
        if prior != encoded:
            raise ValueError("Trusted reveal timing differs across agents.")
        sequences[ordinal].append(event["sequence"])
        monotonic_times[ordinal].append(int(event["monotonicElapsedNs"]))
    if set(reveal_by_key) != {(agent_id, ordinal) for agent_id in AGENT_IDS for ordinal in (1, 2)}:
        raise ValueError("Trusted progressive reveals do not cover every agent and ordinal.")
    first = json.loads(observations[1])
    second = json.loads(observations[2])
    if (
        first["scheduledOffsetMs"] >= second["scheduledOffsetMs"]
        or first["actualOffsetMs"] > second["actualOffsetMs"]
        or max(sequences[1]) >= min(sequences[2])
        or max(monotonic_times[1]) > min(monotonic_times[2])
    ):
        raise ValueError("Trusted progressive reveal ordinals are not time ordered.")

    for agent_id in AGENT_IDS:
        stream = agent_events.get(agent_id)
        if not stream:
            raise ValueError(f"Progressive agent evidence is missing for {agent_id}.")
        reads = [event for event in stream if event["type"] == "file.read"]
        commits = [event for event in stream if event["type"] == "git.commit"]
        pushes = [event for event in stream if event["type"] == "git.push"]
        fetches = [event for event in stream if event["type"] == "git.fetch"]
        if len(reads) != 2 or len(commits) != 2 or len(pushes) != 2 or len(fetches) != 2:
            raise ValueError(
                "Progressive agent evidence requires two reads, commits, pushes, and fetches: "
                f"{agent_id}."
            )
        chapter_sets: list[dict[int, dict[str, Any]]] = []
        for ordinal, read in enumerate(reads, start=1):
            payload = read["payload"]
            chapters = payload.get("chapters")
            if (
                set(payload) != {"path", "releaseOrdinal", "chapters"}
                or payload["path"] != "input/released/release-manifest.json"
                or payload["releaseOrdinal"] != ordinal
                or not isinstance(chapters, list)
                or not chapters
            ):
                raise ValueError(f"Progressive release read is invalid for {agent_id}.")
            chapter_map: dict[int, dict[str, Any]] = {}
            for chapter in chapters:
                if (
                    not isinstance(chapter, dict)
                    or set(chapter) != {"chapterIndex", "byteLength", "sha256"}
                    or type(chapter["chapterIndex"]) is not int
                    or chapter["chapterIndex"] < 0
                    or chapter["chapterIndex"] in chapter_map
                    or type(chapter["byteLength"]) is not int
                    or chapter["byteLength"] < 0
                    or not isinstance(chapter["sha256"], str)
                    or len(chapter["sha256"]) != 64
                    or any(character not in "0123456789abcdef" for character in chapter["sha256"])
                ):
                    raise ValueError(
                        f"Progressive release chapter evidence is invalid: {agent_id}."
                    )
                chapter_map[chapter["chapterIndex"]] = chapter
            if list(chapter_map) != sorted(chapter_map):
                raise ValueError(f"Progressive release chapters are not ordered for {agent_id}.")
            chapter_sets.append(chapter_map)
        if not chapter_sets[0].keys() < chapter_sets[1].keys() or any(
            chapter_sets[1][chapter_index] != chapter
            for chapter_index, chapter in chapter_sets[0].items()
        ):
            raise ValueError(f"Second release is not a monotone revision for {agent_id}.")

        initial = commits[0]
        revision = commits[1]
        initial_push, revision_push = pushes
        collaboration_fetch, final_fetch = fetches
        collaboration_payload = collaboration_fetch["payload"]
        collaboration_digest = collaboration_payload.get("refDigest")
        if (
            set(initial["payload"]) != {"phase", "tip"}
            or initial["payload"]["phase"] != "release-1"
            or set(initial_push["payload"]) != {"phase", "ref", "tip"}
            or initial_push["payload"]["phase"] != "release-1"
            or initial_push["payload"]["ref"] != f"refs/heads/quarantine/{agent_id}/work"
            or initial_push["payload"]["tip"] != initial["payload"]["tip"]
            or set(collaboration_payload) != {"snapshot", "refNamespace", "refCount", "refDigest"}
            or collaboration_payload["snapshot"] != "collaboration"
            or collaboration_payload["refNamespace"] != "refs/heads/agents"
            or collaboration_payload["refCount"] != 3
            or not isinstance(collaboration_digest, str)
            or len(collaboration_digest) != 64
            or any(character not in "0123456789abcdef" for character in collaboration_digest)
            or set(revision["payload"]) != {"phase", "predecessor", "peerSnapshotDigest", "tip"}
            or revision["payload"]["phase"] != "release-2-peer-revision"
            or revision["payload"]["predecessor"] != initial["payload"]["tip"]
            or revision["payload"]["peerSnapshotDigest"] != collaboration_digest
            or revision["payload"]["tip"] == initial["payload"]["tip"]
            or any(
                not isinstance(tip, str)
                or len(tip) != 64
                or any(character not in "0123456789abcdef" for character in tip)
                for tip in (initial["payload"]["tip"], revision["payload"]["tip"])
            )
            or set(revision_push["payload"]) != {"phase", "ref", "tip"}
            or revision_push["payload"]["phase"] != "release-2-peer-revision"
            or revision_push["payload"]["ref"] != f"refs/heads/quarantine/{agent_id}/work"
            or revision_push["payload"]["tip"] != revision["payload"]["tip"]
            or final_fetch["payload"] != {"snapshot": "frozen", "refNamespace": "refs/heads/agents"}
            or not (
                reads[0]["ordinal"]
                < initial["ordinal"]
                < initial_push["ordinal"]
                < collaboration_fetch["ordinal"]
                < reads[1]["ordinal"]
                < revision["ordinal"]
                < revision_push["ordinal"]
                < final_fetch["ordinal"]
            )
        ):
            raise ValueError(
                f"Progressive release commit/revision/push order is invalid: {agent_id}."
            )


def _verify_admission_events(events: list[dict[str, Any]], ledgers: list[dict[str, Any]]) -> None:
    admissions = [event for event in events if event["eventType"] == "git.admission"]
    if len(admissions) != 6:
        raise ValueError("Replay requires exactly two trusted Git admissions per agent.")
    by_transaction: dict[str, dict[str, Any]] = {}
    for event in admissions:
        payload = event["payload"]
        transaction_id = payload.get("transactionId")
        if (
            event["producer"] != "git-gateway"
            or not isinstance(transaction_id, str)
            or transaction_id in by_transaction
            or event["effectId"] != f"admission-{transaction_id}"
            or set(payload) != {"agentId", "transactionId", "frameDigest", "chargeBytes", "result"}
        ):
            raise ValueError("Trusted Git admission event identity is invalid.")
        by_transaction[transaction_id] = event
    for ledger in ledgers:
        event = by_transaction.get(ledger["transactionId"])
        if not event:
            raise ValueError("Trusted Git admission events do not cover every ledger.")
        payload = event["payload"]
        if any(
            payload.get(field) != ledger[field]
            for field in ("agentId", "transactionId", "frameDigest", "chargeBytes", "result")
        ):
            raise ValueError("Trusted Git admission event does not match its ledger.")
    if len(by_transaction) != len(ledgers):
        raise ValueError("Trusted Git admission events contain an undeclared ledger.")
    if any(
        sum(event["payload"]["agentId"] == agent_id for event in admissions) != 2
        for agent_id in AGENT_IDS
    ):
        raise ValueError("Trusted Git admissions do not contain two events per agent.")


def _verify_submission_events(
    events: list[dict[str, Any]],
    submissions: list[dict[str, Any]],
    freeze: dict[str, Any],
) -> None:
    seals = [event for event in events if event["eventType"] == "submission.sealed"]
    if len(seals) != 3:
        raise ValueError("Replay requires exactly three trusted submission seal events.")
    by_agent: dict[str, dict[str, Any]] = {}
    for event in seals:
        payload = event["payload"]
        agent_id = payload.get("agentId")
        if (
            event["producer"] != "submission-service"
            or agent_id not in EXPECTED_AGENTS
            or agent_id in by_agent
            or event["effectId"] != f"submission-{agent_id}"
            or set(payload)
            != {
                "agentId",
                "freezeId",
                "releasedShardDigest",
                "manifestDigest",
            }
        ):
            raise ValueError("Trusted submission seal event identity is invalid.")
        by_agent[agent_id] = event
    for submission in submissions:
        agent_id = submission["agentId"]
        event = by_agent.get(agent_id)
        if not event:
            raise ValueError("Trusted submission seals do not cover every submission.")
        payload = event["payload"]
        if (
            payload.get("freezeId") != freeze["freezeId"]
            or payload.get("freezeId") != submission["freezeId"]
            or payload.get("releasedShardDigest") != submission["releasedShardDigest"]
            or payload.get("manifestDigest") != sha256_hex(canonical_json_bytes(submission))
        ):
            raise ValueError("Trusted submission seal event does not match sealed evidence.")
    if by_agent.keys() != EXPECTED_AGENTS:
        raise ValueError("Replay requires one trusted submission seal per declared agent.")


def _verify_submissions(
    attempt: Path,
    submissions: list[dict[str, Any]],
    run_id: str,
    freeze: dict[str, Any],
) -> None:
    verify_frozen_submissions(attempt, submissions, run_id, freeze)


def _verify_solver_executions(attempt: Path, executions: list[dict[str, Any]], run_id: str) -> None:
    if len(executions) != 3:
        raise ValueError("Replay requires exactly three clean-solver executions.")
    agents: set[str] = set()
    for execution in executions:
        _validate("solver-execution", execution)
        if execution["runId"] != run_id:
            raise ValueError("Solver execution run identity mismatch.")
        agent_id = execution["executionId"].removesuffix("-clean-solver-001")
        if agent_id in agents:
            raise ValueError("Clean-solver execution agent identity is duplicated.")
        agents.add(agent_id)
        root = attempt / "grading" / "solver-output" / agent_id
        actual = [
            {
                "path": path.relative_to(root).as_posix(),
                "byteLength": len(content := path.read_bytes()),
                "sha256": sha256_hex(content),
            }
            for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file())
        ]
        if canonical_json_bytes(actual) != canonical_json_bytes(execution["outputs"]):
            raise ValueError("Clean-solver exact output set does not match execution evidence.")
    if agents != {"agent-1", "agent-2", "agent-3"}:
        raise ValueError("Replay requires one clean-solver execution per declared agent.")


def replay_attempt(
    run_id: str, attempt: Path, bundle: Path = Path("artifacts/harness/declared")
) -> dict[str, Any]:
    run_manifest = _json(attempt / "run-manifest.json")
    _validate("run-manifest", run_manifest)
    if run_manifest["runId"] != run_id:
        raise ValueError("Run manifest identity mismatch.")
    events, event_head = _verify_events(attempt / "live.jsonl", run_id)
    freeze_path = attempt / "git/freeze.json"
    freeze = _json(freeze_path)
    _validate("freeze-snapshot", freeze)
    if freeze["runId"] != run_id:
        raise ValueError("Freeze run identity mismatch.")
    sequence = freeze["finalEventSequence"]
    if (
        sequence < 1
        or sequence > len(events)
        or events[sequence - 1]["digest"] != freeze["eventChainHead"]
    ):
        raise ValueError("Freeze event-chain identity does not match the sealed event prefix.")
    publications = _load_publications(attempt, run_id, freeze, events)
    frozen_refs, visible_oids_by_snapshot = _verify_git_bundle(
        attempt / "git/frozen.bundle",
        freeze,
        {
            evidence["publication"]["snapshotId"]: evidence["fetchPublication"]["refs"]
            for evidence in publications
        },
    )
    ledgers = _json(attempt / "git/ledgers.json")
    _verify_ledgers(ledgers, freeze, run_id)
    drain = _json(attempt / "git/drain.json")
    _verify_drain(drain, ledgers, run_id)
    fetch_evidence = _json(attempt / "git/fetches.json")
    submissions = _json(attempt / "submissions.json")
    _verify_submissions(attempt, submissions, run_id, freeze)
    agent_events = _load_agent_events(attempt, run_id, events)
    _verify_progressive_reveal(events, agent_events)
    _verify_fetch_evidence(
        publications,
        fetch_evidence,
        freeze,
        frozen_refs,
        visible_oids_by_snapshot,
        events,
        run_id,
    )
    _verify_admission_events(events, ledgers)
    _verify_submission_events(events, submissions, freeze)
    executions = _json(attempt / "grading/solver-executions.json")
    _verify_solver_executions(attempt, executions, run_id)

    recorded_score = _json(attempt / "grading/score-report.json")
    _validate("score-report", recorded_score)
    rebuilt_score = build_score_report(run_id, attempt, bundle)
    if canonical_json_bytes(recorded_score) != canonical_json_bytes(rebuilt_score):
        raise ValueError("Recorded score report does not match deterministic replay.")

    replay = {
        "schemaVersion": 1,
        "contractId": "trusted-replay-bundle",
        "runId": run_id,
        "freezeId": freeze["freezeId"],
        "artifacts": [
            _artifact(attempt / path, artifact_type)
            for path, artifact_type in TRUSTED_ARTIFACT_PATHS
        ],
    }
    replay_path = attempt / "replay/trusted-replay.json"
    replay_path.parent.mkdir(parents=True, exist_ok=True)
    replay_path.write_bytes(canonical_json_bytes(replay))
    verdict_record = {
        "schemaVersion": 1,
        "runId": run_id,
        "eventChainHead": event_head,
        "freezeId": freeze["freezeId"],
        "replayDigest": sha256_hex(canonical_json_bytes(replay)),
        "result": "pass",
    }
    (attempt / "replay/verdict.json").write_bytes(canonical_json_bytes(verdict_record))
    return verdict_record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--attempt", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, default=Path("artifacts/harness/declared"))
    args = parser.parse_args()
    replay = replay_attempt(args.run_id, args.attempt, args.bundle)
    from .public_report import build_public_report

    public = build_public_report(args.run_id, args.attempt)
    print(canonical_json_bytes({"replay": replay, "public": public}).decode())


if __name__ == "__main__":
    main()
