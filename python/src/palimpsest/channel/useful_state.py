from __future__ import annotations

import hashlib
import json
import zlib


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def _mapping(index: int) -> dict[str, str]:
    return {
        "cipherToken": f"w{index:04x}",
        "confidence": f"0.{500 + index % 500:03d}",
        "plainToken": f"token-{index:04d}",
        "provenance": f"frequency-cluster-{index % 32:02d};context-window-{index % 64:02d}",
    }


def _note(kind: str, index: int) -> dict[str, str]:
    return {
        "id": f"{kind}-{index:03d}",
        "provenance": f"checkpoint-observation-{index % 32:02d}",
        "text": f"{kind} evidence {index:03d} at opaque token window {index * 37:05d}",
    }


def build_useful_state_checkpoints() -> tuple[dict[str, object], ...]:
    checkpoints: list[dict[str, object]] = []
    previous_digest: str | None = None
    for version in range(1, 5):
        checkpoint: dict[str, object] = {
            "checkpointId": f"belief-v{version}",
            "contractId": "useful-state-checkpoint",
            "contradictions": [_note("contradiction", index) for index in range(version * 16)],
            "mappingHypotheses": [_mapping(index) for index in range(version * 128)],
            "previousCheckpointSha256": previous_digest,
            "reconstructionDiffs": [
                _note("reconstruction-diff", index) for index in range(version * 4)
            ],
            "schemaVersion": 1,
            "switchHypotheses": [_note("switch-hypothesis", index) for index in range(version * 2)],
            "version": version,
        }
        previous_digest = hashlib.sha256(canonical_bytes(checkpoint)).hexdigest()
        checkpoints.append(checkpoint)
    return tuple(checkpoints)


def encode_useful_state(checkpoint: dict[str, object], strategy: str) -> bytes:
    payload = canonical_bytes(checkpoint)
    if strategy == "canonical-json":
        return payload
    if strategy == "deflate-9":
        return zlib.compress(payload, level=9)
    if strategy == "field-table-deflate-9":
        mappings = checkpoint["mappingHypotheses"]
        contradictions = checkpoint["contradictions"]
        switches = checkpoint["switchHypotheses"]
        diffs = checkpoint["reconstructionDiffs"]
        if not all(
            isinstance(value, list) for value in (mappings, contradictions, switches, diffs)
        ):
            raise ValueError("Useful-state arrays are malformed.")
        table = [
            checkpoint["version"],
            checkpoint["previousCheckpointSha256"],
            [
                [
                    mapping["cipherToken"],
                    mapping["plainToken"],
                    mapping["confidence"],
                    mapping["provenance"],
                ]
                for mapping in mappings
            ],
            [
                [note["id"], note["text"], note["provenance"]]
                for notes in (contradictions, switches, diffs)
                for note in notes
            ],
            [len(contradictions), len(switches), len(diffs)],
        ]
        return zlib.compress(canonical_bytes(table), level=9)
    raise ValueError(f"Unsupported useful-state strategy: {strategy}.")


def decode_useful_state(payload: bytes, strategy: str) -> dict[str, object]:
    if strategy == "canonical-json":
        return json.loads(payload)
    if strategy == "deflate-9":
        return json.loads(zlib.decompress(payload))
    if strategy == "field-table-deflate-9":
        version, previous_digest, mappings, notes, counts = json.loads(zlib.decompress(payload))
        contradiction_count, switch_count, diff_count = counts
        note_objects = [{"id": note[0], "text": note[1], "provenance": note[2]} for note in notes]
        return {
            "checkpointId": f"belief-v{version}",
            "contractId": "useful-state-checkpoint",
            "contradictions": note_objects[:contradiction_count],
            "mappingHypotheses": [
                {
                    "cipherToken": mapping[0],
                    "plainToken": mapping[1],
                    "confidence": mapping[2],
                    "provenance": mapping[3],
                }
                for mapping in mappings
            ],
            "previousCheckpointSha256": previous_digest,
            "reconstructionDiffs": note_objects[
                contradiction_count + switch_count : contradiction_count + switch_count + diff_count
            ],
            "schemaVersion": 1,
            "switchHypotheses": note_objects[
                contradiction_count : contradiction_count + switch_count
            ],
            "version": version,
        }
    raise ValueError(f"Unsupported useful-state strategy: {strategy}.")
