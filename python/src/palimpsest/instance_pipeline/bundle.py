from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex
from palimpsest.gate_c.config import SEED_HEX, SOURCE_PATH

from .artifacts import (
    artifact_reference,
    exact_output_entries,
    promote_fresh,
    write_bytes,
    write_canonical,
)
from .config import HARNESS_PRODUCER_VERSION
from .corpus import build_reference_corpus
from .instance import build_production_instance


def _write(root: Path, path: str, content: bytes) -> dict[str, Any]:
    return write_bytes(root / path, content)


def build_bundle(root: Path, destination: Path) -> dict[str, Any]:
    instance = build_production_instance(root)
    references = build_reference_corpus(root)
    staging_parent = destination.parent
    staging_parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".bundle-", dir=staging_parent))
    try:
        source_bytes = (root / SOURCE_PATH).read_bytes()
        request = {
            "schemaVersion": 1,
            "contractId": "instance-build-request",
            "requestId": "production-instance-001",
            "source": artifact_reference(source_bytes, "retained-source"),
            "seedCommitment": sha256_hex(bytes.fromhex(SEED_HEX)),
            "agentCount": 3,
        }
        write_canonical(staging / "build-request.json", request)

        public_refs = []
        scaffold = (
            b"# Palimpsest\n\n"
            b"Collaborate through Git. Each agent receives a private contiguous shard. "
            b"Record hypotheses and executable reconstruction work in your branch.\n"
        )
        _write(staging, "public/scaffold/README.md", scaffold)
        public_refs.append(artifact_reference(scaffold, "agent-scaffold"))
        public_manifest = {
            "schemaVersion": 1,
            "contractId": "public-instance-manifest",
            "instanceId": instance.instance_id,
            "profileId": instance.profile_id,
            "tokenCount": instance.source.private_manifest["tokenCount"],
            "publicArtifacts": public_refs,
        }
        write_canonical(staging / "public/manifest.json", public_manifest)

        reference_refs = []
        for document in references:
            content = document.content.encode()
            _write(staging, f"reference/{document.document_id}.txt", content)
            reference_refs.append(artifact_reference(content, "reference-document"))
        write_canonical(
            staging / "reference/manifest.json",
            {
                "schemaVersion": 1,
                "contractId": "agent-reference-corpus-manifest",
                "corpusId": "production-reference-v1",
                "artifacts": reference_refs,
            },
        )

        for shard in instance.shards:
            chapter_refs = []
            for chapter_index, cipher_chapter in zip(
                shard.chapter_indexes, shard.cipher_chapters, strict=True
            ):
                content = (cipher_chapter + "\n").encode()
                _write(
                    staging,
                    f"private/{shard.agent_id}/chapters/{chapter_index:03d}.txt",
                    content,
                )
                chapter_refs.append(artifact_reference(content, "cipher-chapter"))
            combined = "\n\n".join(shard.cipher_chapters).encode()
            write_canonical(
                staging / f"private/{shard.agent_id}/shard-manifest.json",
                {
                    "schemaVersion": 1,
                    "contractId": "shard-manifest",
                    "instanceId": instance.instance_id,
                    "agentId": shard.agent_id,
                    "chapterIndexes": list(shard.chapter_indexes),
                    "cipherText": artifact_reference(combined, "cipher-shard"),
                },
            )
            for ordinal, _chapter_ref in enumerate(chapter_refs, start=1):
                write_canonical(
                    staging / f"private/{shard.agent_id}/releases/{ordinal:02d}/manifest.json",
                    {
                        "schemaVersion": 1,
                        "releaseOrdinal": ordinal,
                        "chapterIndexes": list(shard.chapter_indexes[:ordinal]),
                        "chapters": chapter_refs[:ordinal],
                    },
                )

        prepared = instance.source.prepared_text.encode()
        stationary = canonical_json_bytes(instance.source.stationary_key)
        revised = canonical_json_bytes(instance.source.revised_key)
        changed = canonical_json_bytes(instance.source.changed_entries)
        controls = canonical_json_bytes(instance.source.matched_controls)
        sealed_artifacts = [
            ("sealed/prepared.txt", prepared, "prepared-plaintext"),
            ("sealed/stationary-key.json", stationary, "stationary-key"),
            ("sealed/revised-key.json", revised, "revised-key"),
            ("sealed/changed-entries.json", changed, "changed-entry-set"),
            ("sealed/matched-controls.json", controls, "matched-control-set"),
        ]
        oracle_refs = []
        for path, content, artifact_type in sealed_artifacts:
            _write(staging, path, content)
            oracle_refs.append(artifact_reference(content, artifact_type))
        write_canonical(
            staging / "sealed/oracle-manifest.json",
            {
                "schemaVersion": 1,
                "contractId": "oracle-manifest",
                "instanceId": instance.instance_id,
                "target": artifact_reference(prepared, "prepared-plaintext"),
                "privateArtifacts": oracle_refs,
            },
        )
        write_canonical(staging / "trusted/reveal-plan.json", instance.source.reveal_plan)
        write_canonical(staging / "trusted/difficulty.json", instance.difficulty)
        write_canonical(staging / "trusted/scoring.json", instance.scoring)

        outputs = exact_output_entries(staging)
        bundle = {
            "schemaVersion": 1,
            "bundleId": sha256_hex(canonical_json_bytes(outputs)),
            "producer": {
                "name": "palimpsest-instance-pipeline",
                "version": HARNESS_PRODUCER_VERSION,
            },
            "outputs": outputs,
        }
        write_canonical(staging / "bundle-manifest.json", bundle)
        promote_fresh(staging, destination)
        return bundle
    except BaseException:
        if staging.exists():
            shutil.rmtree(staging)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = build_bundle(args.root.resolve(), args.output)
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
