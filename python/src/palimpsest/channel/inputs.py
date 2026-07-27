from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

from palimpsest.channel.fixtures import build_opaque_shard, normalize_source_text
from palimpsest.channel.useful_state import build_useful_state_checkpoints

ROOT = Path(__file__).resolve().parents[4]
INPUT_ROOT = ROOT / "artifacts" / "gate-a" / "inputs"
SOURCE_IDS = ("middlemarch", "moby-dick", "count-of-monte-cristo", "jane-eyre")
GEOMETRIES = (
    (16_384, 4_096),
    (16_384, 8_000),
    (16_384, 12_288),
    (27_000, 4_096),
    (27_000, 8_000),
    (27_000, 12_288),
    (40_960, 4_096),
    (40_960, 8_000),
    (40_960, 12_288),
)


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def artifact_reference(path: Path, artifact_type: str) -> dict[str, object]:
    payload = path.read_bytes()
    return {
        "artifactType": artifact_type,
        "byteLength": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def build_source_corpus() -> str:
    sources = []
    for source_id in SOURCE_IDS:
        source = (INPUT_ROOT / "sources" / f"{source_id}.txt").read_text(encoding="utf-8")
        sources.append(normalize_source_text(source))
    return "\n\n".join(sources)


def write_fixture(corpus: str, token_count: int, vocabulary_size: int) -> None:
    fixture_root = INPUT_ROOT / "fixtures"
    fixture_root.mkdir(parents=True, exist_ok=True)
    geometry_id = f"tokens-{token_count}-vocab-{vocabulary_size}"
    shard = build_opaque_shard(
        corpus,
        token_count=token_count,
        vocabulary_size=vocabulary_size,
    )
    opaque_path = fixture_root / f"{geometry_id}.opaque.txt"
    token_ids_path = fixture_root / f"{geometry_id}.token-ids.bin"
    vocabulary_path = fixture_root / f"{geometry_id}.vocabulary.json"
    metadata_path = fixture_root / f"{geometry_id}.json"
    opaque_path.write_bytes(shard.rendered)
    token_ids_path.write_bytes(
        b"".join(struct.pack(">I", token_id) for token_id in shard.token_ids)
    )
    vocabulary_path.write_bytes(canonical_bytes(list(shard.vocabulary)))
    metadata_path.write_bytes(
        canonical_bytes(
            {
                "geometryId": geometry_id,
                "normalizationVersion": "1.0.0",
                "opaqueShard": artifact_reference(opaque_path, "opaque-shard"),
                "schemaVersion": 1,
                "tokenCount": token_count,
                "tokenIds": artifact_reference(token_ids_path, "opaque-token-ids"),
                "vocabulary": artifact_reference(vocabulary_path, "shared-vocabulary"),
                "vocabularySize": vocabulary_size,
            }
        )
    )


def write_useful_state() -> None:
    useful_root = INPUT_ROOT / "useful"
    useful_root.mkdir(parents=True, exist_ok=True)
    references = []
    for checkpoint in build_useful_state_checkpoints():
        path = useful_root / f"{checkpoint['checkpointId']}.json"
        path.write_bytes(canonical_bytes(checkpoint))
        references.append(
            {
                "checkpointId": checkpoint["checkpointId"],
                **artifact_reference(path, "useful-state-checkpoint"),
            }
        )
    (useful_root / "manifest.json").write_bytes(
        canonical_bytes(
            {
                "checkpoints": references,
                "contractId": "gate-a-useful-state-manifest",
                "schemaVersion": 1,
            }
        )
    )


def main() -> None:
    corpus = build_source_corpus()
    for token_count, vocabulary_size in GEOMETRIES:
        write_fixture(corpus, token_count, vocabulary_size)
    write_useful_state()


if __name__ == "__main__":
    main()
