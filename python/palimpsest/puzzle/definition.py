from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from ._decode import (
    _digest,
    _identifier,
    _integer,
    _ratio,
    _record,
    _safe_integer,
)

MINIMUM_WINDOW_WORDS = 16_000
MAXIMUM_WINDOW_WORDS = 20_000


@dataclass(frozen=True)
class AllocationTier:
    name: str
    specialist_owner_share: float
    owner_occurrences: int
    sentinel_occurrences: int
    max_solo_coverage: float
    max_region_deviation: float
    max_stage_deviation: float
    max_control_distance: float


@dataclass(frozen=True)
class WindowPin:
    paragraph_start: int
    paragraph_end: int
    word_count: int
    sha256: str

    @property
    def is_discovery(self) -> bool:
        return (
            self.paragraph_start == 0
            and self.paragraph_end == 0
            and self.word_count == 0
            and self.sha256 == ""
        )


@dataclass(frozen=True)
class VariantDefinition:
    variant_id: str
    rekey_from_stage: int | None


@dataclass(frozen=True)
class AllocationConstraints:
    minimum_anchors: int
    minimum_sentinels: int
    minimum_specialists_per_agent: int
    minimum_changed_mass: float
    tiers: tuple[AllocationTier, ...]


@dataclass(frozen=True)
class FixtureDefinition:
    fixture_id: str
    source: "TextFileDefinition"
    references: tuple["TextFileDefinition", ...]
    seed: int
    window: WindowPin
    agent_ids: tuple[str, ...]
    stage_count: int
    variants: tuple[VariantDefinition, ...]
    allocation_constraints: AllocationConstraints

    @property
    def rekey_from_stage(self) -> int:
        stages = {
            variant.rekey_from_stage
            for variant in self.variants
            if variant.rekey_from_stage is not None
        }
        if len(stages) != 1:
            raise ValueError(f"Fixture {self.fixture_id} must use one common re-key boundary.")
        return next(iter(stages))


@dataclass(frozen=True)
class FixtureCatalog:
    fixtures: tuple[FixtureDefinition, ...]

    def fixture(self, fixture_id: str) -> FixtureDefinition:
        try:
            return next(item for item in self.fixtures if item.fixture_id == fixture_id)
        except StopIteration as error:
            raise ValueError(f"Unknown fixture: {fixture_id}") from error


def _decode_window(value: object, name: str) -> WindowPin:
    value_record = _record(
        value,
        name,
        fields=frozenset({"paragraphStart", "paragraphEnd", "wordCount", "sha256"}),
    )
    start = _integer(value_record["paragraphStart"], f"{name} paragraphStart", 0)
    end = _integer(value_record["paragraphEnd"], f"{name} paragraphEnd", 0)
    word_count = _integer(value_record["wordCount"], f"{name} wordCount", 0)
    window_digest = value_record["sha256"]
    if not isinstance(window_digest, str):
        raise ValueError(f"{name} sha256 must be a string.")
    pin = WindowPin(start, end, word_count, window_digest)
    if pin.is_discovery:
        return pin
    if start == 0 or end == 0 or word_count == 0 or window_digest == "":
        raise ValueError(f"{name} discovery values must be all zero and empty.")
    if end < start:
        raise ValueError(f"{name} paragraph range must be ordered.")
    if not MINIMUM_WINDOW_WORDS <= word_count <= MAXIMUM_WINDOW_WORDS:
        raise ValueError(f"{name} wordCount must be within the declared window envelope.")
    _digest(window_digest, f"{name} sha256")
    return pin


@dataclass(frozen=True)
class TextFileDefinition:
    path: str
    source_format: str


def _decode_text_file(value: object, name: str) -> TextFileDefinition:
    record = _record(value, name, frozenset({"path", "format"}))
    path = record["path"]
    source_format = record["format"]
    if not isinstance(path, str) or not path.startswith("fixtures/"):
        raise ValueError(f"{name} path must name a file under fixtures/.")
    if source_format not in {"plain-text", "gutenberg-text", "gutenberg-html"}:
        raise ValueError(f"{name} format is unsupported.")
    return TextFileDefinition(path, source_format)


def _decode_allocation_constraints(value: object, name: str) -> AllocationConstraints:
    record = _record(
        value,
        name,
        frozenset(
            {
                "minimumAnchors",
                "minimumSentinels",
                "minimumSpecialistsPerAgent",
                "minimumChangedMass",
                "tiers",
            }
        ),
    )
    raw_tiers = record["tiers"]
    if not isinstance(raw_tiers, list) or not raw_tiers:
        raise ValueError(f"{name} tiers must be a non-empty array.")
    tiers: list[AllocationTier] = []
    seen: set[str] = set()
    for index, raw_tier in enumerate(raw_tiers):
        tier_name = f"{name} tiers[{index}]"
        tier = _record(
            raw_tier,
            tier_name,
            frozenset(
                {
                    "tier",
                    "minimumSpecialistOwnerShare",
                    "minimumOwnerOccurrences",
                    "minimumSentinelOccurrences",
                    "maximumSoloCoverage",
                    "maximumRegionDeviation",
                    "maximumStageDeviation",
                    "maximumControlDistance",
                }
            ),
        )
        tier_id = _identifier(tier["tier"], f"{tier_name} tier")
        if tier_id in seen:
            raise ValueError(f"{name} contains duplicate tier {tier_id}.")
        seen.add(tier_id)
        tiers.append(
            AllocationTier(
                tier_id,
                _ratio(
                    tier["minimumSpecialistOwnerShare"],
                    f"{tier_name} minimumSpecialistOwnerShare",
                ),
                _integer(
                    tier["minimumOwnerOccurrences"],
                    f"{tier_name} minimumOwnerOccurrences",
                    1,
                ),
                _integer(
                    tier["minimumSentinelOccurrences"],
                    f"{tier_name} minimumSentinelOccurrences",
                    1,
                ),
                _ratio(tier["maximumSoloCoverage"], f"{tier_name} maximumSoloCoverage"),
                _ratio(tier["maximumRegionDeviation"], f"{tier_name} maximumRegionDeviation"),
                _ratio(tier["maximumStageDeviation"], f"{tier_name} maximumStageDeviation"),
                _ratio(tier["maximumControlDistance"], f"{tier_name} maximumControlDistance"),
            )
        )
    return AllocationConstraints(
        minimum_anchors=_integer(record["minimumAnchors"], f"{name} minimumAnchors", 1),
        minimum_sentinels=_integer(record["minimumSentinels"], f"{name} minimumSentinels", 1),
        minimum_specialists_per_agent=_integer(
            record["minimumSpecialistsPerAgent"],
            f"{name} minimumSpecialistsPerAgent",
            1,
        ),
        minimum_changed_mass=_ratio(record["minimumChangedMass"], f"{name} minimumChangedMass"),
        tiers=tuple(tiers),
    )


def decode_fixture_definition(value: object) -> FixtureDefinition:
    name = "Fixture definition"
    record = _record(
        value,
        name,
        frozenset(
            {
                "fixtureId",
                "source",
                "references",
                "seed",
                "agentIds",
                "stageCount",
                "variants",
                "allocationConstraints",
            }
        ),
    )
    fixture_id = _identifier(record["fixtureId"], f"{name} fixtureId")
    source_record = _record(
        record["source"], f"{name} source", frozenset({"path", "format", "window"})
    )
    source = _decode_text_file(
        {"path": source_record["path"], "format": source_record["format"]}, f"{name} source"
    )
    raw_references = record["references"]
    if not isinstance(raw_references, list) or not raw_references:
        raise ValueError(f"{name} references must be a non-empty array.")
    references = tuple(
        _decode_text_file(reference, f"{name} references[{index}]")
        for index, reference in enumerate(raw_references)
    )
    if len({reference.path for reference in references}) != len(references) or source.path in {
        reference.path for reference in references
    }:
        raise ValueError(f"{name} references must be unique and exclude the source.")
    raw_agents = record["agentIds"]
    if not isinstance(raw_agents, list) or len(raw_agents) < 2:
        raise ValueError(f"{name} agentIds must contain at least two agents.")
    agent_ids = tuple(_identifier(agent, f"{name} agentIds") for agent in raw_agents)
    if len(set(agent_ids)) != len(agent_ids):
        raise ValueError(f"{name} agentIds must be unique.")
    stage_count = _integer(record["stageCount"], f"{name} stageCount", 2)
    raw_variants = record["variants"]
    if not isinstance(raw_variants, list) or not raw_variants:
        raise ValueError(f"{name} variants must be a non-empty array.")
    variants: list[VariantDefinition] = []
    variant_ids: set[str] = set()
    for index, raw_variant in enumerate(raw_variants):
        variant_name = f"{name} variants[{index}]"
        variant = _record(raw_variant, variant_name, frozenset({"variantId", "rekeyFromStage"}))
        variant_id = _identifier(variant["variantId"], f"{variant_name} variantId")
        if variant_id in variant_ids:
            raise ValueError(f"{name} contains duplicate variantId {variant_id}.")
        variant_ids.add(variant_id)
        raw_boundary = variant["rekeyFromStage"]
        boundary = (
            None
            if raw_boundary is None
            else _integer(raw_boundary, f"{variant_name} rekeyFromStage", 2)
        )
        if boundary is not None and boundary > stage_count:
            raise ValueError(f"{variant_name} rekeyFromStage exceeds stageCount.")
        variants.append(VariantDefinition(variant_id, boundary))
    if sum(variant.rekey_from_stage is None for variant in variants) != 1:
        raise ValueError(f"{name} must contain exactly one stationary variant.")
    if len({variant.rekey_from_stage for variant in variants if variant.rekey_from_stage}) != 1:
        raise ValueError(f"{name} re-key variants must share one boundary.")
    return FixtureDefinition(
        fixture_id=fixture_id,
        source=source,
        references=references,
        seed=_safe_integer(record["seed"], f"{name} seed"),
        window=_decode_window(source_record["window"], f"{name} source window"),
        agent_ids=agent_ids,
        stage_count=stage_count,
        variants=tuple(variants),
        allocation_constraints=_decode_allocation_constraints(
            record["allocationConstraints"], f"{name} allocationConstraints"
        ),
    )


def decode_fixture_catalog(value: object) -> FixtureCatalog:
    root = _record(value, "Fixture catalog", frozenset({"schemaVersion", "fixtures"}))
    if _integer(root["schemaVersion"], "Fixture catalog schemaVersion") != 1:
        raise ValueError("Unsupported fixture catalog schema version.")
    raw_fixtures = root["fixtures"]
    if not isinstance(raw_fixtures, list) or not raw_fixtures:
        raise ValueError("Fixture catalog fixtures must be a non-empty array.")
    fixtures: list[FixtureDefinition] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_fixtures):
        name = f"Fixture catalog fixtures[{index}]"
        fixture = decode_fixture_definition(raw)
        fixture_id = fixture.fixture_id
        if fixture_id in seen:
            raise ValueError(f"Fixture catalog contains duplicate fixtureId {fixture_id}.")
        seen.add(fixture_id)
        fixtures.append(fixture)
    return FixtureCatalog(tuple(fixtures))


def load_fixture_catalog(path: Path) -> FixtureCatalog:
    return decode_fixture_catalog(json.loads(path.read_text(encoding="utf-8")))
