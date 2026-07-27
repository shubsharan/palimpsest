from __future__ import annotations

import math
from collections import Counter, defaultdict

import numpy as np
from scipy.optimize import linear_sum_assignment

from palimpsest.generation.text import word_tokens


def _signatures(value: str) -> dict[str, np.ndarray]:
    words = [token.normalized for token in word_tokens(value) if token.normalized is not None]
    counts = Counter(words)
    positions: dict[str, list[float]] = defaultdict(list)
    left_frequencies: dict[str, list[float]] = defaultdict(list)
    right_frequencies: dict[str, list[float]] = defaultdict(list)
    neighbors: dict[str, Counter[str]] = defaultdict(Counter)
    denominator = max(1, len(words) - 1)
    for index, word in enumerate(words):
        positions[word].append(index / denominator)
        if index > 0:
            left = words[index - 1]
            left_frequencies[word].append(math.log1p(counts[left]))
            neighbors[word][left] += 1
        if index + 1 < len(words):
            right = words[index + 1]
            right_frequencies[word].append(math.log1p(counts[right]))
            neighbors[word][right] += 1

    def mean(values: list[float]) -> float:
        return sum(values) / len(values) if values else 0.0

    result = {}
    for word in counts:
        total_neighbors = sum(neighbors[word].values())
        entropy = 0.0
        for count in neighbors[word].values():
            probability = count / total_neighbors
            entropy -= probability * math.log(probability)
        result[word] = np.array(
            [
                math.log1p(counts[word]),
                mean(positions[word]),
                float(np.std(positions[word])),
                mean(left_frequencies[word]),
                mean(right_frequencies[word]),
                entropy,
            ],
            dtype=np.float64,
        )
    return result


def align_context_signatures(
    cipher_text: str,
    reference_text: str,
    initial_mapping: dict[str, str],
    *,
    maximum_types: int = 300,
) -> dict[str, str]:
    cipher_signatures = _signatures(cipher_text)
    reference_signatures = _signatures(reference_text)
    selected_cipher = sorted(
        cipher_signatures,
        key=lambda word: (-cipher_signatures[word][0], word),
    )[:maximum_types]
    candidates = [initial_mapping[word] for word in selected_cipher]
    cipher_matrix = np.vstack([cipher_signatures[word] for word in selected_cipher])
    reference_matrix = np.vstack(
        [reference_signatures.get(word, np.zeros(6, dtype=np.float64)) for word in candidates]
    )
    combined = np.vstack([cipher_matrix, reference_matrix])
    scale = np.std(combined, axis=0)
    scale[scale == 0] = 1
    center = np.mean(combined, axis=0)
    cipher_matrix = (cipher_matrix - center) / scale
    reference_matrix = (reference_matrix - center) / scale
    costs = np.sum((cipher_matrix[:, None, :] - reference_matrix[None, :, :]) ** 2, axis=2)
    for row, cipher_type in enumerate(selected_cipher):
        for column, candidate in enumerate(candidates):
            if cipher_type == candidate:
                costs[row, column] = 1e12
    rows, columns = linear_sum_assignment(costs)
    mapping = dict(initial_mapping)
    for row, column in zip(rows, columns, strict=True):
        mapping[selected_cipher[int(row)]] = candidates[int(column)]
    if set(mapping.values()) != set(initial_mapping.values()):
        raise RuntimeError("Context alignment violated the baseline mapping bijection.")
    return dict(sorted(mapping.items()))
