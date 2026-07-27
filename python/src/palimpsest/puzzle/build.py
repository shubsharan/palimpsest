from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

from .cipher import apply_mapping, stationary_key
from .corpus import SourceDefinition, build_reference_corpus, load_chapters
from .model import AGENT_IDS, STAGE_COUNT, EvidenceStage, PuzzleBuild
from .revision import build_revision
from .serialization import canonical_json_bytes, sha256_hex
from .text import canonicalize_capitalization, render, tokenize, word_tokens

SOURCE_PATH = Path("fixtures/corpus/middlemarch.txt")
SOURCE_ID = "middlemarch"
SOURCE_FORMAT = "gutenberg-text"
START_CHAPTER = 10
END_CHAPTER = 15
MINIMUM_STREAM_OCCURRENCES = 2
FREQUENCY_STRATA = 4
DEFAULT_CHANGED_TOKEN_MASS = 0.20


def _seed_hex(seed: int, domain: str) -> str:
    if isinstance(seed, bool):
        raise ValueError("Puzzle seed must be an integer.")
    return hashlib.sha256(f"palimpsest-puzzle:{seed}:{domain}".encode("ascii")).hexdigest()


def _prepared_text(root: Path) -> str:
    chapters = load_chapters(SourceDefinition(root / SOURCE_PATH, SOURCE_FORMAT, SOURCE_ID))
    selected = chapters[START_CHAPTER : END_CHAPTER + 1]
    if [chapter.index for chapter in selected] != list(range(START_CHAPTER, END_CHAPTER + 1)):
        raise RuntimeError("Puzzle source no longer has the expected contiguous chapter geometry.")
    return canonicalize_capitalization(
        "\n\n".join(f"{chapter.heading}\n\n{chapter.text}" for chapter in selected)
    )


def _split_text(value: str, part_count: int) -> tuple[str, ...]:
    total_words = len(word_tokens(value))
    if total_words < part_count:
        raise ValueError("Puzzle text is too short for the requested stage geometry.")
    width, remainder = divmod(total_words, part_count)
    counts = [width + (index < remainder) for index in range(part_count)]
    boundaries: list[int] = []
    cumulative = 0
    for count in counts:
        cumulative += count
        boundaries.append(cumulative)

    spans = tokenize(value)
    outputs: list[str] = []
    start = 0
    words_seen = 0
    boundary_index = 0
    for index, span in enumerate(spans):
        if span.is_word:
            words_seen += 1
        if boundary_index < len(boundaries) and words_seen == boundaries[boundary_index]:
            end = index + 1
            while end < len(spans) and not spans[end].is_word:
                end += 1
            outputs.append(render(spans[start:end]).strip())
            start = end
            boundary_index += 1
    if len(outputs) != part_count or start != len(spans):
        raise RuntimeError("Puzzle text could not be split on deterministic word boundaries.")
    return tuple(outputs)


def _words(value: str) -> list[str]:
    return [token.normalized for token in word_tokens(value) if token.normalized is not None]


def _stream_segments(segments: tuple[str, ...]) -> dict[str, tuple[str, ...]]:
    return {
        agent_id: segments[agent_index * STAGE_COUNT : (agent_index + 1) * STAGE_COUNT]
        for agent_index, agent_id in enumerate(AGENT_IDS)
    }


def _eligible_symbols(streams: dict[str, tuple[str, ...]], transition_stage: int) -> set[str]:
    eligible: set[str] | None = None
    for stages in streams.values():
        pre = Counter(word for stage in stages[: transition_stage - 1] for word in _words(stage))
        post = Counter(word for stage in stages[transition_stage - 1 :] for word in _words(stage))
        stream_eligible = {
            word
            for word in pre.keys() & post.keys()
            if pre[word] >= MINIMUM_STREAM_OCCURRENCES and post[word] >= MINIMUM_STREAM_OCCURRENCES
        }
        eligible = stream_eligible if eligible is None else eligible & stream_eligible
    return eligible or set()


def _write(path: Path, content: bytes) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {"byteLength": len(content), "sha256": sha256_hex(content)}


def _validate_contradiction(
    streams: dict[str, tuple[str, ...]], transition_stage: int, changed: set[str]
) -> dict[str, dict[str, int | float]]:
    result: dict[str, dict[str, int | float]] = {}
    for agent_id, stages in streams.items():
        pre = Counter(word for stage in stages[: transition_stage - 1] for word in _words(stage))
        post_words = [word for stage in stages[transition_stage - 1 :] for word in _words(stage)]
        post = Counter(post_words)
        if any(pre[word] == 0 or post[word] == 0 for word in changed):
            raise RuntimeError(f"{agent_id} lacks changed-symbol evidence on both sides.")
        pre_changed = sum(pre[word] for word in changed)
        post_changed = sum(post[word] for word in changed)
        post_mass = post_changed / len(post_words)
        if post_mass < 0.15:
            raise RuntimeError(f"{agent_id} revised evidence is not consequential enough.")
        result[agent_id] = {
            "preChangedOccurrences": pre_changed,
            "postChangedOccurrences": post_changed,
            "postChangedTokenMass": post_mass,
        }
    return result


def _build_into(
    root: Path,
    destination: Path,
    *,
    seed: int,
    stage_interval_ms: int,
    transition_stage: int,
    changed_token_mass: float,
) -> PuzzleBuild:
    prepared = _prepared_text(root)
    segment_count = len(AGENT_IDS) * STAGE_COUNT
    plain_segments = _split_text(prepared, segment_count)
    streams = _stream_segments(plain_segments)
    vocabulary = sorted(set(_words(prepared)))
    base_key = stationary_key(vocabulary, _seed_hex(seed, "base-key"))
    eligible = _eligible_symbols(streams, transition_stage)
    if len(eligible) < FREQUENCY_STRATA * 2:
        raise RuntimeError("Too few symbols recur across every private stream and regime.")
    pre_tokens = [
        word
        for stages in streams.values()
        for stage in stages[: transition_stage - 1]
        for word in _words(stage)
        if word in eligible
    ]
    post_tokens = [
        word
        for stages in streams.values()
        for stage in stages[transition_stage - 1 :]
        for word in _words(stage)
        if word in eligible
    ]
    total_post_tokens = sum(
        len(_words(stage))
        for stages in streams.values()
        for stage in stages[transition_stage - 1 :]
    )
    eligible_post_fraction = len(post_tokens) / total_post_tokens
    eligible_mass_target = min(0.45, changed_token_mass / eligible_post_fraction)
    revision = build_revision(
        stationary_key=base_key,
        pre_tokens=pre_tokens,
        post_tokens=post_tokens,
        seed_hex=_seed_hex(seed, "partial-rekey"),
        minimum_occurrences=1,
        stratum_count=FREQUENCY_STRATA,
        token_mass_target=eligible_mass_target,
    )
    changed_symbols = tuple(sorted(entry.plain_type for entry in revision.changed_entries))
    contradiction = _validate_contradiction(streams, transition_stage, set(changed_symbols))

    cipher_by_agent: dict[str, tuple[str, ...]] = {}
    stages: list[EvidenceStage] = []
    for agent_id, plain_stages in streams.items():
        cipher_stages: list[str] = []
        for ordinal, plain_stage in enumerate(plain_stages, start=1):
            regime = "base" if ordinal < transition_stage else "revised"
            key = base_key if regime == "base" else revision.revised_key
            cipher_stage = apply_mapping(plain_stage, key)
            cipher_stages.append(cipher_stage)
            cipher_bytes = (cipher_stage + "\n").encode("utf-8")
            source_path = Path(f"private/{agent_id}/stages/stage-{ordinal:02d}.txt")
            _write(destination / source_path, cipher_bytes)
            _write(
                destination / f"oracle/checker/{agent_id}/stage-{ordinal:02d}.txt",
                (plain_stage + "\n").encode("utf-8"),
            )
            stages.append(
                EvidenceStage(
                    agent_id=agent_id,
                    ordinal=ordinal,
                    release_offset_ms=(ordinal - 1) * stage_interval_ms,
                    source_path=source_path,
                    token_count=len(_words(plain_stage)),
                    sha256=sha256_hex(cipher_bytes),
                    regime=regime,
                )
            )
        cipher_by_agent[agent_id] = tuple(cipher_stages)

    ordered_plain = [stage for agent_id in AGENT_IDS for stage in streams[agent_id]]
    ordered_cipher = [stage for agent_id in AGENT_IDS for stage in cipher_by_agent[agent_id]]
    full_plaintext = "\n\n".join(ordered_plain) + "\n"
    full_ciphertext = "\n\n".join(ordered_cipher) + "\n"
    _write(destination / "evaluation/ciphertext.txt", full_ciphertext.encode("utf-8"))
    _write(destination / "oracle/plaintext.txt", full_plaintext.encode("utf-8"))
    _write(destination / "oracle/base-key.json", canonical_json_bytes(base_key))
    _write(destination / "oracle/revised-key.json", canonical_json_bytes(revision.revised_key))
    _write(
        destination / "oracle/changed-symbols.json",
        canonical_json_bytes(list(changed_symbols)),
    )
    _write(
        destination / "oracle/evidence.json",
        canonical_json_bytes(contradiction),
    )

    reference_artifacts = []
    for document in build_reference_corpus(root):
        relative = Path("public/reference") / f"{document.document_id}.txt"
        content = document.content.encode("utf-8")
        reference_artifacts.append(
            {"path": relative.as_posix(), **_write(destination / relative, content)}
        )
    _write(
        destination / "public/README.md",
        (
            b"Palimpsest provides three agents with different private staged evidence and "
            b"a shared target-excluded reference corpus.\n"
        ),
    )
    _write(
        destination / "public/reference-manifest.json",
        canonical_json_bytes({"schemaVersion": 1, "artifacts": reference_artifacts}),
    )
    oracle = {
        "schemaVersion": 1,
        "baseKeyPath": "oracle/base-key.json",
        "revisedKeyPath": "oracle/revised-key.json",
        "plaintextPath": "oracle/plaintext.txt",
        "changedSymbolsPath": "oracle/changed-symbols.json",
        "checkerRoot": "oracle/checker",
        "streamEvidencePath": "oracle/evidence.json",
    }
    _write(destination / "oracle/manifest.json", canonical_json_bytes(oracle))

    build_basis = {
        "schemaVersion": 1,
        "seed": seed,
        "stageIntervalMs": stage_interval_ms,
        "transitionStage": transition_stage,
        "changedTokenMass": changed_token_mass,
        "sourceSha256": sha256_hex((root / SOURCE_PATH).read_bytes()),
        "publicCiphertextSha256": sha256_hex(full_ciphertext.encode("utf-8")),
        "plaintextSha256": sha256_hex(full_plaintext.encode("utf-8")),
        "changedSymbols": list(changed_symbols),
        "stages": [
            stage.to_dict(transition_stage=transition_stage)
            for stage in sorted(stages, key=lambda item: (item.agent_id, item.ordinal))
        ],
    }
    build_id = "build-" + sha256_hex(canonical_json_bytes(build_basis))
    build = PuzzleBuild(
        build_id=build_id,
        stage_interval_ms=stage_interval_ms,
        transition_stage=transition_stage,
        changed_symbols=changed_symbols,
        public_ciphertext_path=Path("evaluation/ciphertext.txt"),
        reference_corpus_path=Path("public/reference"),
        oracle_root=Path("oracle"),
        stages=tuple(stages),
    )
    _write(destination / "puzzle-build.json", canonical_json_bytes(build.to_dict()))
    return build


def build_puzzle(
    root: Path,
    output: Path,
    *,
    seed: int = 0,
    stage_interval_ms: int = 120_000,
    transition_stage: int = 4,
    changed_token_mass: float = DEFAULT_CHANGED_TOKEN_MASS,
) -> PuzzleBuild:
    root = root.resolve()
    output = output.resolve()
    if stage_interval_ms < 1:
        raise ValueError("Stage interval must be positive.")
    if not 2 <= transition_stage <= STAGE_COUNT:
        raise ValueError("Transition stage must leave both base and revised evidence.")
    if not 0.0 < changed_token_mass < 1.0:
        raise ValueError("Changed token mass must be between zero and one.")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"Puzzle build output is non-empty: {output}")

    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        result = _build_into(
            root,
            staging,
            seed=seed,
            stage_interval_ms=stage_interval_ms,
            transition_stage=transition_stage,
            changed_token_mass=changed_token_mass,
        )
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
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--stage-interval-ms", type=int, default=120_000)
    parser.add_argument("--transition-stage", type=int, default=4)
    parser.add_argument("--changed-token-mass", type=float, default=DEFAULT_CHANGED_TOKEN_MASS)
    args = parser.parse_args()
    build = build_puzzle(
        args.root,
        args.output,
        seed=args.seed,
        stage_interval_ms=args.stage_interval_ms,
        transition_stage=args.transition_stage,
        changed_token_mass=args.changed_token_mass,
    )
    print(
        canonical_json_bytes(
            {
                "buildId": build.build_id,
                "buildPath": str(args.output.resolve()),
                "agentCount": build.agent_count,
                "stageCount": build.stage_count,
                "transitionStage": build.transition_stage,
            }
        ).decode()
    )


if __name__ == "__main__":
    main()
