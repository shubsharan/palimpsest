from __future__ import annotations

from collections import Counter
from typing import Any

from palimpsest.generation.text import word_tokens


def cipher_view_canary(value: str) -> dict[str, Any]:
    tokens = word_tokens(value)
    counts = Counter(token.normalized for token in tokens if token.normalized is not None)
    return {
        "wordTokenCount": len(tokens),
        "vocabularySize": len(counts),
        "frequencySignature": sorted(counts.values(), reverse=True)[:256],
        "capitalizedTokenCount": sum(token.surface[:1].isupper() for token in tokens),
    }


def raw_generation_canary(value: str, *, maximum_tokens: int = 128) -> dict[str, Any]:
    tokens = word_tokens(value)[:maximum_tokens]
    return {
        "tokenCount": len(tokens),
        "continuationRequested": True,
        "generatedContinuation": "",
        "identificationClaim": None,
        "status": "valid-no-identification",
    }
