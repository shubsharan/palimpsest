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
pytestmark = pytest.mark.material
EXPECTED_ARTIFACT_DIGESTS = {
    "calibration-theron-ware": "0b95d4f127871262667a3c4c6c29071adce6d1d97077b0e246a9b23d78b61bf3",
    "validation-custom-country": "5993530a93aba3c3b4216ad9f01e880ebcac6f0a80344d0a52c7f72104764fea",
    "validation-odd-women": "ef937a8adf0b83e0a595c4615534761626a31587321519b0a4ac896a16b81ede",
    "validation-pointed-firs": "14553ad40636529fdeafdcfeaae7f457318c8484af9e2636978e8dfc3b2ef6d3",
    "validation-woodlanders": "644dc0c089c39f8be6fe41e64ca3de29f31cdd876879aa208917815b902548bb",
}
EXPECTED_CONTENT_DIGESTS = {
    "calibration-theron-ware": "1b1708265369e91930736ea251258286bc597678750a4b18eab3d35228ca8a6d",
    "validation-custom-country": "734eb158d70fa5999ee391d5edb28f51ba5f7bbfb562e3004ccace6418373698",
    "validation-odd-women": "bf4a72ffe5cfae4f480924439968d308bda9cb26ce4d3cdc278c0dda08106509",
    "validation-pointed-firs": "4d41b3955762d25ec2fafd2fb64fa06a025ee43a9d19f3666f79e84c1ac5861a",
    "validation-woodlanders": "a961f1db5b231413fcaa03c0ac31ebf84b887763346448a3759427be7c7aa559",
}
EXPECTED_ALLOCATION_IDS = {
    "calibration-theron-ware": (
        "allocation-5026e0fb15d44880de9d75891f39f22a7036c2de0673fb7dcb051aa52c129676"
    ),
    "validation-custom-country": (
        "allocation-b68f706f5c41d7eb959a82c4d803ebcefab649ea3b6b086313f1c1217c0cf4a4"
    ),
    "validation-odd-women": (
        "allocation-f8b7f6257b1287599fb77a7d098ac2e5d5394923e5c3c55edcc429f6bb1a0ac2"
    ),
    "validation-pointed-firs": (
        "allocation-1ed3597b61764b3b90ebe3b5b8e4e8cff4078af52731e8377a20ba06f7685d8d"
    ),
    "validation-woodlanders": (
        "allocation-7286b68f9d60b9aa6a5e3209050455abd6b4e2f5c0773432c66bcd022a5fcd8f"
    ),
}
EXPECTED_VARIANT_BUILD_IDS = {
    "calibration-theron-ware": {
        "stationary": "build-655d86ff2ea73553dafdca95f96f41aa5057c3343cf791d6bb37599e4d62a457",
        "rekey": "build-ebcfd2582438abb25713581cf2cd083a0aab44ceddc4f8a60af19f9d6f25af5a",
    },
    "validation-custom-country": {
        "stationary": "build-1229903224458cd06c06eeb8a2058f92f4d7d42be1b30b3ee9a54fac4f4cebb7",
        "rekey": "build-657887be421e0f1e263485d0ee0d589d157aff6191e3bfc72088d9bdb20a33ee",
    },
    "validation-odd-women": {
        "stationary": "build-c827dbd87d3c18637ecf663556a8cd6b9c2deff9f473dbc271d40dee989708de",
        "rekey": "build-d054ed1a3838683bf793427655ca30b3550597aa359b9ef8847884f26d1a650b",
    },
    "validation-pointed-firs": {
        "stationary": "build-3b5352e681b5c5008f695ee30f6673911b821596fabcbf6782f68e790d3fa4ac",
        "rekey": "build-71fea3a9cb927d67467aef00a729e284f38fbeae8c39ada364a33f64d3279692",
    },
    "validation-woodlanders": {
        "stationary": "build-bae07aa8347c4bd73e08778843de792b12aaabb19b272ac370e83167203e40b8",
        "rekey": "build-dfbacfa3588b43bb0626803b58638b7a3e9253386a009eb62d0979021f85d203",
    },
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
        assert decoded.content_digest == EXPECTED_CONTENT_DIGESTS[fixture_id]
        assert decoded.content_digest == decoded.computed_content_digest(root)
        assert decoded.allocation.allocation_id == EXPECTED_ALLOCATION_IDS[fixture_id]
        assert {name: variant.build_id for name, variant in decoded.variants.items()} == (
            EXPECTED_VARIANT_BUILD_IDS[fixture_id]
        )
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
