from __future__ import annotations

import pytest

from .helpers import load_fixture_cases


@pytest.fixture(scope="session")
def fixture_cases() -> list[dict[str, object]]:
    return load_fixture_cases()
