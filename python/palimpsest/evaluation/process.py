from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

from ..serialization import canonical_json_bytes

_IDENTIFIER = re.compile(r"^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$")
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_COMMIT = re.compile(r"^[0-9a-f]{40}$")
_EVENT_DATA_FIELDS = {
    "stage": frozenset({"stageId"}),
    "response": frozenset(),
    "tool": frozenset({"toolName"}),
    "checker": frozenset(),
    "message": frozenset(),
    "read": frozenset(),
    "git": frozenset({"refTargetsKnown"}),
    "usage": frozenset({"inputTokens", "outputTokens"}),
    "termination": frozenset({"value"}),
    "publication": frozenset({"runnable"}),
}
_ACTION_KINDS = frozenset({"response", "tool", "checker", "message", "read", "git"})
_REVISION_STATUSES = frozenset(
    {"supported-revision", "asserted-only", "missed-revision", "unchanged", "ambiguous"}
)
_COLLABORATION_STATUSES = frozenset({"integrated", "uptaken", "missed", "ambiguous"})


def _object(
    value: object,
    *,
    name: str,
    required: Iterable[str],
    optional: Iterable[str] = (),
) -> dict[str, Any]:
    required_fields = frozenset(required)
    allowed = required_fields | frozenset(optional)
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object.")
    fields = frozenset(value)
    if not required_fields <= fields or not fields <= allowed:
        raise ValueError(
            f"{name} must contain exactly required fields {sorted(required_fields)} "
            f"and optional fields {sorted(allowed - required_fields)}."
        )
    return value


def _array(value: object, name: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be an array.")
    return value


def _identifier(value: object, name: str) -> str:
    if not isinstance(value, str) or _IDENTIFIER.fullmatch(value) is None:
        raise ValueError(f"{name} must be a canonical identifier.")
    return value


def _string(value: object, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty string.")
    return value


def _number(value: object, name: str, *, minimum: float | None = None) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number.")
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be at least {minimum}.")
    return value


def _integer(value: object, name: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{name} must be an integer of at least {minimum}.")
    return value


def _boolean(value: object, name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{name} must be a boolean.")
    return value


def _choice(value: object, name: str, choices: Iterable[str]) -> str:
    allowed = frozenset(choices)
    if not isinstance(value, str) or value not in allowed:
        raise ValueError(f"{name} must be one of {sorted(allowed)}.")
    return value


def _decode_reference(value: object, name: str) -> dict[str, Any]:
    base = {"source", "excerptDigest", "role"}
    item = _object(
        value,
        name=name,
        required=base,
        optional={"traceSequence", "recordPointer", "originId", "commit", "path"},
    )
    source = _choice(item["source"], f"{name}.source", {"trace", "run-record", "git"})
    digest = item["excerptDigest"]
    if not isinstance(digest, str) or _DIGEST.fullmatch(digest) is None:
        raise ValueError(f"{name}.excerptDigest must be a lowercase SHA-256 digest.")
    _choice(item["role"], f"{name}.role", {"support", "counterevidence", "context"})
    source_fields = {
        "trace": {"traceSequence"},
        "run-record": {"recordPointer"},
        "git": {"originId", "commit"},
    }
    present = set(item) - base
    required = source_fields[source]
    allowed = required | ({"path"} if source == "git" else set())
    if present != required and not (source == "git" and present == allowed):
        raise ValueError(f"{name} fields do not match its {source} source.")
    if source == "trace":
        _integer(item["traceSequence"], f"{name}.traceSequence", minimum=1)
    elif source == "run-record":
        pointer = _string(item["recordPointer"], f"{name}.recordPointer")
        if not pointer.startswith("/"):
            raise ValueError(f"{name}.recordPointer must be a JSON Pointer.")
    else:
        _identifier(item["originId"], f"{name}.originId")
        commit = item["commit"]
        if not isinstance(commit, str) or _COMMIT.fullmatch(commit) is None:
            raise ValueError(f"{name}.commit must be a lowercase 40-character object ID.")
        if "path" in item:
            path = _string(item["path"], f"{name}.path")
            if (
                path.startswith("/")
                or "\\" in path
                or any(segment in {"", ".", ".."} for segment in path.split("/"))
            ):
                raise ValueError(f"{name}.path must be a safe relative path.")
    return item


def _decode_references(value: object, name: str) -> list[dict[str, Any]]:
    return [
        _decode_reference(item, f"{name}[{index}]")
        for index, item in enumerate(_array(value, name))
    ]


def _decode_outcome(value: object, name: str) -> dict[str, Any]:
    item = _object(
        value,
        name=name,
        required={"evidence"},
        optional={"runnable", "matchedWords", "totalWords", "coverage", "accuracy"},
    )
    _decode_references(item["evidence"], f"{name}.evidence")
    if "runnable" in item:
        _boolean(item["runnable"], f"{name}.runnable")
    if "matchedWords" in item:
        _integer(item["matchedWords"], f"{name}.matchedWords")
    if "totalWords" in item:
        _integer(item["totalWords"], f"{name}.totalWords", minimum=1)
    for field in ("coverage", "accuracy"):
        if field in item:
            score = _number(item[field], f"{name}.{field}", minimum=0)
            if score > 1:
                raise ValueError(f"{name}.{field} cannot exceed 1.")
    if ("matchedWords" in item) != ("totalWords" in item):
        raise ValueError(f"{name} matchedWords and totalWords must be present together.")
    if "matchedWords" in item and item["matchedWords"] > item["totalWords"]:
        raise ValueError(f"{name}.matchedWords cannot exceed totalWords.")
    return item


def _decode_origin(value: object, index: int) -> dict[str, Any]:
    name = f"origins[{index}]"
    item = _object(
        value,
        name=name,
        required={"originId", "outcome"},
        optional={"startedAtMs", "endedAtMs"},
    )
    _identifier(item["originId"], f"{name}.originId")
    _decode_outcome(item["outcome"], f"{name}.outcome")
    if "startedAtMs" in item:
        _number(item["startedAtMs"], f"{name}.startedAtMs", minimum=0)
    if "endedAtMs" in item:
        _number(item["endedAtMs"], f"{name}.endedAtMs", minimum=0)
    if "startedAtMs" in item and "endedAtMs" in item and item["endedAtMs"] < item["startedAtMs"]:
        raise ValueError(f"{name}.endedAtMs cannot precede startedAtMs.")
    return item


def _decode_event(
    value: object, index: int, origin_ids: set[str], actors: set[str]
) -> dict[str, Any]:
    name = f"events[{index}]"
    item = _object(
        value,
        name=name,
        required={"sequence", "atMs", "kind", "originId", "data", "evidence"},
        optional={"actorId"},
    )
    _integer(item["sequence"], f"{name}.sequence", minimum=1)
    _number(item["atMs"], f"{name}.atMs", minimum=0)
    kind = _choice(item["kind"], f"{name}.kind", _EVENT_DATA_FIELDS)
    origin_id = _identifier(item["originId"], f"{name}.originId")
    if origin_id not in origin_ids:
        raise ValueError(f"{name}.originId must name a declared origin.")
    if "actorId" in item:
        actor_id = _identifier(item["actorId"], f"{name}.actorId")
        if actor_id not in actors:
            raise ValueError(f"{name}.actorId must name a declared actor.")
    data_fields = _EVENT_DATA_FIELDS[kind]
    data = _object(item["data"], name=f"{name}.data", required=data_fields)
    if kind == "stage":
        _identifier(data["stageId"], f"{name}.data.stageId")
    elif kind == "tool":
        _identifier(data["toolName"], f"{name}.data.toolName")
    elif kind == "git":
        _boolean(data["refTargetsKnown"], f"{name}.data.refTargetsKnown")
    elif kind == "usage":
        _integer(data["inputTokens"], f"{name}.data.inputTokens")
        _integer(data["outputTokens"], f"{name}.data.outputTokens")
    elif kind == "termination":
        _choice(
            data["value"],
            f"{name}.data.value",
            {"completed", "interrupted", "infrastructure-failed"},
        )
    elif kind == "publication":
        _boolean(data["runnable"], f"{name}.data.runnable")
    _decode_reference(item["evidence"], f"{name}.evidence")
    return item


def _decode_revision(value: object, name: str) -> dict[str, Any]:
    item = _object(value, name=name, required={"episodeId", "status", "evidence"})
    _identifier(item["episodeId"], f"{name}.episodeId")
    _choice(item["status"], f"{name}.status", _REVISION_STATUSES)
    _decode_references(item["evidence"], f"{name}.evidence")
    return item


def _decode_collaboration(value: object, name: str, actors: set[str]) -> dict[str, Any]:
    item = _object(
        value,
        name=name,
        required={"episodeId", "status", "contributionActorId", "contributedAtMs", "evidence"},
        optional={"uptakeActorId", "uptakeAtMs", "integratedAtMs"},
    )
    _identifier(item["episodeId"], f"{name}.episodeId")
    status = _choice(item["status"], f"{name}.status", _COLLABORATION_STATUSES)
    contributor = _identifier(item["contributionActorId"], f"{name}.contributionActorId")
    if contributor not in actors:
        raise ValueError(f"{name}.contributionActorId must name a declared actor.")
    contributed_at = _number(item["contributedAtMs"], f"{name}.contributedAtMs", minimum=0)
    _decode_references(item["evidence"], f"{name}.evidence")
    uptake_fields = {"uptakeActorId", "uptakeAtMs"}
    has_any_uptake_field = bool(uptake_fields & set(item))
    has_all_uptake_fields = uptake_fields <= set(item)
    if has_any_uptake_field != has_all_uptake_fields:
        raise ValueError(f"{name} must provide uptakeActorId and uptakeAtMs together.")
    if status in {"integrated", "uptaken"} and not uptake_fields <= set(item):
        raise ValueError(f"{name} requires uptake provenance for status {status}.")
    if "uptakeActorId" in item:
        uptake_actor = _identifier(item["uptakeActorId"], f"{name}.uptakeActorId")
        if uptake_actor not in actors or uptake_actor == contributor:
            raise ValueError(f"{name}.uptakeActorId must name a distinct declared actor.")
        uptake_at = _number(item["uptakeAtMs"], f"{name}.uptakeAtMs", minimum=0)
        if uptake_at < contributed_at:
            raise ValueError(f"{name}.uptakeAtMs cannot precede contributedAtMs.")
        if "integratedAtMs" in item:
            integrated_at = _number(item["integratedAtMs"], f"{name}.integratedAtMs", minimum=0)
            if integrated_at < uptake_at:
                raise ValueError(f"{name}.integratedAtMs cannot precede uptakeAtMs.")
    elif "integratedAtMs" in item:
        raise ValueError(f"{name}.integratedAtMs requires uptake provenance.")
    if status == "integrated" and "integratedAtMs" not in item:
        raise ValueError(f"{name} requires integratedAtMs for integrated status.")
    return item


def _decode_review(value: object, index: int, actors: set[str]) -> dict[str, Any]:
    name = f"reviews[{index}]"
    item = _object(
        value,
        name=name,
        required={"reviewerId", "revisionOpportunities", "collaborationOpportunities"},
    )
    _identifier(item["reviewerId"], f"{name}.reviewerId")
    revisions = _array(item["revisionOpportunities"], f"{name}.revisionOpportunities")
    collaborations = _array(
        item["collaborationOpportunities"], f"{name}.collaborationOpportunities"
    )
    for opportunity_index, opportunity in enumerate(revisions):
        _decode_revision(opportunity, f"{name}.revisionOpportunities[{opportunity_index}]")
    for opportunity_index, opportunity in enumerate(collaborations):
        _decode_collaboration(
            opportunity,
            f"{name}.collaborationOpportunities[{opportunity_index}]",
            actors,
        )
    for entries_name, entries in (
        ("revisionOpportunities", revisions),
        ("collaborationOpportunities", collaborations),
    ):
        episode_ids = [entry["episodeId"] for entry in entries]
        if len(episode_ids) != len(set(episode_ids)):
            raise ValueError(f"{name}.{entries_name} episode IDs must be unique.")
    return item


def _decode_measure_request(value: object) -> dict[str, Any]:
    request = _object(
        value,
        name="measure request",
        required={
            "schemaVersion",
            "kind",
            "communicationMode",
            "actors",
            "origins",
            "events",
            "reviews",
        },
    )
    if request["schemaVersion"] != 1 or request["kind"] != "measure":
        raise ValueError("Measure request schemaVersion and kind must be 1 and measure.")
    communication_mode = _choice(
        request["communicationMode"], "communicationMode", {"shared", "isolated"}
    )
    actors = [
        _identifier(actor, f"actors[{index}]")
        for index, actor in enumerate(_array(request["actors"], "actors"))
    ]
    if not actors or len(actors) != len(set(actors)):
        raise ValueError("actors must contain unique canonical actor IDs.")
    if communication_mode == "shared" and len(actors) < 2:
        raise ValueError("Shared communication requires at least two actors.")
    origins = [
        _decode_origin(origin, index)
        for index, origin in enumerate(_array(request["origins"], "origins"))
    ]
    origin_ids = [origin["originId"] for origin in origins]
    if not origins or len(origin_ids) != len(set(origin_ids)):
        raise ValueError("origins must contain unique canonical origin IDs.")
    events = [
        _decode_event(event, index, set(origin_ids), set(actors))
        for index, event in enumerate(_array(request["events"], "events"))
    ]
    sequences = [event["sequence"] for event in events]
    if sequences != sorted(sequences) or len(sequences) != len(set(sequences)):
        raise ValueError("events must have unique increasing normalized sequences.")
    reviews = [
        _decode_review(review, index, set(actors))
        for index, review in enumerate(_array(request["reviews"], "reviews"))
    ]
    reviewer_ids = [review["reviewerId"] for review in reviews]
    if len(reviewer_ids) != len(set(reviewer_ids)):
        raise ValueError("reviews must have unique reviewer IDs.")
    return request


def _decode_scalar(value: object, name: str) -> dict[str, Any]:
    item = _object(
        value,
        name=name,
        required={"measureId", "state"},
        optional={"value", "reason"},
    )
    _identifier(item["measureId"], f"{name}.measureId")
    state = _choice(item["state"], f"{name}.state", {"observed", "unavailable", "not-applicable"})
    if state == "observed":
        if set(item) != {"measureId", "state", "value"}:
            raise ValueError(f"{name} observed state requires only a finite numeric value.")
        _number(item["value"], f"{name}.value")
    elif set(item) != {"measureId", "state", "reason"}:
        raise ValueError(f"{name} missing state requires only a reason.")
    else:
        _string(item["reason"], f"{name}.reason")
    return item


def _decode_dimension(value: object, name: str) -> dict[str, Any]:
    item = _object(
        value,
        name=name,
        required={"dimensionId", "state"},
        optional={"rating", "reason"},
    )
    _identifier(item["dimensionId"], f"{name}.dimensionId")
    state = _choice(item["state"], f"{name}.state", {"rated", "unobservable", "not-applicable"})
    if state == "rated":
        if set(item) != {"dimensionId", "state", "rating"}:
            raise ValueError(f"{name} rated state requires only rating.")
        rating = _integer(item["rating"], f"{name}.rating")
        if rating > 4:
            raise ValueError(f"{name}.rating cannot exceed 4.")
    elif set(item) != {"dimensionId", "state", "reason"}:
        raise ValueError(f"{name} unrated state requires only a reason.")
    else:
        _string(item["reason"], f"{name}.reason")
    return item


def _decode_aggregate_review(value: object, name: str) -> dict[str, Any]:
    item = _object(value, name=name, required={"reviewerId", "dimensions"})
    _identifier(item["reviewerId"], f"{name}.reviewerId")
    dimensions = [
        _decode_dimension(dimension, f"{name}.dimensions[{index}]")
        for index, dimension in enumerate(_array(item["dimensions"], f"{name}.dimensions"))
    ]
    dimension_ids = [dimension["dimensionId"] for dimension in dimensions]
    if len(dimension_ids) != len(set(dimension_ids)):
        raise ValueError(f"{name} dimension IDs must be unique.")
    return item


def _decode_scorecard(value: object, index: int) -> dict[str, Any]:
    name = f"scorecards[{index}]"
    item = _object(
        value,
        name=name,
        required={"runId", "originId", "clusterId", "outcomes", "processMeasures", "reviews"},
    )
    _identifier(item["runId"], f"{name}.runId")
    _identifier(item["originId"], f"{name}.originId")
    _identifier(item["clusterId"], f"{name}.clusterId")
    for field in ("outcomes", "processMeasures"):
        entries = [
            _decode_scalar(scalar, f"{name}.{field}[{scalar_index}]")
            for scalar_index, scalar in enumerate(_array(item[field], f"{name}.{field}"))
        ]
        measure_ids = [entry["measureId"] for entry in entries]
        if len(measure_ids) != len(set(measure_ids)):
            raise ValueError(f"{name}.{field} measure IDs must be unique.")
    reviews = [
        _decode_aggregate_review(review, f"{name}.reviews[{review_index}]")
        for review_index, review in enumerate(_array(item["reviews"], f"{name}.reviews"))
    ]
    reviewer_ids = [review["reviewerId"] for review in reviews]
    if len(reviews) != 2 or len(set(reviewer_ids)) != 2:
        raise ValueError(f"{name}.reviews must contain exactly two unique reviewer IDs.")
    return item


def _decode_aggregate_request(value: object) -> dict[str, Any]:
    request = _object(
        value,
        name="aggregate request",
        required={"schemaVersion", "kind", "design", "scorecards"},
    )
    if request["schemaVersion"] != 1 or request["kind"] != "aggregate":
        raise ValueError("Aggregate request schemaVersion and kind must be 1 and aggregate.")
    design = _object(
        request["design"],
        name="design",
        required={"experimentalUnit", "clusterBy"},
    )
    _choice(design["experimentalUnit"], "design.experimentalUnit", {"team", "origin"})
    if design["clusterBy"] != "run":
        raise ValueError("design.clusterBy must be run.")
    scorecards = [
        _decode_scorecard(scorecard, index)
        for index, scorecard in enumerate(_array(request["scorecards"], "scorecards"))
    ]
    identities = [(scorecard["clusterId"], scorecard["originId"]) for scorecard in scorecards]
    if not scorecards or len(identities) != len(set(identities)):
        raise ValueError("scorecards must have unique execution and origin identities.")
    if design["experimentalUnit"] == "team" and any(
        scorecard["originId"] != "shared" for scorecard in scorecards
    ):
        raise ValueError("Team experimental units require shared origins.")
    return request


def decode_request(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Process request must be an object.")
    kind = value.get("kind")
    if kind == "measure":
        return _decode_measure_request(value)
    if kind == "aggregate":
        return _decode_aggregate_request(value)
    raise ValueError("Process request kind must be measure or aggregate.")


def _eligibility(rule_id: str, explanation: str) -> dict[str, str]:
    return {"ruleId": rule_id, "explanation": explanation}


def _observed(
    measure_id: str,
    ledger: str,
    basis: str,
    value: bool | int | float | str,
    unit: str,
    eligibility: dict[str, str],
    evidence: list[dict[str, Any]],
    *,
    numerator: int | float | None = None,
    denominator: int | float | None = None,
) -> dict[str, Any]:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{measure_id} produced a non-finite value.")
    result: dict[str, Any] = {
        "measureId": measure_id,
        "ledger": ledger,
        "basis": basis,
        "state": "observed",
        "value": value,
        "unit": unit,
        "eligibility": eligibility,
        "evidence": evidence,
    }
    if numerator is not None:
        result["numerator"] = numerator
    if denominator is not None:
        if denominator <= 0:
            raise ValueError(f"{measure_id} denominator must be positive.")
        result["denominator"] = denominator
    return result


def _missing(
    measure_id: str,
    ledger: str,
    basis: str,
    state: str,
    eligibility: dict[str, str],
    reason: str,
) -> dict[str, Any]:
    return {
        "measureId": measure_id,
        "ledger": ledger,
        "basis": basis,
        "state": state,
        "eligibility": {
            **eligibility,
            "explanation": f"{eligibility['explanation']} Missingness: {reason}",
        },
        "evidence": [],
    }


def _event_evidence(events: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [event["evidence"] for event in events]


def _count_measure(
    measure_id: str,
    ledger: str,
    events: list[dict[str, Any]],
    rule_id: str,
    explanation: str,
    completeness_evidence: list[dict[str, Any]],
) -> dict[str, Any]:
    return _observed(
        measure_id,
        ledger,
        "mechanical",
        len(events),
        "count",
        _eligibility(rule_id, explanation),
        _event_evidence(events) or completeness_evidence,
    )


def _mechanical_measures(
    request: Mapping[str, Any], origin: Mapping[str, Any], events: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    outcome = origin["outcome"]
    outcome_evidence = outcome["evidence"]
    completeness_evidence = outcome_evidence or _event_evidence(events[:1])
    result: list[dict[str, Any]] = []
    outcome_rule = _eligibility(
        "completed-origin-outcome",
        "Requires the corresponding frozen completed-origin evaluation.",
    )
    if "runnable" in outcome:
        result.append(
            _observed(
                "outcome.runnable.v1",
                "outcome",
                "mechanical",
                outcome["runnable"],
                "boolean",
                outcome_rule,
                outcome_evidence,
            )
        )
    else:
        result.append(
            _missing(
                "outcome.runnable.v1",
                "outcome",
                "mechanical",
                "unavailable",
                outcome_rule,
                "Runnable evaluation evidence is unavailable.",
            )
        )
    accuracy_rule = _eligibility(
        "completed-origin-outcome",
        "Requires the frozen accuracy and word-count observations for a completed origin.",
    )
    if "accuracy" in outcome and "matchedWords" in outcome:
        result.append(
            _observed(
                "outcome.accuracy.v1",
                "outcome",
                "mechanical",
                outcome["accuracy"],
                "ratio",
                accuracy_rule,
                outcome_evidence,
                numerator=outcome["matchedWords"],
                denominator=outcome["totalWords"],
            )
        )
    else:
        result.append(
            _missing(
                "outcome.accuracy.v1",
                "outcome",
                "mechanical",
                "unavailable",
                accuracy_rule,
                "Accuracy or word-count evidence is unavailable.",
            )
        )
    coverage_rule = _eligibility(
        "completed-origin-outcome",
        "Requires the frozen normalized reconstruction-coverage observation.",
    )
    if "coverage" in outcome:
        result.append(
            _observed(
                "outcome.coverage.v1",
                "outcome",
                "mechanical",
                outcome["coverage"],
                "ratio",
                coverage_rule,
                outcome_evidence,
                numerator=outcome["coverage"],
                denominator=1,
            )
        )
    else:
        result.append(
            _missing(
                "outcome.coverage.v1",
                "outcome",
                "mechanical",
                "unavailable",
                coverage_rule,
                "Coverage evidence is unavailable.",
            )
        )
    elapsed_rule = _eligibility(
        "bounded-origin-lifecycle",
        "Requires observed start and end times for the canonical origin.",
    )
    if "startedAtMs" in origin and "endedAtMs" in origin:
        result.append(
            _observed(
                "instrumental.elapsed-time-ms.v1",
                "instrumental",
                "mechanical",
                origin["endedAtMs"] - origin["startedAtMs"],
                "milliseconds",
                elapsed_rule,
                completeness_evidence,
            )
        )
    else:
        result.append(
            _missing(
                "instrumental.elapsed-time-ms.v1",
                "instrumental",
                "mechanical",
                "unavailable",
                elapsed_rule,
                "Origin lifecycle bounds are unavailable.",
            )
        )
    stage_events = [event for event in events if event["kind"] == "stage"]
    action_events = [event for event in events if event["kind"] in _ACTION_KINDS]
    latencies: list[int | float] = []
    latency_events: list[dict[str, Any]] = []
    for stage in stage_events:
        action = next(
            (candidate for candidate in action_events if candidate["atMs"] >= stage["atMs"]), None
        )
        if action is not None:
            latencies.append(action["atMs"] - stage["atMs"])
            latency_events.extend((stage, action))
    latency_rule = _eligibility(
        "released-stage-with-action",
        "A released stage enters the denominator when a subsequent observable action exists.",
    )
    if latencies:
        result.append(
            _observed(
                "instrumental.stage-first-action-latency-mean-ms.v1",
                "instrumental",
                "mechanical",
                sum(latencies) / len(latencies),
                "milliseconds",
                latency_rule,
                _event_evidence(latency_events),
                numerator=sum(latencies),
                denominator=len(latencies),
            )
        )
    else:
        result.append(
            _missing(
                "instrumental.stage-first-action-latency-mean-ms.v1",
                "instrumental",
                "mechanical",
                "unavailable",
                latency_rule,
                "No released stage has an observable subsequent action.",
            )
        )
    by_kind = {
        kind: [event for event in events if event["kind"] == kind] for kind in _EVENT_DATA_FIELDS
    }
    result.extend(
        (
            _count_measure(
                "instrumental.tool-calls.v1",
                "instrumental",
                by_kind["tool"],
                "retained-tool-events",
                "Counts retained tool-call observations without assigning quality.",
                completeness_evidence,
            ),
            _count_measure(
                "instrumental.checker-calls.v1",
                "instrumental",
                by_kind["checker"],
                "retained-checker-events",
                "Counts retained checker-use observations without assigning quality.",
                completeness_evidence,
            ),
            _count_measure(
                "social.messages-sent.v1",
                "social",
                by_kind["message"],
                "communication-available",
                "Counts retained team messages when communication is available.",
                completeness_evidence,
            ),
            _count_measure(
                "social.messages-read.v1",
                "social",
                by_kind["read"],
                "communication-available",
                "Counts retained communication reads when communication is available.",
                completeness_evidence,
            ),
            _count_measure(
                "instrumental.git-change-events.v1",
                "instrumental",
                by_kind["git"],
                "retained-git-events",
                "Counts retained Git-change observations without assigning quality.",
                completeness_evidence,
            ),
        )
    )
    tools: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for tool_event in by_kind["tool"]:
        tools[tool_event["data"]["toolName"]].append(tool_event)
    for tool_name in sorted(tools):
        result.append(
            _count_measure(
                f"instrumental.tool-mix.{tool_name}.v1",
                "instrumental",
                tools[tool_name],
                "retained-tool-events",
                "Counts calls to one declared tool without assigning quality.",
                completeness_evidence,
            )
        )
    for field, measure_id in (
        ("inputTokens", "instrumental.input-tokens.v1"),
        ("outputTokens", "instrumental.output-tokens.v1"),
    ):
        result.append(
            _observed(
                measure_id,
                "instrumental",
                "mechanical",
                sum(event["data"][field] for event in by_kind["usage"]),
                "tokens",
                _eligibility(
                    "retained-usage-events",
                    "Sums retained usage observations without imputing missing events.",
                ),
                _event_evidence(by_kind["usage"]) or completeness_evidence,
            )
        )
    termination_rule = _eligibility(
        "retained-termination-event", "Requires exactly one retained termination observation."
    )
    if len(by_kind["termination"]) == 1:
        result.append(
            _observed(
                "instrumental.termination.v1",
                "instrumental",
                "mechanical",
                by_kind["termination"][0]["data"]["value"],
                "category",
                termination_rule,
                _event_evidence(by_kind["termination"]),
            )
        )
    else:
        result.append(
            _missing(
                "instrumental.termination.v1",
                "instrumental",
                "mechanical",
                "unavailable",
                termination_rule,
                "A unique termination observation is unavailable.",
            )
        )
    publication_rule = _eligibility(
        "retained-publication-event", "Requires exactly one final publication observation."
    )
    if len(by_kind["publication"]) == 1:
        result.append(
            _observed(
                "instrumental.publication.v1",
                "instrumental",
                "mechanical",
                by_kind["publication"][0]["data"]["runnable"],
                "boolean",
                publication_rule,
                _event_evidence(by_kind["publication"]),
            )
        )
    else:
        result.append(
            _missing(
                "instrumental.publication.v1",
                "instrumental",
                "mechanical",
                "unavailable",
                publication_rule,
                "A unique publication observation is unavailable.",
            )
        )
    trajectory_rule = _eligibility(
        "future-ref-target-observation",
        "Requires retained Git events with explicit event-time ref-target availability.",
    )
    if by_kind["git"]:
        known = sum(event["data"]["refTargetsKnown"] for event in by_kind["git"])
        result.append(
            _observed(
                "instrumental.git-ref-trajectory-completeness.v1",
                "instrumental",
                "mechanical",
                known / len(by_kind["git"]),
                "ratio",
                trajectory_rule,
                _event_evidence(by_kind["git"]),
                numerator=known,
                denominator=len(by_kind["git"]),
            )
        )
    else:
        result.append(
            _missing(
                "instrumental.git-ref-trajectory-completeness.v1",
                "instrumental",
                "mechanical",
                "unavailable",
                trajectory_rule,
                "No Git trajectory observations are available.",
            )
        )
    balance_rule = _eligibility(
        "shared-message-participation",
        "Describes balance across declared actors; it does not measure contribution quality.",
    )
    if request["communicationMode"] == "isolated":
        result.append(
            _missing(
                "social.participation-balance.v1",
                "social",
                "mechanical",
                "not-applicable",
                balance_rule,
                "Peer communication is unavailable in the isolated condition.",
            )
        )
    else:
        counts = [
            sum(event.get("actorId") == actor for event in by_kind["message"])
            for actor in request["actors"]
        ]
        total = sum(counts)
        if total == 0:
            balance = 0.0
        else:
            pairwise = sum(abs(left - right) for left in counts for right in counts)
            gini = pairwise / (2 * len(counts) * total)
            balance = 1 - gini
        result.append(
            _observed(
                "social.participation-balance.v1",
                "social",
                "mechanical",
                balance,
                "ratio",
                balance_rule,
                _event_evidence(by_kind["message"]) or completeness_evidence,
                denominator=len(counts),
            )
        )
    return result


def _review_measures(request: Mapping[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for review in request["reviews"]:
        reviewer_id = review["reviewerId"]
        revisions = review["revisionOpportunities"]
        revision_id = f"epistemic.supported-revision-rate.{reviewer_id}.v1"
        revision_rule = _eligibility(
            "frozen-review-revision-opportunities",
            f"Uses only frozen opportunities coded by reviewer {reviewer_id}.",
        )
        if revisions:
            supported = sum(item["status"] == "supported-revision" for item in revisions)
            result.append(
                _observed(
                    revision_id,
                    "epistemic",
                    "review-coded",
                    supported / len(revisions),
                    "ratio",
                    revision_rule,
                    [reference for item in revisions for reference in item["evidence"]],
                    numerator=supported,
                    denominator=len(revisions),
                )
            )
        else:
            result.append(
                _missing(
                    revision_id,
                    "epistemic",
                    "review-coded",
                    "unavailable",
                    revision_rule,
                    "This reviewer coded no revision opportunities.",
                )
            )
        collaborations = review["collaborationOpportunities"]
        uptake_id = f"social.contribution-uptake-rate.{reviewer_id}.v1"
        latency_id = f"social.integration-latency-mean-ms.{reviewer_id}.v1"
        collaboration_rule = _eligibility(
            "frozen-review-collaboration-opportunities",
            f"Uses only frozen collaboration opportunities coded by reviewer {reviewer_id}.",
        )
        if request["communicationMode"] == "isolated":
            for measure_id in (uptake_id, latency_id):
                result.append(
                    _missing(
                        measure_id,
                        "social",
                        "review-coded",
                        "not-applicable",
                        collaboration_rule,
                        "Peer collaboration is unavailable in the isolated condition.",
                    )
                )
            continue
        if collaborations:
            uptake_count = sum(
                item["status"] in {"uptaken", "integrated"} for item in collaborations
            )
            evidence = [reference for item in collaborations for reference in item["evidence"]]
            result.append(
                _observed(
                    uptake_id,
                    "social",
                    "review-coded",
                    uptake_count / len(collaborations),
                    "ratio",
                    collaboration_rule,
                    evidence,
                    numerator=uptake_count,
                    denominator=len(collaborations),
                )
            )
        else:
            result.append(
                _missing(
                    uptake_id,
                    "social",
                    "review-coded",
                    "unavailable",
                    collaboration_rule,
                    "This reviewer coded no collaboration opportunities.",
                )
            )
        integrated = [item for item in collaborations if item["status"] == "integrated"]
        if integrated:
            latencies = [item["integratedAtMs"] - item["contributedAtMs"] for item in integrated]
            result.append(
                _observed(
                    latency_id,
                    "social",
                    "review-coded",
                    sum(latencies) / len(latencies),
                    "milliseconds",
                    collaboration_rule,
                    [reference for item in integrated for reference in item["evidence"]],
                    numerator=sum(latencies),
                    denominator=len(latencies),
                )
            )
        else:
            result.append(
                _missing(
                    latency_id,
                    "social",
                    "review-coded",
                    "unavailable",
                    collaboration_rule,
                    "This reviewer coded no integrated contribution with complete timing.",
                )
            )
    return result


def _measure(request: Mapping[str, Any]) -> dict[str, Any]:
    groups: list[dict[str, Any]] = []
    for origin in request["origins"]:
        events = [event for event in request["events"] if event["originId"] == origin["originId"]]
        values = _mechanical_measures(request, origin, events)
        values.extend(_review_measures(request))
        groups.append({"originId": origin["originId"], "values": values})
    return {"schemaVersion": 1, "kind": "measure", "measures": groups}


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _aggregate(request: Mapping[str, Any]) -> dict[str, Any]:
    scorecards = request["scorecards"]
    dimension_ids = sorted(
        {
            dimension["dimensionId"]
            for scorecard in scorecards
            for review in scorecard["reviews"]
            for dimension in review["dimensions"]
        }
    )
    dimensions: list[dict[str, Any]] = []
    missingness: list[dict[str, Any]] = []
    reviewer_agreement: list[dict[str, Any]] = []
    clustered_uncertainty: list[dict[str, Any]] = []
    for dimension_id in dimension_ids:
        unit_ratings: list[tuple[dict[str, Any], list[int]]] = []
        all_ratings: list[int] = []
        paired: list[tuple[int, int]] = []
        for scorecard in scorecards:
            ratings: list[int] = []
            for review in scorecard["reviews"]:
                dimension = next(
                    (
                        candidate
                        for candidate in review["dimensions"]
                        if candidate["dimensionId"] == dimension_id
                    ),
                    None,
                )
                if dimension is not None and dimension["state"] == "rated":
                    ratings.append(dimension["rating"])
            if ratings:
                unit_ratings.append((scorecard, ratings))
                all_ratings.extend(ratings)
            if len(ratings) == 2:
                paired.append((ratings[0], ratings[1]))
        distribution = [all_ratings.count(rating) for rating in range(5)]
        dimensions.append(
            {
                "dimensionId": dimension_id,
                "ratingCount": len(all_ratings),
                "distribution": distribution,
                **({"mean": _mean(all_ratings)} if all_ratings else {}),
            }
        )
        observed_units = len(unit_ratings)
        missing_units = len(scorecards) - observed_units
        missingness.append(
            {
                "dimensionId": dimension_id,
                "unitCount": len(scorecards),
                "observedUnitCount": observed_units,
                "missingUnitCount": missing_units,
                "missingRate": missing_units / len(scorecards),
            }
        )
        if paired:
            differences = [abs(left - right) for left, right in paired]
            reviewer_agreement.append(
                {
                    "dimensionId": dimension_id,
                    "pairedUnitCount": len(paired),
                    "exactAgreementRate": sum(difference == 0 for difference in differences)
                    / len(differences),
                    "meanAbsoluteDifference": _mean(differences),
                }
            )
        else:
            reviewer_agreement.append(
                {
                    "dimensionId": dimension_id,
                    "pairedUnitCount": 0,
                    "state": "unavailable",
                    "reason": "No unit has two rated reviewer observations.",
                }
            )
        clusters: dict[str, list[float]] = defaultdict(list)
        for scorecard, ratings in unit_ratings:
            clusters[scorecard["clusterId"]].append(_mean(ratings))
        cluster_values = [_mean(clusters[cluster_id]) for cluster_id in sorted(clusters)]
        if len(cluster_values) >= 2:
            estimate = _mean(cluster_values)
            variance = sum((value - estimate) ** 2 for value in cluster_values) / (
                len(cluster_values) - 1
            )
            standard_error = math.sqrt(variance / len(cluster_values))
            clustered_uncertainty.append(
                {
                    "dimensionId": dimension_id,
                    "unitCount": observed_units,
                    "clusterCount": len(cluster_values),
                    "estimate": estimate,
                    "standardError": standard_error,
                    "confidence95": {
                        "lower": max(0.0, estimate - 1.96 * standard_error),
                        "upper": min(4.0, estimate + 1.96 * standard_error),
                    },
                    "method": "normal-interval-over-run-cluster-means",
                }
            )
        else:
            clustered_uncertainty.append(
                {
                    "dimensionId": dimension_id,
                    "unitCount": observed_units,
                    "clusterCount": len(cluster_values),
                    "state": "unavailable",
                    "reason": "At least two run clusters are required for uncertainty.",
                }
            )
    outcome_ids = sorted(
        {
            item["measureId"]
            for scorecard in scorecards
            for item in scorecard["outcomes"]
            if item["state"] == "observed"
        }
    )
    process_ids = sorted(
        {
            item["measureId"]
            for scorecard in scorecards
            for item in scorecard["processMeasures"]
            if item["state"] == "observed"
        }
    )
    associations: list[dict[str, Any]] = []
    for process_id in process_ids:
        for outcome_id in outcome_ids:
            pairs: list[tuple[str, float, float]] = []
            for scorecard in scorecards:
                process_value = next(
                    (
                        item["value"]
                        for item in scorecard["processMeasures"]
                        if item["measureId"] == process_id and item["state"] == "observed"
                    ),
                    None,
                )
                outcome_value = next(
                    (
                        item["value"]
                        for item in scorecard["outcomes"]
                        if item["measureId"] == outcome_id and item["state"] == "observed"
                    ),
                    None,
                )
                if process_value is not None and outcome_value is not None:
                    pairs.append((scorecard["clusterId"], process_value, outcome_value))
            clustered: dict[str, list[tuple[float, float]]] = defaultdict(list)
            for cluster_id, process_value, outcome_value in pairs:
                clustered[cluster_id].append((process_value, outcome_value))
            cluster_pairs = [
                (
                    _mean([pair[0] for pair in clustered[cluster_id]]),
                    _mean([pair[1] for pair in clustered[cluster_id]]),
                )
                for cluster_id in sorted(clustered)
            ]
            association: dict[str, Any] = {
                "processMeasureId": process_id,
                "outcomeMeasureId": outcome_id,
                "unitPairCount": len(pairs),
                "clusterCount": len(cluster_pairs),
                "claim": "observational",
            }
            if len(cluster_pairs) < 2:
                association.update(
                    state="unavailable",
                    reason="At least two run clusters are required for an association.",
                )
            else:
                process_values = [pair[0] for pair in cluster_pairs]
                outcome_values = [pair[1] for pair in cluster_pairs]
                process_mean = _mean(process_values)
                outcome_mean = _mean(outcome_values)
                numerator = sum(
                    (process - process_mean) * (outcome - outcome_mean)
                    for process, outcome in cluster_pairs
                )
                process_scale = math.sqrt(
                    sum((process - process_mean) ** 2 for process in process_values)
                )
                outcome_scale = math.sqrt(
                    sum((outcome - outcome_mean) ** 2 for outcome in outcome_values)
                )
                if process_scale == 0 or outcome_scale == 0:
                    association.update(
                        state="unavailable",
                        reason="The clustered observations have zero variance.",
                    )
                else:
                    association.update(
                        state="observed",
                        pearsonR=numerator / (process_scale * outcome_scale),
                    )
            associations.append(association)
    return {
        "schemaVersion": 1,
        "kind": "aggregate",
        "dimensions": dimensions,
        "missingness": missingness,
        "reviewerAgreement": reviewer_agreement,
        "clusteredUncertainty": clustered_uncertainty,
        "processOutcomeAssociations": associations,
    }


def process_request(request: Mapping[str, Any]) -> dict[str, Any]:
    kind = request.get("kind")
    if kind == "measure":
        return _measure(request)
    if kind == "aggregate":
        return _aggregate(request)
    raise ValueError("Decoded process request kind must be measure or aggregate.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path)
    args = parser.parse_args()
    raw_bytes = args.request.read_bytes() if args.request is not None else sys.stdin.buffer.read()
    raw = json.loads(raw_bytes)
    response = process_request(decode_request(raw))
    sys.stdout.buffer.write(canonical_json_bytes(response) + b"\n")


if __name__ == "__main__":
    main()
