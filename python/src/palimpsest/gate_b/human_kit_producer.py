from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from palimpsest.contracts import canonical_json_bytes

from .config import GATE_B_INSTANCES
from .pre_solve_canary import require_admitted_matrix
from .solver_packets import INSTRUCTIONS, REFERENCE_PATH

ROOT = Path(__file__).resolve().parents[4]
GATE_B_ROOT = ROOT / "artifacts" / "gate-b"
RECORDER_PATH = ROOT / "tools" / "gate-b" / "human-solver-recorder.py"


def produce_kit(instance_id: str) -> dict[str, str]:
    require_admitted_matrix()
    if instance_id not in {config.instance_id for config in GATE_B_INSTANCES}:
        raise ValueError(f"Unknown Gate B instance: {instance_id}")
    instance_root = GATE_B_ROOT / "instances" / instance_id
    output_root = GATE_B_ROOT / "human-study-kits" / instance_id
    output_root.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(instance_root / "public" / "cipher.txt", output_root / "cipher.txt")
    shutil.copyfile(
        instance_root / "public" / "manifest.json",
        output_root / "public-manifest.json",
    )
    shutil.copyfile(REFERENCE_PATH, output_root / "reference.txt")
    shutil.copyfile(RECORDER_PATH, output_root / "record.py")
    (output_root / "instructions.txt").write_text(INSTRUCTIONS, encoding="utf-8")
    return {"instanceId": instance_id, "output": str(output_root.relative_to(ROOT))}


def main() -> None:
    parser = argparse.ArgumentParser()
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--instance")
    selection.add_argument("--all", action="store_true")
    args = parser.parse_args()
    instance_ids = (
        [config.instance_id for config in GATE_B_INSTANCES] if args.all else [args.instance]
    )
    result = {
        "schemaVersion": 1,
        "kits": [produce_kit(instance_id) for instance_id in instance_ids],
    }
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
