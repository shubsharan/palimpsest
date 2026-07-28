from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..serialization import canonical_json_bytes, sha256_hex
from .cipher import apply_mapping, stationary_key
from .corpus import (
    SourceDefinition,
    build_reference_corpus,
    load_source_registry,
    select_chapters,
)
from .manifest import (
    EvidenceStage,
    PuzzleBuild,
    ReferenceSource,
    RekeyTransition,
    TargetSource,
    make_agent_ids,
)
from .revision import build_successive_revision
from .shards import assign_streams, contradiction_metrics, eligible_symbols, split_text
from .text import canonicalize_capitalization, word_tokens

MINIMUM_STREAM_OCCURRENCES = 2
FREQUENCY_STRATA = 4
MAXIMUM_ELIGIBLE_CHANGED_MASS = 0.45


@dataclass(frozen=True)
class _RekeyDefinition:
    at_stage: int
    changed_token_mass: float


@dataclass(frozen=True)
class _PuzzleDefinition:
    target_id: str
    chapter_start: int
    chapter_end: int
    reference_ids: tuple[str, ...]
    seed: int
    agent_count: int
    stage_count: int
    stage_interval_ms: int
    rekeys: tuple[_RekeyDefinition, ...]


def _seed_hex(seed: int, domain: str) -> str:
    return hashlib.sha256(f"palimpsest-puzzle:{seed}:{domain}".encode("ascii")).hexdigest()


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
        suffix = "" if minimum is None else f" of at least {minimum}"
        raise ValueError(f"{name} must be an integer{suffix}.")
    return value


def _identifier(value: object, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty identifier.")
    return value


def _decode_definition(value: object) -> _PuzzleDefinition:
    puzzle = _record(
        value,
        "Puzzle definition",
        frozenset(
            {
                "target",
                "references",
                "seed",
                "agentCount",
                "stageCount",
                "stageIntervalMs",
                "rekeys",
            }
        ),
    )
    target = _record(
        puzzle["target"],
        "Puzzle target",
        frozenset({"corpus", "chapters"}),
    )
    chapters = _record(
        target["chapters"],
        "Puzzle target chapters",
        frozenset({"start", "end"}),
    )
    references_value = puzzle["references"]
    rekeys_value = puzzle["rekeys"]
    if not isinstance(references_value, list):
        raise ValueError("Puzzle references must be an array.")
    if not isinstance(rekeys_value, list):
        raise ValueError("Puzzle rekeys must be an array.")
    references = tuple(
        _identifier(reference, f"Puzzle references[{index}]")
        for index, reference in enumerate(references_value)
    )
    if len(set(references)) != len(references):
        raise ValueError("Puzzle references must be unique.")
    target_id = _identifier(target["corpus"], "Puzzle target corpus")
    if target_id in references:
        raise ValueError("Puzzle target corpus must be excluded from references.")

    stage_count = _integer(puzzle["stageCount"], "Puzzle stageCount", 1)
    rekeys: list[_RekeyDefinition] = []
    for index, raw in enumerate(rekeys_value):
        rekey = _record(
            raw,
            f"Puzzle rekeys[{index}]",
            frozenset({"atStage", "changedTokenMass"}),
        )
        at_stage = _integer(rekey["atStage"], f"Puzzle rekeys[{index}] atStage", 2)
        mass = rekey["changedTokenMass"]
        if (
            isinstance(mass, bool)
            or not isinstance(mass, (int, float))
            or not math.isfinite(float(mass))
            or not 0.0 < float(mass) < 1.0
        ):
            raise ValueError(
                f"Puzzle rekeys[{index}] changedTokenMass must be strictly between zero and one."
            )
        rekeys.append(_RekeyDefinition(at_stage=at_stage, changed_token_mass=float(mass)))
    stages = tuple(rekey.at_stage for rekey in rekeys)
    if stages != tuple(sorted(set(stages))) or any(stage > stage_count for stage in stages):
        raise ValueError(
            "Puzzle re-key stages must be strictly ascending unique values within 2..stageCount."
        )
    chapter_start = _integer(chapters["start"], "Puzzle target chapter start", 1)
    chapter_end = _integer(chapters["end"], "Puzzle target chapter end", 1)
    if chapter_end < chapter_start:
        raise ValueError("Puzzle target chapter range must be one-based and ordered.")
    agent_count = _integer(puzzle["agentCount"], "Puzzle agentCount", 2)
    make_agent_ids(agent_count)
    return _PuzzleDefinition(
        target_id=target_id,
        chapter_start=chapter_start,
        chapter_end=chapter_end,
        reference_ids=references,
        seed=_integer(puzzle["seed"], "Puzzle seed"),
        agent_count=agent_count,
        stage_count=stage_count,
        stage_interval_ms=_integer(puzzle["stageIntervalMs"], "Puzzle stageIntervalMs", 1),
        rekeys=tuple(rekeys),
    )


def _prepared_text(source: SourceDefinition, start: int, end: int) -> str:
    selected = select_chapters(source, start, end)
    return canonicalize_capitalization(
        "\n\n".join(f"{chapter.heading}\n\n{chapter.text}" for chapter in selected)
    )


def _words(value: str) -> list[str]:
    return [token.normalized for token in word_tokens(value) if token.normalized is not None]


def _write(path: Path, content: bytes) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {"byteLength": len(content), "sha256": sha256_hex(content)}


def _region_words(
    streams: dict[str, tuple[str, ...]],
    *,
    start: int,
    end: int,
    eligible: set[str],
) -> list[str]:
    return [
        word
        for stages in streams.values()
        for stage in stages[start - 1 : end]
        for word in _words(stage)
        if word in eligible
    ]


def _build_into(
    root: Path,
    destination: Path,
    definition: _PuzzleDefinition,
    registry: dict[str, SourceDefinition],
) -> PuzzleBuild:
    try:
        target_source = registry[definition.target_id]
        reference_sources = tuple(registry[source_id] for source_id in definition.reference_ids)
    except KeyError as error:
        raise ValueError(f"Unknown registered corpus: {error.args[0]}") from error

    prepared = _prepared_text(
        target_source,
        definition.chapter_start,
        definition.chapter_end,
    )
    agent_ids = make_agent_ids(definition.agent_count)
    segment_count = definition.agent_count * definition.stage_count
    plain_segments = split_text(prepared, segment_count)
    streams = assign_streams(plain_segments, agent_ids, definition.stage_count)
    vocabulary = sorted(set(_words(prepared)))
    keys = [stationary_key(vocabulary, _seed_hex(definition.seed, "base-key"))]

    boundaries = (1, *(rekey.at_stage for rekey in definition.rekeys), definition.stage_count + 1)
    transitions: list[RekeyTransition] = []
    evidence: list[dict[str, Any]] = []
    for index, rekey in enumerate(definition.rekeys):
        pre_start = boundaries[index]
        pre_end = boundaries[index + 1] - 1
        post_start = boundaries[index + 1]
        post_end = boundaries[index + 2] - 1
        eligible = eligible_symbols(
            streams,
            pre_start=pre_start,
            pre_end=pre_end,
            post_start=post_start,
            post_end=post_end,
            minimum_occurrences=MINIMUM_STREAM_OCCURRENCES,
        )
        if len(eligible) < FREQUENCY_STRATA * 2:
            raise ValueError(
                f"Re-key at stage {rekey.at_stage} has too few recurring symbols "
                "across every adjacent agent region."
            )
        pre_tokens = _region_words(
            streams,
            start=pre_start,
            end=pre_end,
            eligible=eligible,
        )
        post_tokens = _region_words(
            streams,
            start=post_start,
            end=post_end,
            eligible=eligible,
        )
        total_post_tokens = sum(
            len(_words(stage))
            for stages in streams.values()
            for stage in stages[post_start - 1 : post_end]
        )
        eligible_post_fraction = len(post_tokens) / total_post_tokens
        eligible_mass_target = rekey.changed_token_mass / eligible_post_fraction
        if eligible_mass_target >= MAXIMUM_ELIGIBLE_CHANGED_MASS:
            raise ValueError(
                f"Re-key at stage {rekey.at_stage} cannot attain changedTokenMass "
                "while retaining matched stable controls."
            )
        domain = (
            "partial-rekey"
            if len(definition.rekeys) == 1
            else f"partial-rekey:{index + 1}:{rekey.at_stage}"
        )
        try:
            revision = build_successive_revision(
                prior_key=keys[-1],
                pre_tokens=pre_tokens,
                post_tokens=post_tokens,
                seed_hex=_seed_hex(definition.seed, domain),
                minimum_occurrences=1,
                stratum_count=FREQUENCY_STRATA,
                token_mass_target=eligible_mass_target,
            )
            changed_symbols = tuple(sorted(entry.plain_type for entry in revision.changed_entries))
            metrics = contradiction_metrics(
                streams,
                pre_start=pre_start,
                pre_end=pre_end,
                post_start=post_start,
                post_end=post_end,
                changed_symbols=set(changed_symbols),
            )
        except (ValueError, RuntimeError) as error:
            raise ValueError(f"Re-key at stage {rekey.at_stage} is infeasible: {error}") from error
        keys.append(revision.revised_key)
        key_version = index + 1
        key_path = Path(f"oracle/keys/key-{key_version:02d}.json")
        transitions.append(
            RekeyTransition(
                at_stage=rekey.at_stage,
                key_version=key_version,
                changed_token_mass=rekey.changed_token_mass,
                changed_symbols=changed_symbols,
                key_path=key_path,
            )
        )
        evidence.append(
            {
                "atStage": rekey.at_stage,
                "keyVersion": key_version,
                "preStages": {"start": pre_start, "end": pre_end},
                "postStages": {"start": post_start, "end": post_end},
                "agents": metrics,
            }
        )

    key_paths = tuple(Path(f"oracle/keys/key-{index:02d}.json") for index in range(len(keys)))
    for path, key in zip(key_paths, keys, strict=True):
        _write(destination / path, canonical_json_bytes(key))

    cipher_by_agent: dict[str, tuple[str, ...]] = {}
    stages: list[EvidenceStage] = []
    ordinal_width = max(2, len(str(definition.stage_count)))
    for agent_id, plain_stages in streams.items():
        cipher_stages: list[str] = []
        for ordinal, plain_stage in enumerate(plain_stages, start=1):
            key_version = sum(rekey.at_stage <= ordinal for rekey in definition.rekeys)
            cipher_stage = apply_mapping(plain_stage, keys[key_version])
            cipher_stages.append(cipher_stage)
            cipher_bytes = (cipher_stage + "\n").encode("utf-8")
            label = f"{ordinal:0{ordinal_width}d}"
            source_path = Path(f"private/{agent_id}/stages/stage-{label}.txt")
            _write(destination / source_path, cipher_bytes)
            _write(
                destination / f"oracle/checker/{agent_id}/stage-{label}.txt",
                (plain_stage + "\n").encode("utf-8"),
            )
            stages.append(
                EvidenceStage(
                    agent_id=agent_id,
                    ordinal=ordinal,
                    key_version=key_version,
                    release_offset_ms=(ordinal - 1) * definition.stage_interval_ms,
                    source_path=source_path,
                    token_count=len(_words(plain_stage)),
                    sha256=sha256_hex(cipher_bytes),
                )
            )
        cipher_by_agent[agent_id] = tuple(cipher_stages)

    ordered_plain = [stage for agent_id in agent_ids for stage in streams[agent_id]]
    ordered_cipher = [stage for agent_id in agent_ids for stage in cipher_by_agent[agent_id]]
    full_plaintext = "\n\n".join(ordered_plain) + "\n"
    full_ciphertext = "\n\n".join(ordered_cipher) + "\n"
    _write(destination / "evaluation/ciphertext.txt", full_ciphertext.encode("utf-8"))
    _write(destination / "oracle/plaintext.txt", full_plaintext.encode("utf-8"))
    _write(destination / "oracle/rekey-evidence.json", canonical_json_bytes(evidence))

    reference_artifacts = []
    for document in build_reference_corpus(reference_sources):
        relative = Path("public/reference") / f"{document.document_id}.txt"
        content = document.content.encode("utf-8")
        reference_artifacts.append(
            {
                "sourceId": document.source_id,
                "sourceSha256": document.sha256,
                "path": relative.as_posix(),
                **_write(destination / relative, content),
            }
        )
    if definition.agent_count == 3:
        readme = (
            "Palimpsest provides three agents with different private staged evidence and "
            "a shared target-excluded reference corpus.\n"
        )
    else:
        readme = (
            f"Palimpsest provides {definition.agent_count} agents with different private "
            "staged evidence and a shared target-excluded reference corpus.\n"
        )
    _write(destination / "public/README.md", readme.encode("utf-8"))
    _write(
        destination / "public/reference-manifest.json",
        canonical_json_bytes({"schemaVersion": 1, "artifacts": reference_artifacts}),
    )
    oracle = {
        "schemaVersion": 2,
        "keyPaths": [path.as_posix() for path in key_paths],
        "plaintextPath": "oracle/plaintext.txt",
        "checkerRoot": "oracle/checker",
        "rekeyEvidencePath": "oracle/rekey-evidence.json",
    }
    _write(destination / "oracle/manifest.json", canonical_json_bytes(oracle))

    source_record = TargetSource(
        source_id=target_source.source_id,
        sha256=target_source.sha256,
        chapter_start=definition.chapter_start,
        chapter_end=definition.chapter_end,
    )
    reference_records = tuple(
        ReferenceSource(
            source_id=source.source_id,
            sha256=source.sha256,
            path=Path("public/reference") / f"{source.source_id}-reference.txt",
        )
        for source in reference_sources
    )
    private_roots = {agent_id: Path(f"private/{agent_id}/stages") for agent_id in agent_ids}
    build_basis = {
        "schemaVersion": 2,
        "seed": definition.seed,
        "source": source_record.to_dict(),
        "references": [reference.to_dict() for reference in reference_records],
        "agentIds": list(agent_ids),
        "stageCount": definition.stage_count,
        "stageIntervalMs": definition.stage_interval_ms,
        "rekeys": [transition.to_dict() for transition in transitions],
        "publicCiphertextSha256": sha256_hex(full_ciphertext.encode("utf-8")),
        "plaintextSha256": sha256_hex(full_plaintext.encode("utf-8")),
        "referenceArtifacts": reference_artifacts,
        "stages": [stage.to_dict() for stage in stages],
    }
    build = PuzzleBuild(
        build_id="build-" + sha256_hex(canonical_json_bytes(build_basis)),
        seed=definition.seed,
        source=source_record,
        references=reference_records,
        agent_ids=agent_ids,
        stage_count=definition.stage_count,
        stage_interval_ms=definition.stage_interval_ms,
        rekeys=tuple(transitions),
        public_ciphertext_path=Path("evaluation/ciphertext.txt"),
        reference_corpus_path=Path("public/reference"),
        private_stage_roots=private_roots,
        oracle_root=Path("oracle"),
        base_key_path=key_paths[0],
        stages=tuple(stages),
    )
    _write(destination / "puzzle-build.json", canonical_json_bytes(build.to_dict()))
    return build


def build_puzzle(root: Path, output: Path, puzzle: object) -> PuzzleBuild:
    root = root.resolve()
    output = output.resolve()
    definition = _decode_definition(puzzle)
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"Puzzle build output is non-empty: {output}")
    registry = load_source_registry(root)
    selected_ids = (definition.target_id, *definition.reference_ids)
    unknown = tuple(source_id for source_id in selected_ids if source_id not in registry)
    if unknown:
        raise ValueError(f"Unknown registered corpus: {unknown[0]}")

    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        result = _build_into(root, staging, definition, registry)
        if output.exists():
            output.rmdir()
        os.replace(staging, output)
        return result
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    puzzle = json.load(sys.stdin)
    build = build_puzzle(args.root, args.output, puzzle)
    print(
        canonical_json_bytes(
            {
                "buildId": build.build_id,
                "buildPath": str(args.output.resolve()),
                "agentIds": list(build.agent_ids),
                "stageCount": build.stage_count,
            }
        ).decode()
    )


if __name__ == "__main__":
    main()
