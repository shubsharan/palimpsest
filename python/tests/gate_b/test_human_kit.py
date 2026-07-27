from __future__ import annotations

from pathlib import Path

from palimpsest.gate_b import human_kit_producer


def test_human_kit_contains_only_public_study_material(
    tmp_path: Path,
    monkeypatch,
) -> None:
    instance_root = tmp_path / "instances" / "instance-amber" / "public"
    instance_root.mkdir(parents=True)
    (instance_root / "cipher.txt").write_text("Cipher words.", encoding="utf-8")
    (instance_root / "manifest.json").write_text(
        '{"instanceId":"instance-amber"}',
        encoding="utf-8",
    )
    reference = tmp_path / "reference.txt"
    reference.write_text("Target-excluded words.", encoding="utf-8")
    recorder = tmp_path / "record.py"
    recorder.write_text("print('recorder')", encoding="utf-8")
    monkeypatch.setattr(human_kit_producer, "ROOT", tmp_path)
    monkeypatch.setattr(human_kit_producer, "GATE_B_ROOT", tmp_path)
    monkeypatch.setattr(human_kit_producer, "REFERENCE_PATH", reference)
    monkeypatch.setattr(human_kit_producer, "RECORDER_PATH", recorder)
    monkeypatch.setattr(
        human_kit_producer,
        "require_admitted_matrix",
        lambda: {"matrixComplete": True, "allAdmitted": True},
    )

    result = human_kit_producer.produce_kit("instance-amber")

    output = tmp_path / "human-study-kits" / "instance-amber"
    assert result["instanceId"] == "instance-amber"
    assert {path.name for path in output.iterdir()} == {
        "cipher.txt",
        "instructions.txt",
        "public-manifest.json",
        "record.py",
        "reference.txt",
    }
    combined = "\n".join(
        path.read_text(encoding="utf-8") for path in output.iterdir() if path.is_file()
    )
    assert "Middlemarch" not in combined
    assert "oracle" not in combined.casefold()
