from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from ..serialization import canonical_json_bytes, sha256_hex
from .text import word_tokens

MAX_WINDOW_STARTS = 512
MINIMUM_PARAGRAPH_WORDS = 20
MINIMUM_WINDOW_WORDS = 16_000
TARGET_WINDOW_WORDS = 18_000
MAXIMUM_WINDOW_WORDS = 20_000
MINIMUM_REGION_PARAGRAPHS = 9

_IDENTIFIER = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_DIGEST = re.compile(r"^[0-9a-f]{64}$")


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
    source_id: str
    references: tuple[str, ...]
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


def _record(value: object, name: str, fields: frozenset[str]) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object.")
    record = {key: item for key, item in value.items() if isinstance(key, str)}
    missing = fields - record.keys()
    extra = record.keys() - fields
    if missing:
        raise ValueError(f"{name} {sorted(missing)[0]} is required.")
    if extra:
        raise ValueError(f"{name} contains unknown field {sorted(extra)[0]}.")
    return record


def _integer(value: object, name: str, minimum: int | None = None) -> int:
    if (
        type(value) is not int
        or abs(value) > 9_007_199_254_740_991
        or (minimum is not None and value < minimum)
    ):
        qualifier = "" if minimum is None else f" of at least {minimum}"
        raise ValueError(f"{name} must be an integer{qualifier}.")
    return value


def _identifier(value: object, name: str) -> str:
    if not isinstance(value, str) or _IDENTIFIER.fullmatch(value) is None:
        raise ValueError(f"{name} must be a canonical identifier.")
    return value


def _decode_window(value: object, name: str) -> WindowPin:
    record = _record(
        value,
        name,
        frozenset({"paragraphStart", "paragraphEnd", "wordCount", "sha256"}),
    )
    start = _integer(record["paragraphStart"], f"{name} paragraphStart", 0)
    end = _integer(record["paragraphEnd"], f"{name} paragraphEnd", 0)
    word_count = _integer(record["wordCount"], f"{name} wordCount", 0)
    digest = record["sha256"]
    if not isinstance(digest, str):
        raise ValueError(f"{name} sha256 must be a string.")
    pin = WindowPin(start, end, word_count, digest)
    if pin.is_discovery:
        return pin
    if start == 0 or end == 0 or word_count == 0 or digest == "":
        raise ValueError(f"{name} discovery values must be all zero and empty.")
    if end < start:
        raise ValueError(f"{name} paragraph range must be ordered.")
    if not MINIMUM_WINDOW_WORDS <= word_count <= MAXIMUM_WINDOW_WORDS:
        raise ValueError(f"{name} wordCount must be within the declared window envelope.")
    if _DIGEST.fullmatch(digest) is None:
        raise ValueError(f"{name} sha256 must be a lowercase SHA-256 digest.")
    return pin


def _ratio(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number between zero and one.")
    result = float(value)
    if not math.isfinite(result) or not 0 <= result <= 1:
        raise ValueError(f"{name} must be a number between zero and one.")
    return result


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
        record = _record(
            raw,
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
        if fixture_id in seen:
            raise ValueError(f"Fixture catalog contains duplicate fixtureId {fixture_id}.")
        seen.add(fixture_id)
        source = _record(record["source"], f"{name} source", frozenset({"sourceId", "window"}))
        source_id = _identifier(source["sourceId"], f"{name} source sourceId")
        raw_references = record["references"]
        if not isinstance(raw_references, list) or not raw_references:
            raise ValueError(f"{name} references must be a non-empty array.")
        references = tuple(
            _identifier(reference, f"{name} references[{reference_index}]")
            for reference_index, reference in enumerate(raw_references)
        )
        if len(set(references)) != len(references) or source_id in references:
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
        for variant_index, raw_variant in enumerate(raw_variants):
            variant_name = f"{name} variants[{variant_index}]"
            variant = _record(
                raw_variant,
                variant_name,
                frozenset({"variantId", "rekeyFromStage"}),
            )
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
        fixtures.append(
            FixtureDefinition(
                fixture_id=fixture_id,
                source_id=source_id,
                references=references,
                seed=_integer(record["seed"], f"{name} seed"),
                window=_decode_window(source["window"], f"{name} source window"),
                agent_ids=agent_ids,
                stage_count=stage_count,
                variants=tuple(variants),
                allocation_constraints=_decode_allocation_constraints(
                    record["allocationConstraints"], f"{name} allocationConstraints"
                ),
            )
        )
    return FixtureCatalog(tuple(fixtures))


def load_fixture_catalog(path: Path) -> FixtureCatalog:
    return decode_fixture_catalog(json.loads(path.read_text(encoding="utf-8")))


@dataclass(frozen=True)
class ParagraphUnit:
    ordinal: int
    text: str
    word_count: int
    sha256: str
    word_counts: tuple[tuple[str, int], ...]
    neighbor_sets: tuple[tuple[str, tuple[str, ...]], ...]

    @classmethod
    def from_text(cls, ordinal: int, text: str) -> ParagraphUnit:
        if type(ordinal) is not int or ordinal < 1:
            raise ValueError("Paragraph ordinal must be positive.")
        canonical = unicodedata.normalize("NFC", " ".join(text.split()))
        tokens = tuple(
            token.normalized for token in word_tokens(canonical) if token.normalized is not None
        )
        if len(tokens) < MINIMUM_PARAGRAPH_WORDS:
            raise ValueError(
                f"Canonical prose paragraphs require at least {MINIMUM_PARAGRAPH_WORDS} words."
            )
        neighbors: dict[str, set[str]] = defaultdict(set)
        for index, word in enumerate(tokens):
            if index > 0:
                neighbors[word].add(tokens[index - 1])
            if index + 1 < len(tokens):
                neighbors[word].add(tokens[index + 1])
        return cls(
            ordinal=ordinal,
            text=canonical,
            word_count=len(tokens),
            sha256=sha256_hex(canonical.encode("utf-8")),
            word_counts=tuple(sorted(Counter(tokens).items())),
            neighbor_sets=tuple(
                (word, tuple(sorted(values))) for word, values in sorted(neighbors.items())
            ),
        )

    def counts(self) -> Counter[str]:
        return Counter(dict(self.word_counts))

    def neighbors(self) -> dict[str, set[str]]:
        return {word: set(values) for word, values in self.neighbor_sets}


@dataclass(frozen=True)
class ParagraphWindow:
    paragraphs: tuple[ParagraphUnit, ...]
    paragraph_start: int
    paragraph_end: int
    word_count: int
    sha256: str
    boundary_index: int

    @property
    def pre(self) -> tuple[ParagraphUnit, ...]:
        return self.paragraphs[: self.boundary_index]

    @property
    def post(self) -> tuple[ParagraphUnit, ...]:
        return self.paragraphs[self.boundary_index :]

    def pin(self) -> WindowPin:
        return WindowPin(
            self.paragraph_start,
            self.paragraph_end,
            self.word_count,
            self.sha256,
        )


def _window_digest(paragraphs: Sequence[ParagraphUnit]) -> str:
    content = ("\n\n".join(paragraph.text for paragraph in paragraphs) + "\n").encode("utf-8")
    return sha256_hex(content)


def candidate_windows(paragraphs: Sequence[ParagraphUnit]) -> Iterator[ParagraphWindow]:
    ordered = tuple(paragraphs)
    if any(
        paragraph.ordinal != ordered[0].ordinal + index for index, paragraph in enumerate(ordered)
    ):
        raise ValueError("Paragraph units must use contiguous increasing source ordinals.")
    for start_index in range(min(len(ordered), MAX_WINDOW_STARTS)):
        mass = 0
        end_index = start_index
        while end_index < len(ordered) and mass < TARGET_WINDOW_WORDS:
            mass += ordered[end_index].word_count
            end_index += 1
        if mass < TARGET_WINDOW_WORDS:
            continue
        if mass > MAXIMUM_WINDOW_WORDS:
            preceding_mass = mass - ordered[end_index - 1].word_count
            if preceding_mass < MINIMUM_WINDOW_WORDS:
                continue
            end_index -= 1
            mass = preceding_mass
        selected = ordered[start_index:end_index]
        if len(selected) < MINIMUM_REGION_PARAGRAPHS * 2:
            continue
        half = mass / 2
        pre_mass = 0
        boundary_index: int | None = None
        for local_index, paragraph in enumerate(selected, start=1):
            pre_mass += paragraph.word_count
            if (
                local_index >= MINIMUM_REGION_PARAGRAPHS
                and len(selected) - local_index >= MINIMUM_REGION_PARAGRAPHS
                and pre_mass >= half
            ):
                boundary_index = local_index
                break
        if boundary_index is None:
            continue
        yield ParagraphWindow(
            paragraphs=selected,
            paragraph_start=selected[0].ordinal,
            paragraph_end=selected[-1].ordinal,
            word_count=mass,
            sha256=_window_digest(selected),
            boundary_index=boundary_index,
        )


@dataclass(frozen=True)
class ParagraphAssignment:
    paragraph: ParagraphUnit
    agent_id: str
    stage: int

    def __post_init__(self) -> None:
        if _IDENTIFIER.fullmatch(self.agent_id) is None or self.stage < 1:
            raise ValueError("Paragraph assignment has invalid agent or stage.")


@dataclass(frozen=True)
class Allocation:
    tier_name: str
    allocation_id: str
    agent_ids: tuple[str, ...]
    stage_count: int
    boundary_stage: int
    assignments: tuple[ParagraphAssignment, ...]

    def stage_paragraphs(self, agent_id: str, stage: int) -> tuple[ParagraphUnit, ...]:
        return tuple(
            assignment.paragraph
            for assignment in self.assignments
            if assignment.agent_id == agent_id and assignment.stage == stage
        )


def make_allocation(
    tier_name: str,
    assignments: Iterable[ParagraphAssignment],
    *,
    agent_ids: tuple[str, ...],
    stage_count: int,
    boundary_stage: int,
) -> Allocation:
    ordered = tuple(sorted(assignments, key=lambda item: item.paragraph.ordinal))
    ordinals = tuple(item.paragraph.ordinal for item in ordered)
    if len(ordinals) != len(set(ordinals)):
        raise ValueError("Allocation contains duplicate paragraph assignments.")
    if any(item.agent_id not in agent_ids or item.stage > stage_count for item in ordered):
        raise ValueError("Allocation assignment is outside the declared fixture geometry.")
    if not 2 <= boundary_stage <= stage_count:
        raise ValueError("Allocation boundary must leave non-empty pre and post regions.")
    basis = [
        {
            "paragraphOrdinal": item.paragraph.ordinal,
            "agentId": item.agent_id,
            "stage": item.stage,
        }
        for item in ordered
    ]
    return Allocation(
        tier_name=tier_name,
        allocation_id="allocation-" + sha256_hex(canonical_json_bytes(basis)),
        agent_ids=agent_ids,
        stage_count=stage_count,
        boundary_stage=boundary_stage,
        assignments=ordered,
    )


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def initial_allocation(
    window: ParagraphWindow,
    fixture_id: str,
    seed: int,
    tier: AllocationTier,
    *,
    agent_ids: tuple[str, ...],
    stage_count: int,
    boundary_stage: int,
) -> Allocation:
    assignments: list[ParagraphAssignment] = []
    regions = (
        ("pre", window.pre, tuple(range(1, boundary_stage))),
        ("post", window.post, tuple(range(boundary_stage, stage_count + 1))),
    )
    for region_name, paragraphs, stages in regions:
        ranked = sorted(
            paragraphs,
            key=lambda paragraph: (
                -paragraph.word_count,
                _hash(
                    "palimpsest-block:v1:"
                    f"{seed}:{fixture_id}:{tier.name}:{region_name}:{paragraph.sha256}"
                ),
                paragraph.ordinal,
            ),
        )
        cell_count = len(agent_ids) * len(stages)
        cell_mass = [0] * cell_count
        for paragraph in ranked:
            paragraph_rank = _hash(
                "palimpsest-block:v1:"
                f"{seed}:{fixture_id}:{tier.name}:{region_name}:{paragraph.sha256}"
            )
            cell = min(
                range(cell_count),
                key=lambda cell_index: (
                    cell_mass[cell_index],
                    _hash(f"{paragraph_rank}:{cell_index}"),
                    cell_index,
                ),
            )
            agent_index, stage_index = divmod(cell, len(stages))
            agent_id, stage = agent_ids[agent_index], stages[stage_index]
            assignments.append(ParagraphAssignment(paragraph, agent_id, stage))
            cell_mass[cell] += paragraph.word_count
    return make_allocation(
        tier.name,
        assignments,
        agent_ids=agent_ids,
        stage_count=stage_count,
        boundary_stage=boundary_stage,
    )


@dataclass(frozen=True)
class TypeProfile:
    word: str
    exposures: tuple[int, ...]
    neighbors: frozenset[str]

    @property
    def post_count(self) -> int:
        return sum(self.exposures[1::2])


@dataclass(frozen=True)
class ControlMatch:
    changed_type: str
    control_type: str
    frequency_distance: float
    exposure_distance: float
    context_distance: float
    distance: float


@dataclass(frozen=True)
class DesignMetrics:
    region_deviation: float
    stage_deviation: float
    solo_coverage: Mapping[str, float]
    post_changed_mass: Mapping[str, float]
    global_old_key_loss: float
    maximum_control_distance: float
    min_owner_occurrences_per_region: int
    min_sentinel_occurrences_per_agent_region: int


@dataclass(frozen=True)
class OracleDesign:
    anchors: tuple[str, ...]
    sentinels: tuple[str, ...]
    specialists: Mapping[str, tuple[str, ...]]
    controls: tuple[ControlMatch, ...]
    metrics: DesignMetrics
    profiles: Mapping[str, TypeProfile]
    available_control_types: tuple[str, ...]

    @property
    def changed_types(self) -> tuple[str, ...]:
        return tuple(
            sorted(
                {
                    *self.sentinels,
                    *(word for words in self.specialists.values() for word in words),
                }
            )
        )


class InfeasibleDesignError(ValueError):
    def __init__(self, reasons: Sequence[str]) -> None:
        self.reasons = tuple(reasons)
        super().__init__("Fixture design is infeasible: " + ", ".join(self.reasons))


def _profiles(allocation: Allocation) -> dict[str, TypeProfile]:
    counts: dict[str, list[int]] = defaultdict(lambda: [0] * (len(allocation.agent_ids) * 2))
    neighbors: dict[str, set[str]] = defaultdict(set)
    for assignment in allocation.assignments:
        agent_index = allocation.agent_ids.index(assignment.agent_id)
        region_index = 0 if assignment.stage < allocation.boundary_stage else 1
        component = agent_index * 2 + region_index
        for word, count in assignment.paragraph.word_counts:
            counts[word][component] += count
        for word, adjacent in assignment.paragraph.neighbor_sets:
            neighbors[word].update(adjacent)
    return {
        word: TypeProfile(
            word=word,
            exposures=tuple(values),
            neighbors=frozenset(neighbors[word]),
        )
        for word, values in sorted(counts.items())
    }


def _distance(
    changed: TypeProfile,
    control: TypeProfile,
    maximum_post_count: int,
) -> tuple[float, float, float, float]:
    denominator = math.log1p(maximum_post_count)
    frequency = (
        abs(math.log1p(changed.post_count) - math.log1p(control.post_count)) / denominator
        if denominator
        else 0.0
    )
    changed_total = sum(changed.exposures)
    control_total = sum(control.exposures)
    changed_vector = tuple(value / changed_total for value in changed.exposures)
    control_vector = tuple(value / control_total for value in control.exposures)
    exposure = sum(
        abs(changed_value - control_value)
        for changed_value, control_value in zip(changed_vector, control_vector, strict=True)
    ) / len(changed.exposures)
    context = _context_distance(changed.neighbors, control.neighbors)
    return frequency, exposure, context, (frequency + exposure + context) / 3


def _context_distance(changed: frozenset[str], control: frozenset[str]) -> float:
    union = changed | control
    return 0.0 if not union else 1 - len(changed & control) / len(union)


def _match_controls(
    changed_types: Sequence[str],
    control_types: Sequence[str],
    profiles: Mapping[str, TypeProfile],
    maximum_distance: float,
) -> tuple[ControlMatch, ...]:
    maximum_post_count = max((profile.post_count for profile in profiles.values()), default=0)
    maximum_sum = maximum_distance * 3
    frequency_denominator = math.log1p(maximum_post_count)
    edges: dict[str, list[ControlMatch]] = {}
    for changed_type in changed_types:
        changed = profiles[changed_type]
        candidates: list[ControlMatch] = []
        for control_type in control_types:
            control = profiles[control_type]
            context = _context_distance(changed.neighbors, control.neighbors)
            if context > maximum_sum:
                continue
            frequency = (
                abs(math.log1p(changed.post_count) - math.log1p(control.post_count))
                / frequency_denominator
                if frequency_denominator
                else 0.0
            )
            if context + frequency > maximum_sum:
                continue
            frequency, exposure, context, distance = _distance(
                changed,
                control,
                maximum_post_count,
            )
            if distance <= maximum_distance:
                candidates.append(
                    ControlMatch(
                        changed_type,
                        control_type,
                        frequency,
                        exposure,
                        context,
                        distance,
                    )
                )
        edges[changed_type] = sorted(
            candidates, key=lambda match: (match.distance, match.control_type)
        )

    owner: dict[str, str] = {}
    selected: dict[str, ControlMatch] = {}

    def augment(changed_type: str, seen: set[str]) -> bool:
        for match in edges[changed_type]:
            if match.control_type in seen:
                continue
            seen.add(match.control_type)
            prior = owner.get(match.control_type)
            if prior is None or augment(prior, seen):
                owner[match.control_type] = changed_type
                selected[changed_type] = match
                return True
        return False

    ordered_changed = sorted(
        changed_types,
        key=lambda word: (-profiles[word].post_count, word),
    )
    for changed_type in ordered_changed:
        augment(changed_type, set())
    return tuple(selected[word] for word in ordered_changed if word in selected)


def match_controls(
    changed_types: Sequence[str],
    control_types: Sequence[str],
    profiles: Mapping[str, TypeProfile],
    maximum_distance: float,
) -> tuple[ControlMatch, ...]:
    matches = _match_controls(changed_types, control_types, profiles, maximum_distance)
    if len(matches) != len(changed_types):
        raise InfeasibleDesignError(("unmatched-controls",))
    return matches


def _token_metrics(
    paragraphs: Sequence[ParagraphUnit],
    allocation: Allocation,
) -> tuple[float, float, bool]:
    masses = {
        (agent_id, stage): sum(
            paragraph.word_count for paragraph in allocation.stage_paragraphs(agent_id, stage)
        )
        for agent_id in allocation.agent_ids
        for stage in range(1, allocation.stage_count + 1)
    }
    region_deviation = 0.0
    stage_deviation = 0.0
    for stages in (
        tuple(range(1, allocation.boundary_stage)),
        tuple(range(allocation.boundary_stage, allocation.stage_count + 1)),
    ):
        region_total = sum(
            masses[agent_id, stage] for agent_id in allocation.agent_ids for stage in stages
        )
        agent_ideal = region_total / len(allocation.agent_ids)
        stage_ideal = region_total / (len(allocation.agent_ids) * len(stages))
        for agent_id in allocation.agent_ids:
            agent_mass = sum(masses[agent_id, stage] for stage in stages)
            region_deviation = max(
                region_deviation,
                abs(agent_mass - agent_ideal) / agent_ideal,
            )
            for stage in stages:
                stage_deviation = max(
                    stage_deviation,
                    abs(masses[agent_id, stage] - stage_ideal) / stage_ideal,
                )
    spread_ok = max(masses.values()) - min(masses.values()) <= max(
        paragraph.word_count for paragraph in paragraphs
    )
    return region_deviation, stage_deviation, spread_ok


def _attempt_oracle(
    paragraphs: Sequence[ParagraphUnit],
    allocation: Allocation,
    tier: AllocationTier,
    constraints: AllocationConstraints,
) -> tuple[OracleDesign, tuple[str, ...], tuple[object, ...]]:
    expected = {paragraph.ordinal for paragraph in paragraphs}
    actual = [assignment.paragraph.ordinal for assignment in allocation.assignments]
    hard_violations = 0
    reasons: list[str] = []
    if set(actual) != expected or len(actual) != len(set(actual)):
        hard_violations += 1
        reasons.append("paragraph-union")
    if any(
        not allocation.stage_paragraphs(agent_id, stage)
        for agent_id in allocation.agent_ids
        for stage in range(1, allocation.stage_count + 1)
    ):
        hard_violations += 1
        reasons.append("empty-stage")

    profiles = _profiles(allocation)
    universal = [
        word for word, profile in profiles.items() if all(count >= 1 for count in profile.exposures)
    ]
    anchors = tuple(
        sorted(universal, key=lambda word: (profiles[word].post_count, word))[
            : constraints.minimum_anchors
        ]
    )
    reserved = set(anchors)
    sentinel_candidates = sorted(
        (
            word
            for word, profile in profiles.items()
            if word not in reserved
            and all(count >= tier.sentinel_occurrences for count in profile.exposures)
        ),
        key=lambda word: (-profiles[word].post_count, word),
    )
    sentinels = list(sentinel_candidates[: constraints.minimum_sentinels])
    reserved.update(sentinels)

    specialists: dict[str, tuple[str, ...]] = {}
    owner_share_deficit = 0.0
    for agent_index, agent_id in enumerate(allocation.agent_ids):
        candidates: list[tuple[float, str]] = []
        for word, profile in profiles.items():
            if word in reserved:
                continue
            pre_total = sum(profile.exposures[0::2])
            post_total = sum(profile.exposures[1::2])
            owner_pre = profile.exposures[agent_index * 2]
            owner_post = profile.exposures[agent_index * 2 + 1]
            if not pre_total or not post_total:
                continue
            owner_share = min(owner_pre / pre_total, owner_post / post_total)
            if (
                owner_pre >= tier.owner_occurrences
                and owner_post >= tier.owner_occurrences
                and owner_share >= tier.specialist_owner_share
            ):
                candidates.append((owner_share, word))
        chosen = tuple(
            word
            for _, word in sorted(
                candidates,
                key=lambda item: (-item[0], -profiles[item[1]].post_count, item[1]),
            )[: constraints.minimum_specialists_per_agent]
        )
        specialists[agent_id] = chosen
        reserved.update(chosen)
        if len(chosen) < constraints.minimum_specialists_per_agent:
            owner_share_deficit += constraints.minimum_specialists_per_agent - len(chosen)

    def changed_set() -> set[str]:
        return {
            *sentinels,
            *(word for words in specialists.values() for word in words),
        }

    post_totals = {
        agent_id: sum(
            assignment.paragraph.word_count
            for assignment in allocation.assignments
            if assignment.agent_id == agent_id and assignment.stage >= allocation.boundary_stage
        )
        for agent_id in allocation.agent_ids
    }

    def changed_mass(agent_index: int, changed: set[str]) -> float:
        return (
            sum(profiles[word].exposures[agent_index * 2 + 1] for word in changed)
            / post_totals[allocation.agent_ids[agent_index]]
        )

    remaining_sentinels = iter(sentinel_candidates[constraints.minimum_sentinels :])
    while sentinels and any(
        changed_mass(agent_index, changed_set()) < constraints.minimum_changed_mass
        for agent_index in range(len(allocation.agent_ids))
    ):
        try:
            next_sentinel = next(remaining_sentinels)
        except StopIteration:
            break
        if next_sentinel not in reserved:
            sentinels.append(next_sentinel)
            reserved.add(next_sentinel)

    changed = tuple(sorted(changed_set()))
    available_controls = tuple(sorted(set(profiles) - set(anchors) - set(changed)))
    controls = _match_controls(
        changed,
        available_controls,
        profiles,
        tier.max_control_distance,
    )
    matched_changed = {match.changed_type for match in controls}
    unmatched_count = len(changed) - len(matched_changed)

    solo_coverage = {
        agent_id: (
            sum(
                profiles[word].exposures[agent_index * 2] >= tier.owner_occurrences
                and profiles[word].exposures[agent_index * 2 + 1] >= tier.owner_occurrences
                for word in changed
            )
            / len(changed)
            if changed
            else 1.0
        )
        for agent_index, agent_id in enumerate(allocation.agent_ids)
    }
    post_changed_mass = {
        allocation.agent_ids[agent_index]: changed_mass(agent_index, set(changed))
        for agent_index in range(len(allocation.agent_ids))
    }
    total_post = sum(post_totals.values())
    global_loss = (
        sum(sum(profile.exposures[1::2]) for word, profile in profiles.items() if word in changed)
        / total_post
    )
    region_deviation, stage_deviation, spread_ok = _token_metrics(paragraphs, allocation)
    if not spread_ok:
        hard_violations += 1
        reasons.append("stage-spread")

    anchor_deficit = max(0, constraints.minimum_anchors - len(anchors))
    sentinel_deficit = max(0, constraints.minimum_sentinels - len(sentinels))
    specialist_deficit = sum(
        max(0, constraints.minimum_specialists_per_agent - len(words))
        for words in specialists.values()
    )
    region_excess = max(0.0, region_deviation - tier.max_region_deviation)
    stage_excess = max(0.0, stage_deviation - tier.max_stage_deviation)
    solo_excess = sum(max(0.0, value - tier.max_solo_coverage) for value in solo_coverage.values())
    changed_mass_deficit = sum(
        max(0.0, constraints.minimum_changed_mass - value) for value in post_changed_mass.values()
    )
    old_key_loss_deficit = max(0.0, constraints.minimum_changed_mass - global_loss)

    for code, deficit in (
        ("token-balance", region_excess + stage_excess),
        ("anchor-deficit", float(anchor_deficit)),
        ("sentinel-deficit", float(sentinel_deficit)),
        ("specialist-deficit", float(specialist_deficit)),
        ("owner-share", owner_share_deficit),
        ("solo-coverage", solo_excess),
        ("changed-mass", changed_mass_deficit),
        ("unmatched-controls", float(unmatched_count)),
        ("old-key-loss", old_key_loss_deficit),
    ):
        if deficit > 0 and code not in reasons:
            reasons.append(code)

    metrics = DesignMetrics(
        region_deviation=region_deviation,
        stage_deviation=stage_deviation,
        solo_coverage=solo_coverage,
        post_changed_mass=post_changed_mass,
        global_old_key_loss=global_loss,
        maximum_control_distance=max((match.distance for match in controls), default=0.0),
        min_owner_occurrences_per_region=min(
            (
                min(
                    profiles[word].exposures[agent_index * 2],
                    profiles[word].exposures[agent_index * 2 + 1],
                )
                for agent_index, agent_id in enumerate(allocation.agent_ids)
                for word in specialists[agent_id]
            ),
            default=0,
        ),
        min_sentinel_occurrences_per_agent_region=min(
            (count for word in sentinels for count in profiles[word].exposures),
            default=0,
        ),
    )
    design = OracleDesign(
        anchors=anchors,
        sentinels=tuple(sentinels),
        specialists=specialists,
        controls=controls,
        metrics=metrics,
        profiles=profiles,
        available_control_types=available_controls,
    )
    signature = tuple(
        (allocation.agent_ids.index(item.agent_id) * allocation.stage_count + item.stage - 1)
        for item in allocation.assignments
    )
    score = (
        hard_violations,
        region_excess,
        stage_excess,
        anchor_deficit,
        sentinel_deficit,
        specialist_deficit,
        owner_share_deficit,
        solo_excess,
        changed_mass_deficit,
        unmatched_count,
        0.0,
        old_key_loss_deficit,
        signature,
    )
    return design, tuple(reasons), score


def design_oracle(
    paragraphs: Sequence[ParagraphUnit],
    allocation: Allocation,
    tier: AllocationTier,
    constraints: AllocationConstraints,
) -> OracleDesign:
    design, reasons, _ = _attempt_oracle(paragraphs, allocation, tier, constraints)
    if reasons:
        raise InfeasibleDesignError(reasons)
    return design


@dataclass(frozen=True)
class TierRejection:
    tier: str
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class AllocationResult:
    allocation: Allocation
    design: OracleDesign
    tier: AllocationTier
    rejected_tiers: tuple[TierRejection, ...]


def allocate_window(
    window: ParagraphWindow,
    fixture: FixtureDefinition,
) -> AllocationResult:
    rejected: list[TierRejection] = []
    for tier in fixture.allocation_constraints.tiers:
        allocation = initial_allocation(
            window,
            fixture.fixture_id,
            fixture.seed,
            tier,
            agent_ids=fixture.agent_ids,
            stage_count=fixture.stage_count,
            boundary_stage=fixture.rekey_from_stage,
        )
        design, reasons, _ = _attempt_oracle(
            window.paragraphs,
            allocation,
            tier,
            fixture.allocation_constraints,
        )
        if not reasons:
            return AllocationResult(allocation, design, tier, tuple(rejected))
        rejected.append(TierRejection(tier.name, reasons))
    detail = "; ".join(
        f"{rejection.tier}: {', '.join(rejection.reasons)}" for rejection in rejected
    )
    raise InfeasibleDesignError((detail,))


@dataclass(frozen=True)
class FixtureDesign:
    fixture: FixtureDefinition
    window: ParagraphWindow
    allocation: AllocationResult


def design_fixture(
    paragraphs: Sequence[ParagraphUnit],
    fixture: FixtureDefinition,
    *,
    discover: bool,
) -> FixtureDesign:
    if discover != fixture.window.is_discovery:
        state = "discovery" if fixture.window.is_discovery else "committed"
        raise ValueError(
            f"Fixture {fixture.fixture_id} has a {state} window incompatible with this build."
        )
    for window in candidate_windows(paragraphs):
        try:
            allocation = allocate_window(window, fixture)
        except InfeasibleDesignError:
            continue
        if not discover and window.pin() != fixture.window:
            raise ValueError(
                f"Fixture {fixture.fixture_id} pin is not the first deterministic feasible window."
            )
        return FixtureDesign(fixture, window, allocation)
    raise InfeasibleDesignError(("no-feasible-window",))
