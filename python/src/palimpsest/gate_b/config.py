from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

GATE_B_PROFILE = "stationary-render-safe-v1"
TARGET_TOKEN_COUNT = 20_000
FRONTIER_MODEL = "gpt-5.6-sol"
FRONTIER_REASONING_EFFORT = "max"
FRONTIER_REASONING_SUMMARY = "detailed"
FRONTIER_MAX_OUTPUT_TOKENS = 64_000
PIPELINE_VERSIONS = {
    "strip": "2.0.0",
    "normalization": "1.0.0",
    "tokenization": "1.0.0",
    "entities": "1.0.0",
    "key": "1.0.0",
    "rendering": "1.0.0",
}

MODEL_REVISIONS = {
    "distilroberta": "fb53ab8802853c8e4fbdbcd0529f21fc6f459b2b",
    "spacy": "en_core_web_sm-3.8.0",
}

DEPENDENCY_VERSIONS = {
    "en-core-web-sm": "3.8.0",
    "numpy": "2.5.1",
    "openai": "2.48.0",
    "scikit-learn": "1.9.0",
    "scipy": "1.18.0",
    "spacy": "3.8.14",
    "torch": "2.13.0",
    "transformers": "5.14.1",
}


@dataclass(frozen=True)
class GateBInstanceConfig:
    diagnostic_role: str
    entity_review_path: Path
    instance_id: str
    source_id: str
    source_path: Path
    source_format: str
    source_tier: str
    title: str
    author: str
    catalog_url: str
    download_url: str
    rights: str
    seed_hex: str
    interior_chapter_index: int


GATE_B_INSTANCES = (
    GateBInstanceConfig(
        diagnostic_role="unrecognized-literary",
        entity_review_path=Path("artifacts/gate-b/inputs/entity-review/instance-amber.json"),
        instance_id="instance-amber",
        source_id="middlemarch",
        source_path=Path("artifacts/gate-a/inputs/sources/middlemarch.txt"),
        source_format="gutenberg-text",
        source_tier="gutenberg",
        title="Middlemarch",
        author="George Eliot",
        catalog_url="https://www.gutenberg.org/ebooks/145",
        download_url="https://www.gutenberg.org/cache/epub/145/pg145.txt",
        rights="Project Gutenberg License; catalog record states public domain in the USA",
        seed_hex="41" * 32,
        interior_chapter_index=20,
    ),
    GateBInstanceConfig(
        diagnostic_role="recognized-literary",
        entity_review_path=Path("artifacts/gate-b/inputs/entity-review/instance-birch.json"),
        instance_id="instance-birch",
        source_id="moby-dick",
        source_path=Path("artifacts/gate-a/inputs/sources/moby-dick.txt"),
        source_format="gutenberg-text",
        source_tier="gutenberg",
        title="Moby-Dick; or, The Whale",
        author="Herman Melville",
        catalog_url="https://www.gutenberg.org/ebooks/2701",
        download_url="https://www.gutenberg.org/cache/epub/2701/pg2701.txt",
        rights="Project Gutenberg License; catalog record states public domain in the USA",
        seed_hex="42" * 32,
        interior_chapter_index=35,
    ),
    GateBInstanceConfig(
        diagnostic_role="unrecognized-non-literary",
        entity_review_path=Path("artifacts/gate-b/inputs/entity-review/instance-cobalt.json"),
        instance_id="instance-cobalt",
        source_id="farm-mechanics",
        source_path=Path("artifacts/gate-b/inputs/sources/farm-mechanics.txt"),
        source_format="gutenberg-technical-text",
        source_tier="gutenberg",
        title="Farm Mechanics: Machinery and Its Use to Save Hand Labor on the Farm",
        author="Herbert A. Shearer",
        catalog_url="https://www.gutenberg.org/ebooks/39791",
        download_url="https://www.gutenberg.org/cache/epub/39791/pg39791.txt",
        rights="Project Gutenberg License; catalog record states public domain in the USA",
        seed_hex="43" * 32,
        interior_chapter_index=3,
    ),
)

DECISION_THRESHOLDS = {
    "mechanicalMaximumExclusive": 0.85,
    "mechanicalUnresolvedMinimumInclusive": 0.15,
    "capableGainMinimumInclusive": 0.10,
    "capableFinalMinimumInclusive": 0.25,
    "entityConsistencyMinimumInclusive": 0.99,
    "entityMissedMaximumInclusive": 0.10,
    "commonNounOverCaptureMaximumInclusive": 0.02,
    "generatedNameCollisions": 0,
}
