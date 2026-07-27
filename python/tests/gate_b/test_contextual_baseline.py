from __future__ import annotations

import numpy as np
from palimpsest.baselines.contextual import optimal_contextual_assignment


def test_contextual_assignment_uses_global_maximum_and_preserves_candidates() -> None:
    scores = np.array([[9.0, 8.0, 0.0], [8.0, 1.0, 0.0], [0.0, 0.0, 7.0]])
    mapping = optimal_contextual_assignment(
        ["cipher-a", "cipher-b", "cipher-c"],
        ["plain-a", "plain-b", "plain-c"],
        scores,
    )
    assert mapping == {
        "cipher-a": "plain-b",
        "cipher-b": "plain-a",
        "cipher-c": "plain-c",
    }
