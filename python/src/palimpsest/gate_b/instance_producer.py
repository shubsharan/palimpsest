from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex, validate_value
from palimpsest.generation.builder import BuildResult, build_instance
from palimpsest.generation.text import word_tokens

from .artifacts import artifact_reference, write_canonical, write_text
from .config import (
    GATE_B_INSTANCES,
    GATE_B_PROFILE,
    MODEL_REVISIONS,
    PIPELINE_VERSIONS,
    TARGET_TOKEN_COUNT,
    GateBInstanceConfig,
)

ROOT = Path(__file__).resolve().parents[4]
GATE_B_ROOT = ROOT / "artifacts" / "gate-b"
MODEL_ROOT = GATE_B_ROOT / "inputs" / "models" / "distilroberta-base"
REFERENCE_SOURCE = (
    ROOT / "artifacts" / "gate-a" / "inputs" / "sources" / "count-of-monte-cristo.txt"
)
ENTITY_SOURCE = ROOT / "python" / "src" / "palimpsest" / "generation" / "entities.py"


def _assert_no_source_collisions() -> None:
    for config in GATE_B_INSTANCES:
        source_record_path = (
            GATE_B_ROOT / "instances" / config.instance_id / "sealed" / "source-record.json"
        )
        if not source_record_path.exists():
            continue
        existing = json.loads(source_record_path.read_text(encoding="utf-8"))
        if existing.get("sourceId") != config.source_id:
            raise RuntimeError(
                f"{config.instance_id} already contains immutable evidence for a different "
                "source; archive that instance directory before building the replacement."
            )


def _validate(contract_id: str, value: dict[str, Any]) -> None:
    verdict = validate_value(contract_id, value)
    if not verdict.accepted:
        raise ValueError(
            f"{contract_id} rejected generated value: {verdict.reason} at {verdict.pointer}"
        )


def _model_artifacts() -> list[dict[str, Any]]:
    return [
        artifact_reference(MODEL_ROOT / "model.safetensors", "masked-language-model-weights"),
        artifact_reference(MODEL_ROOT / "tokenizer.json", "masked-language-model-tokenizer"),
        artifact_reference(MODEL_ROOT / "config.json", "masked-language-model-config"),
    ]


def _source_record(config: GateBInstanceConfig) -> dict[str, Any]:
    record = {
        "schemaVersion": 1,
        "contractId": "gate-b-source-record",
        "sourceId": config.source_id,
        "tier": config.source_tier,
        "title": config.title,
        "author": config.author,
        "catalogUrl": config.catalog_url,
        "downloadUrl": config.download_url,
        "rights": config.rights,
        "retrievedAt": "2026-07-26",
        "encoding": "utf-8",
        "stripProfile": PIPELINE_VERSIONS["strip"],
        "rawArtifact": artifact_reference(config.source_path, "public-domain-source"),
    }
    _validate("gate-b-source-record", record)
    return record


def _write_instance(config: GateBInstanceConfig, result: BuildResult) -> dict[str, Any]:
    output_root = GATE_B_ROOT / "instances" / config.instance_id
    prepared_ref = write_text(
        output_root / "sealed" / "prepared.txt",
        result.prepared_text,
        "prepared-plaintext",
    )
    write_text(
        output_root / "sealed" / "source-span.txt",
        result.selected_span.text,
        "selected-source-span",
    )
    cipher_ref = write_text(
        output_root / "public" / "cipher.txt",
        result.cipher_text,
        "cipher-view",
    )
    tokens = [
        {
            "index": index,
            "normalized": token.normalized,
            "surface": token.surface,
        }
        for index, token in enumerate(word_tokens(result.prepared_text))
    ]
    token_ref = write_canonical(output_root / "sealed" / "tokens.json", tokens)
    vocabulary_ref = write_canonical(
        output_root / "sealed" / "vocabulary.json",
        list(result.vocabulary),
    )
    encryption_ref = write_canonical(
        output_root / "sealed" / "encryption-key.json",
        result.encryption_key,
    )
    recovered_ref = write_canonical(
        output_root / "sealed" / "recovered-mapping.json",
        result.recovered_mapping,
    )
    review_patch_ref = artifact_reference(config.entity_review_path, "entity-review-patch")
    type_mapping_ref = write_canonical(
        output_root / "sealed" / "entity-type-mapping.json",
        result.entity_mapping,
    )
    entity_map = {
        "schemaVersion": 1,
        "contractId": "gate-b-entity-regeneration-map",
        "instanceId": config.instance_id,
        "proposalModel": {
            "artifactType": "spacy-model",
            "byteLength": len(MODEL_REVISIONS["spacy"].encode()),
            "sha256": sha256_hex(MODEL_REVISIONS["spacy"].encode()),
        },
        "reviewPatch": review_patch_ref,
        "lexicon": artifact_reference(ENTITY_SOURCE, "entity-regeneration-lexicon"),
        "typeMapping": type_mapping_ref,
        "entities": [
            {
                "roleId": entity["roleId"],
                "entityClass": entity["entityClass"],
                "aliases": entity["aliases"],
                "replacement": " ".join(entity["replacementAliases"]),
            }
            for entity in result.entities
        ],
        "collisionCount": 0,
    }
    _validate("gate-b-entity-regeneration-map", entity_map)
    entity_ref = write_canonical(output_root / "sealed" / "entity-map.json", entity_map)
    source_record = _source_record(config)
    source_record_ref = write_canonical(
        output_root / "sealed" / "source-record.json",
        source_record,
    )
    prepared_manifest = {
        "schemaVersion": 1,
        "contractId": "gate-b-prepared-plaintext-manifest",
        "instanceId": config.instance_id,
        "tokenCount": TARGET_TOKEN_COUNT,
        "vocabularySize": len(result.vocabulary),
        "chapterCount": result.selected_span.end_chapter - result.selected_span.start_chapter + 1,
        "pipelineVersions": PIPELINE_VERSIONS,
        "preparedText": prepared_ref,
        "tokens": token_ref,
        "vocabulary": vocabulary_ref,
    }
    _validate("gate-b-prepared-plaintext-manifest", prepared_manifest)
    prepared_manifest_ref = write_canonical(
        output_root / "sealed" / "prepared-manifest.json",
        prepared_manifest,
    )
    resource_policy_ref = artifact_reference(
        GATE_B_ROOT / "inputs" / "solver-policies" / "mechanical.json",
        "mechanical-resource-policy",
    )
    reference_ref = artifact_reference(REFERENCE_SOURCE, "target-excluded-reference-corpus")
    public_manifest = {
        "schemaVersion": 1,
        "contractId": "gate-b-public-instance-manifest",
        "instanceId": config.instance_id,
        "profileId": GATE_B_PROFILE,
        "tokenCount": TARGET_TOKEN_COUNT,
        "vocabularySize": len(result.vocabulary),
        "cipherView": cipher_ref,
        "referenceCorpus": reference_ref,
        "publicScoringVersion": "1.0.0",
        "allowedModels": _model_artifacts(),
        "resourcePolicy": resource_policy_ref,
    }
    _validate("gate-b-public-instance-manifest", public_manifest)
    public_manifest_ref = write_canonical(
        output_root / "public" / "manifest.json",
        public_manifest,
    )
    oracle_manifest = {
        "schemaVersion": 1,
        "contractId": "gate-b-oracle-manifest",
        "instanceId": config.instance_id,
        "sourceRecord": source_record_ref,
        "preparedPlaintext": prepared_ref,
        "tokenTruth": token_ref,
        "encryptionKey": encryption_ref,
        "recoveredMapping": recovered_ref,
        "entityMap": entity_ref,
    }
    _validate("gate-b-oracle-manifest", oracle_manifest)
    oracle_manifest_ref = write_canonical(
        output_root / "sealed" / "oracle-manifest.json",
        oracle_manifest,
    )
    output_manifest = {
        "schemaVersion": 1,
        "diagnosticRole": config.diagnostic_role,
        "instanceId": config.instance_id,
        "sourceId": config.source_id,
        "selectedChapters": {
            "start": result.selected_span.start_chapter,
            "end": result.selected_span.end_chapter,
        },
        "artifacts": {
            "publicManifest": public_manifest_ref,
            "preparedManifest": prepared_manifest_ref,
            "oracleManifest": oracle_manifest_ref,
        },
    }
    write_canonical(output_root / "output-manifest.json", output_manifest)
    return output_manifest


def produce_all() -> dict[str, Any]:
    _assert_no_source_collisions()
    manifests = []
    for config in GATE_B_INSTANCES:
        result = build_instance(
            source_path=config.source_path,
            source_format=config.source_format,
            source_id=config.source_id,
            instance_id=config.instance_id,
            seed_hex=config.seed_hex,
            start_chapter=config.interior_chapter_index,
            target_tokens=TARGET_TOKEN_COUNT,
            entity_review=json.loads(config.entity_review_path.read_text(encoding="utf-8")),
        )
        manifests.append(_write_instance(config, result))
    result = {
        "schemaVersion": 1,
        "profileId": GATE_B_PROFILE,
        "instanceCount": len(manifests),
        "instances": manifests,
    }
    write_canonical(GATE_B_ROOT / "instances" / "manifest.json", result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if not args.all:
        parser.error("--all is required")
    print(canonical_json_bytes(produce_all()).decode())


if __name__ == "__main__":
    main()
