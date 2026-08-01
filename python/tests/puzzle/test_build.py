from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path

import pytest
from palimpsest.puzzle import build as build_module
from palimpsest.puzzle.definition import load_fixture_catalog
from palimpsest.puzzle.package import FixturePackage

ROOT = Path(__file__).resolve().parents[3]
EXPECTED_ARTIFACT_DIGESTS = {
    "calibration-theron-ware": "350c3c2f63eefb23206babd11578a318a9fe15ac241928734134c5893876258d",
    "validation-custom-country": "9ad2e36c4087feb2aee03b6962c9aec468dbef1d3d002c2015474847f6066e97",
    "validation-odd-women": "9c97c2f38c4a93929f9eba95a3915b734897c35021d61fff7754eb1980cb49dd",
    "validation-pointed-firs": "6205b280c5e7e9b1e8d8299f658cb4061d26217ddf8afee8d18d2e039de711d9",
    "validation-woodlanders": "d1e167ed82dd4fbcfeaab8a117244406e606139c3b638d4f265a7fa89bf2b64f",
}


def _artifact_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(
        item for item in root.rglob("*") if item.is_file() and item.name != "fixture.json"
    ):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


@pytest.fixture(scope="module")
def built_fixtures(
    tmp_path_factory: pytest.TempPathFactory,
) -> Mapping[str, tuple[FixturePackage, Path]]:
    output = tmp_path_factory.mktemp("fixture-packages")
    result: dict[str, tuple[FixturePackage, Path]] = {}
    for definition in load_fixture_catalog(ROOT / "experiments/fixtures.json").fixtures:
        destination = output / definition.fixture_id
        package = build_module.build_fixture(ROOT, destination, definition.fixture_id)
        result[definition.fixture_id] = package, destination
    return result


def test_existing_fixtures_retain_stable_scientific_artifacts(
    built_fixtures: Mapping[str, tuple[FixturePackage, Path]],
) -> None:
    assert set(built_fixtures) == set(EXPECTED_ARTIFACT_DIGESTS)
    for fixture_id, (package, root) in built_fixtures.items():
        assert _artifact_digest(root) == EXPECTED_ARTIFACT_DIGESTS[fixture_id]
        decoded = FixturePackage.from_dict(
            json.loads((root / "fixture.json").read_text(encoding="utf-8")), root
        )
        assert decoded == package
        assert decoded.fixture_id == fixture_id
        assert decoded.content_digest == decoded.computed_content_digest(root)
        assert decoded.agent_ids == ("agent-1", "agent-2", "agent-3")
        assert decoded.stage_count == 6
        reference_sources = {
            reference.source_id: reference.sha256 for reference in decoded.references
        }
        for variant in decoded.variants.values():
            ciphertext = (root / variant.public_ciphertext_path).read_bytes()
            assert hashlib.sha256(ciphertext).hexdigest() == variant.public_ciphertext_sha256
            assert {
                reference.source_id: reference.source_sha256
                for reference in variant.reference_files
            } == reference_sources
            for reference in variant.reference_files:
                content = (root / reference.path).read_bytes()
                assert len(content) == reference.byte_length
                assert hashlib.sha256(content).hexdigest() == reference.sha256

    calibration, _ = built_fixtures["calibration-theron-ware"]
    assert calibration.content_digest == (
        "331e0a673980d8a14184528891df46c161bb4837d77b8f04f7701c4d691f4d93"
    )
    assert {name: variant.build_id for name, variant in calibration.variants.items()} == {
        "stationary": "build-655d86ff2ea73553dafdca95f96f41aa5057c3343cf791d6bb37599e4d62a457",
        "rekey": "build-ebcfd2582438abb25713581cf2cd083a0aab44ceddc4f8a60af19f9d6f25af5a",
    }


def test_declared_variants_share_plaintext_and_diverge_only_at_rekey(
    built_fixtures: Mapping[str, tuple[FixturePackage, Path]],
) -> None:
    package, root = built_fixtures["calibration-theron-ware"]
    stationary = package.variants["stationary"]
    rekey = package.variants["rekey"]

    assert stationary.rekey_from_stage is None
    assert rekey.rekey_from_stage == 4
    for baseline, changed in zip(stationary.stages, rekey.stages, strict=True):
        assert (baseline.agent_id, baseline.ordinal) == (changed.agent_id, changed.ordinal)
        if baseline.ordinal < 4:
            assert baseline.sha256 == changed.sha256
            assert (root / baseline.source_path).read_bytes() == (
                root / changed.source_path
            ).read_bytes()

    manipulation = json.loads((root / package.manipulation_check.path).read_text(encoding="utf-8"))
    assert manipulation["preBoundaryIdentical"] is True
    assert manipulation["stationaryOldKeyLoss"] == 0
    assert manipulation["rekeyOldKeyLoss"] >= 0.15
    assert set(manipulation["changedTokenMassByAgent"]) == set(package.agent_ids)


def test_agent_visible_variant_trees_exclude_oracle_data(
    built_fixtures: Mapping[str, tuple[FixturePackage, Path]],
) -> None:
    forbidden = (
        b'"anchors"',
        b'"sentinels"',
        b'"specialists"',
        b'"controls"',
        b'"preBoundaryIdentical"',
        b'"rekeyOldKeyLoss"',
        b"oracle/",
    )
    for _, root in built_fixtures.values():
        visible = [path for path in (root / "variants").rglob("*") if path.is_file()]
        assert visible
        assert all(path.suffix != ".json" for path in visible)
        assert all(not any(marker in path.read_bytes() for marker in forbidden) for path in visible)


def test_build_refuses_to_overwrite_nonempty_output(tmp_path: Path) -> None:
    output = tmp_path / "occupied"
    output.mkdir()
    sentinel = output / "keep.txt"
    sentinel.write_text("user data\n", encoding="utf-8")

    with pytest.raises(FileExistsError, match="non-empty"):
        build_module.build_fixture(ROOT, output, "calibration-theron-ware")

    assert sentinel.read_text(encoding="utf-8") == "user data\n"
