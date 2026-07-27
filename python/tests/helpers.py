from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FIXTURES_ROOT = Path(__file__).resolve().parents[2] / "packages" / "contracts" / "fixtures"


def load_fixture_cases() -> list[dict[str, Any]]:
    manifest = json.loads((FIXTURES_ROOT / "manifest.json").read_text(encoding="utf-8"))
    return list(manifest["fixtures"])


def load_fixture_raw(fixture: dict[str, Any]) -> str:
    return (FIXTURES_ROOT / fixture["inputPath"]).read_text(encoding="utf-8")
