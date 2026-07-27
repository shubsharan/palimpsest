from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from time import perf_counter

from palimpsest.generation.text import word_tokens

from .common import reconstruct
from .context import align_context_signatures
from .contextual import refine_with_contextual_model
from .frequency import frequency_mapping
from .ngram import NgramModel, optimize_mapping
from .oracle_segmentation import stationary_oracle_segmentation


@dataclass(frozen=True)
class BaselineOutput:
    rung: int
    method_id: str
    mapping: dict[str, str]
    reconstruction: str
    wall_seconds: float
    diagnostics: dict[str, object]


def validate_complete_mapping(cipher_text: str, mapping: dict[str, str]) -> None:
    vocabulary = {
        token.normalized for token in word_tokens(cipher_text) if token.normalized is not None
    }
    if set(mapping) != vocabulary:
        raise ValueError("Baseline mapping keys do not equal the cipher vocabulary.")
    if set(mapping.values()) != vocabulary:
        raise ValueError("Baseline mapping values do not form a vocabulary bijection.")
    if any(cipher == plain for cipher, plain in mapping.items()):
        raise ValueError("Baseline mapping contains an impossible fixed point.")


def run_ladder(
    cipher_text: str,
    reference_text: str,
    *,
    seed_hex: str,
    ngram_iterations: int = 250,
) -> list[BaselineOutput]:
    reference_counts = Counter(
        token.normalized for token in word_tokens(reference_text) if token.normalized is not None
    )
    outputs: list[BaselineOutput] = []

    started = perf_counter()
    mapping = frequency_mapping(cipher_text, reference_counts)
    validate_complete_mapping(cipher_text, mapping)
    outputs.append(
        BaselineOutput(
            rung=1,
            method_id="frequency-syntactic-v1",
            mapping=mapping,
            reconstruction=reconstruct(cipher_text, mapping),
            wall_seconds=perf_counter() - started,
            diagnostics={"referenceTokenCount": sum(reference_counts.values())},
        )
    )

    started = perf_counter()
    ngram_result = optimize_mapping(
        cipher_text,
        mapping,
        NgramModel.from_text(reference_text),
        seed_hex=seed_hex,
        iterations=ngram_iterations,
    )
    mapping = ngram_result.mapping
    validate_complete_mapping(cipher_text, mapping)
    outputs.append(
        BaselineOutput(
            rung=2,
            method_id="trigram-annealing-v1",
            mapping=mapping,
            reconstruction=reconstruct(cipher_text, mapping),
            wall_seconds=perf_counter() - started,
            diagnostics={
                "initialPseudoLogLikelihood": ngram_result.initial_score,
                "iterations": ngram_iterations,
                "pseudoLogLikelihood": ngram_result.score,
            },
        )
    )

    started = perf_counter()
    mapping = align_context_signatures(
        cipher_text,
        reference_text,
        mapping,
        maximum_types=300,
    )
    validate_complete_mapping(cipher_text, mapping)
    outputs.append(
        BaselineOutput(
            rung=3,
            method_id="context-signature-alignment-v1",
            mapping=mapping,
            reconstruction=reconstruct(cipher_text, mapping),
            wall_seconds=perf_counter() - started,
            diagnostics={"alignedMaximumTypes": 300, "signatureDimensions": 6},
        )
    )

    started = perf_counter()
    mapping = refine_with_contextual_model(cipher_text, mapping, maximum_types=24)
    validate_complete_mapping(cipher_text, mapping)
    outputs.append(
        BaselineOutput(
            rung=4,
            method_id="distilroberta-masked-refinement-v1",
            mapping=mapping,
            reconstruction=reconstruct(cipher_text, mapping),
            wall_seconds=perf_counter() - started,
            diagnostics={"maximumTypes": 24, "modelMode": "local-files-only"},
        )
    )

    started = perf_counter()
    mapping = stationary_oracle_segmentation(mapping, segment_count=1)
    validate_complete_mapping(cipher_text, mapping)
    outputs.append(
        BaselineOutput(
            rung=5,
            method_id="oracle-segmentation-control-v1",
            mapping=mapping,
            reconstruction=reconstruct(cipher_text, mapping),
            wall_seconds=perf_counter() - started,
            diagnostics={"oracleSegmentCount": 1, "stationaryEquivalentToRung": 4},
        )
    )
    return outputs
