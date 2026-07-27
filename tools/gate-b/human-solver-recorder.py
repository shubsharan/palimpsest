#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

WORD_PATTERN = re.compile(r"[^\W\d_]+(?:['\u2019][^\W\d_]+)*", re.UNICODE)
CHECKPOINT_SECONDS = (600, 1_800, 3_600)


def _read_json(path: Path, expected_type: type) -> object:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, expected_type):
        raise ValueError(f"{path.name} must contain a JSON {expected_type.__name__}.")
    return value


def _write_json(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        encoding="utf-8",
    )


def _normalized_words(text: str) -> set[str]:
    return {match.group(0).casefold() for match in WORD_PATTERN.finditer(text)}


def _validated_mapping(path: Path, vocabulary: set[str]) -> dict[str, str]:
    value = _read_json(path, dict)
    mapping: dict[str, str] = {}
    for ciphertext, plaintext in value.items():
        if not isinstance(ciphertext, str) or not isinstance(plaintext, str):
            raise ValueError("Every mapping key and value must be a string.")
        cipher_word = ciphertext.casefold()
        plain_word = plaintext.casefold()
        if cipher_word not in vocabulary or plain_word not in vocabulary:
            raise ValueError("Every mapping word must occur in the visible cipher vocabulary.")
        if cipher_word == plain_word:
            raise ValueError("The no-fixed-points key cannot contain an identity mapping.")
        mapping[cipher_word] = plain_word
    if len(set(mapping.values())) != len(mapping):
        raise ValueError("The mapping must be one-to-one.")
    return dict(sorted(mapping.items()))


def _capitalized_like(surface: str, replacement: str) -> str:
    if surface.isupper():
        return replacement.upper()
    if surface[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def _reconstruct(cipher: str, mapping: dict[str, str]) -> str:
    return WORD_PATTERN.sub(
        lambda match: _capitalized_like(
            match.group(0),
            mapping.get(match.group(0).casefold(), match.group(0)),
        ),
        cipher,
    )


def _wait_for_checkpoint(started: float, target_seconds: int) -> float:
    while True:
        input(f"Checkpoint target {target_seconds}s. Press Enter when your edits are ready: ")
        elapsed = time.monotonic() - started
        if elapsed >= target_seconds:
            if target_seconds != CHECKPOINT_SECONDS[-1] and elapsed >= CHECKPOINT_SECONDS[-1]:
                raise TimeoutError("A required checkpoint was missed before the study deadline.")
            return min(elapsed, float(CHECKPOINT_SECONDS[-1]))
        print(f"Checkpoint is early; {target_seconds - elapsed:.0f}s remain.")


def run(study_root: Path, solver_identity: str) -> None:
    cipher_path = study_root / "cipher.txt"
    work_root = study_root / "work"
    output_root = study_root / "return-bundle"
    cipher = cipher_path.read_text(encoding="utf-8")
    vocabulary = _normalized_words(cipher)
    work_root.mkdir(exist_ok=True)
    output_root.mkdir(exist_ok=True)
    defaults = {
        "mapping-working.json": {},
        "claims-working.json": [],
        "tools-working.json": [],
    }
    for name, value in defaults.items():
        path = work_root / name
        if not path.exists():
            _write_json(path, value)
    (work_root / "reconstruction-working.txt").write_text(cipher, encoding="utf-8")
    print((study_root / "instructions.txt").read_text(encoding="utf-8"))
    print(
        "Edit the three *-working.json files in work/. The recorder writes a current "
        "reconstruction after each accepted checkpoint. Do not use network access."
    )
    started = time.monotonic()
    checkpoints = []
    for sequence, target_seconds in enumerate(CHECKPOINT_SECONDS):
        elapsed = _wait_for_checkpoint(started, target_seconds)
        mapping = _validated_mapping(work_root / "mapping-working.json", vocabulary)
        claims = _read_json(work_root / "claims-working.json", list)
        tools = _read_json(work_root / "tools-working.json", list)
        reconstruction = _reconstruct(cipher, mapping)
        reconstruction_name = f"reconstruction-{sequence}.txt"
        mapping_name = f"mapping-{sequence}.json"
        tools_name = f"tools-{sequence}.json"
        claims_name = f"claims-{sequence}.json"
        usage_name = f"usage-{sequence}.json"
        (output_root / reconstruction_name).write_text(reconstruction, encoding="utf-8")
        _write_json(output_root / mapping_name, mapping)
        _write_json(output_root / tools_name, tools)
        _write_json(output_root / claims_name, claims)
        _write_json(
            output_root / usage_name,
            {"activeSeconds": elapsed, "network": "disabled"},
        )
        (work_root / "reconstruction-working.txt").write_text(
            reconstruction,
            encoding="utf-8",
        )
        checkpoints.append(
            {
                "sequence": sequence,
                "trustedElapsedSeconds": elapsed,
                "reconstructionPath": reconstruction_name,
                "mappingPath": mapping_name,
                "toolEventsPath": tools_name,
                "identificationClaimsPath": claims_name,
                "usagePath": usage_name,
            }
        )
        print(f"Captured checkpoint {sequence + 1}; mapping size {len(mapping)}.")
    public_manifest = _read_json(study_root / "public-manifest.json", dict)
    _write_json(
        output_root / "manifest.json",
        {
            "schemaVersion": 1,
            "instanceId": public_manifest["instanceId"],
            "condition": "human-tools",
            "solverIdentity": solver_identity,
            "checkpoints": checkpoints,
        },
    )
    print(f"Complete. Return {output_root}.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--study-root",
        type=Path,
        default=Path(__file__).resolve().parent,
    )
    parser.add_argument("--solver-identity", required=True)
    args = parser.parse_args()
    run(args.study_root.resolve(), args.solver_identity)


if __name__ == "__main__":
    main()
