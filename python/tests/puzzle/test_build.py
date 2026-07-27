from __future__ import annotations

import json
from collections import Counter
from itertools import pairwise
from pathlib import Path

import pytest
from palimpsest.generation.cipher import apply_mapping
from palimpsest.generation.text import word_tokens
from palimpsest.puzzle.build import build_puzzle
from palimpsest.puzzle.model import AGENT_IDS, STAGE_COUNT, PuzzleBuild

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def built_puzzle(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, PuzzleBuild]:
    output = tmp_path_factory.mktemp("puzzle-build") / "build"
    return output, build_puzzle(ROOT, output, seed=17, stage_interval_ms=25)


def test_build_is_byte_deterministic_with_three_six_stage_private_streams(
    tmp_path: Path,
    built_puzzle: tuple[Path, PuzzleBuild],
) -> None:
    first_root, first = built_puzzle
    second_root = tmp_path / "second"
    second = build_puzzle(ROOT, second_root, seed=17, stage_interval_ms=25)

    assert first.to_dict() == second.to_dict()
    first_files = {
        path.relative_to(first_root): path.read_bytes()
        for path in first_root.rglob("*")
        if path.is_file()
    }
    second_files = {
        path.relative_to(second_root): path.read_bytes()
        for path in second_root.rglob("*")
        if path.is_file()
    }
    assert first_files == second_files
    assert first.transition_stage == 4
    assert len(first.changed_symbols) > 1
    source_paths = [stage.source_path for stage in first.stages]
    for agent_id in AGENT_IDS:
        stages = [stage for stage in first.stages if stage.agent_id == agent_id]
        assert [stage.ordinal for stage in stages] == list(range(1, STAGE_COUNT + 1))
        assert all(stage.token_count > 0 for stage in stages)
        for left, right in pairwise(stages):
            assert left.source_path != right.source_path
            assert (first_root / left.source_path).read_bytes() != (
                first_root / right.source_path
            ).read_bytes()
    assert source_paths == sorted(source_paths)


def test_every_stream_has_learnable_pre_rules_and_consequential_post_contradictions(
    built_puzzle: tuple[Path, PuzzleBuild],
) -> None:
    build_root, build = built_puzzle
    base_key = json.loads((build_root / "oracle/base-key.json").read_text(encoding="utf-8"))
    revised_key = json.loads((build_root / "oracle/revised-key.json").read_text(encoding="utf-8"))
    changed = set(build.changed_symbols)

    assert set(base_key) == set(base_key.values()) == set(revised_key) == set(revised_key.values())
    assert all(base_key[word] != revised_key[word] for word in changed)
    assert all(base_key[word] == revised_key[word] for word in set(base_key) - changed)

    for agent_id in AGENT_IDS:
        pre = []
        post = []
        for ordinal in range(1, STAGE_COUNT + 1):
            truth = (build_root / f"oracle/checker/{agent_id}/stage-{ordinal:02d}.txt").read_text(
                encoding="utf-8"
            )
            target = pre if ordinal < build.transition_stage else post
            target.extend(token.normalized for token in word_tokens(truth))
        pre_counts = Counter(pre)
        post_counts = Counter(post)
        assert all(pre_counts[word] > 0 and post_counts[word] > 0 for word in changed)
        post_changed_mass = sum(post_counts[word] for word in changed) / len(post)
        assert post_changed_mass >= 0.15


def test_stage_four_uses_the_shared_revised_key_without_rewriting_prior_bytes(
    built_puzzle: tuple[Path, PuzzleBuild],
) -> None:
    build_root, build = built_puzzle
    before = {
        stage.source_path: (build_root / stage.source_path).read_bytes()
        for stage in build.stages
        if stage.ordinal < build.transition_stage
    }
    rebuilt = build_puzzle(
        ROOT,
        build_root.parent / "rebuilt",
        seed=17,
        stage_interval_ms=25,
    )

    assert rebuilt.changed_symbols == build.changed_symbols
    assert before == {path: (build_root.parent / "rebuilt" / path).read_bytes() for path in before}

    base_key = json.loads((build_root / "oracle/base-key.json").read_text(encoding="utf-8"))
    revised_key = json.loads((build_root / "oracle/revised-key.json").read_text(encoding="utf-8"))
    for agent_id in AGENT_IDS:
        for ordinal, key in ((3, base_key), (4, revised_key)):
            truth = (build_root / f"oracle/checker/{agent_id}/stage-{ordinal:02d}.txt").read_text(
                encoding="utf-8"
            )
            cipher = (build_root / f"private/{agent_id}/stages/stage-{ordinal:02d}.txt").read_text(
                encoding="utf-8"
            )
            assert cipher.strip() == apply_mapping(truth.strip(), key)


def test_build_keeps_public_private_evaluation_and_oracle_content_separate(
    built_puzzle: tuple[Path, PuzzleBuild],
) -> None:
    build_root, build = built_puzzle
    public_files = [path for path in (build_root / "public").rglob("*") if path.is_file()]
    private_files = [path for path in (build_root / "private").rglob("*") if path.is_file()]
    oracle_files = [path for path in (build_root / "oracle").rglob("*") if path.is_file()]

    assert public_files
    assert len(private_files) == 3 * STAGE_COUNT
    assert (build_root / build.public_ciphertext_path).is_file()
    assert (build_root / "oracle/plaintext.txt").is_file()
    assert all("plaintext" not in path.name and "key" not in path.name for path in public_files)
    assert all("plaintext" not in path.name and "key" not in path.name for path in private_files)
    assert oracle_files


def test_build_refuses_an_existing_nonempty_destination(tmp_path: Path) -> None:
    output = tmp_path / "occupied"
    output.mkdir()
    (output / "keep.txt").write_text("user data\n", encoding="utf-8")

    with pytest.raises(FileExistsError, match="non-empty"):
        build_puzzle(ROOT, output)
    assert (output / "keep.txt").read_text(encoding="utf-8") == "user data\n"
