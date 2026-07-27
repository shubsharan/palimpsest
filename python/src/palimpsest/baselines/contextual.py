from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
from scipy.optimize import linear_sum_assignment
from transformers import AutoModelForMaskedLM, AutoTokenizer

from palimpsest.generation.text import word_tokens

MODEL_ROOT = (
    Path(__file__).resolve().parents[4]
    / "artifacts"
    / "gate-b"
    / "inputs"
    / "models"
    / "distilroberta-base"
)


def optimal_contextual_assignment(
    cipher_types: list[str],
    candidates: list[str],
    scores: np.ndarray,
) -> dict[str, str]:
    if scores.shape != (len(cipher_types), len(candidates)):
        raise ValueError("Contextual score matrix does not match its labels.")
    rows, columns = linear_sum_assignment(-scores)
    return dict(
        sorted(
            (cipher_types[int(row)], candidates[int(column)])
            for row, column in zip(rows, columns, strict=True)
        )
    )


@lru_cache(maxsize=1)
def _model():
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ROOT, local_files_only=True)
    model = AutoModelForMaskedLM.from_pretrained(MODEL_ROOT, local_files_only=True)
    model.eval()
    return tokenizer, model


def refine_with_contextual_model(
    cipher_text: str,
    initial_mapping: dict[str, str],
    *,
    maximum_types: int = 24,
    window_tokens: int = 24,
) -> dict[str, str]:
    tokenizer, model = _model()
    cipher_words = [
        token.normalized for token in word_tokens(cipher_text) if token.normalized is not None
    ]
    positions = {}
    for index, word in enumerate(cipher_words):
        positions.setdefault(word, index)
    eligible = [
        word
        for word in sorted(positions)
        if len(tokenizer.encode(f" {initial_mapping[word]}", add_special_tokens=False)) == 1
    ][:maximum_types]
    if len(eligible) < 2:
        return dict(sorted(initial_mapping.items()))
    candidates = [initial_mapping[word] for word in eligible]
    candidate_ids = [
        tokenizer.encode(f" {candidate}", add_special_tokens=False)[0] for candidate in candidates
    ]
    prompts = []
    for cipher_type in eligible:
        index = positions[cipher_type]
        start = max(0, index - window_tokens)
        end = min(len(cipher_words), index + window_tokens + 1)
        decoded = [initial_mapping[word] for word in cipher_words[start:end]]
        decoded[index - start] = tokenizer.mask_token
        prompts.append(" ".join(decoded))
    encoded = tokenizer(prompts, return_tensors="pt", padding=True, truncation=True, max_length=128)
    mask_positions = (encoded["input_ids"] == tokenizer.mask_token_id).nonzero(as_tuple=False)
    if len(mask_positions) != len(prompts):
        raise RuntimeError("Contextual prompt did not contain exactly one retained mask.")
    with torch.no_grad():
        logits = model(**encoded).logits
    scores = np.empty((len(eligible), len(candidates)), dtype=np.float64)
    for prompt_index, (_, token_index) in enumerate(mask_positions):
        scores[prompt_index] = logits[prompt_index, token_index, candidate_ids].double().numpy()
    for row, cipher_type in enumerate(eligible):
        for column, candidate in enumerate(candidates):
            if cipher_type == candidate:
                scores[row, column] = -1e30
    replacement = optimal_contextual_assignment(eligible, candidates, scores)
    mapping = dict(initial_mapping)
    mapping.update(replacement)
    if set(mapping.values()) != set(initial_mapping.values()):
        raise RuntimeError("Contextual refinement violated the baseline mapping bijection.")
    return dict(sorted(mapping.items()))
