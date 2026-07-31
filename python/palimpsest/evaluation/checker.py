from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..serialization import canonical_json_bytes
from .score import score_reconstruction


def _fixture_variant(
    fixture_root: Path, variant_id: str
) -> tuple[tuple[str, ...], int, dict[tuple[str, int], Path]]:
    manifest_path = fixture_root / "fixture.json"
    value = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("Fixture package manifest must use schemaVersion 1.")
    raw_agents = value.get("agentIds")
    stage_count = value.get("stageCount")
    raw_variants = value.get("variants")
    if (
        not isinstance(raw_agents, list)
        or not raw_agents
        or any(not isinstance(agent, str) or not agent for agent in raw_agents)
        or isinstance(stage_count, bool)
        or not isinstance(stage_count, int)
        or stage_count < 1
        or not isinstance(raw_variants, dict)
    ):
        raise ValueError("Fixture package geometry is invalid.")
    raw_variant = raw_variants.get(variant_id)
    if not isinstance(raw_variant, dict) or raw_variant.get("variantId") != variant_id:
        raise ValueError(f"Unknown fixture variant: {variant_id}.")
    raw_stages = raw_variant.get("stages")
    if not isinstance(raw_stages, list):
        raise ValueError(f"Fixture variant {variant_id} stages are invalid.")
    stage_paths: dict[tuple[str, int], Path] = {}
    for item in raw_stages:
        if not isinstance(item, dict):
            raise ValueError(f"Fixture variant {variant_id} stages are invalid.")
        agent_id = item.get("agentId")
        ordinal = item.get("ordinal")
        source_path = item.get("sourcePath")
        if (
            agent_id not in raw_agents
            or isinstance(ordinal, bool)
            or not isinstance(ordinal, int)
            or not 1 <= ordinal <= stage_count
            or not isinstance(source_path, str)
        ):
            raise ValueError(f"Fixture variant {variant_id} stages are invalid.")
        path = Path(source_path)
        if path.is_absolute() or ".." in path.parts or path.name != path.parts[-1]:
            raise ValueError(f"Fixture variant {variant_id} stage path is invalid.")
        key = (agent_id, ordinal)
        if key in stage_paths:
            raise ValueError(f"Fixture variant {variant_id} contains duplicate stages.")
        stage_paths[key] = path
    expected = {
        (agent_id, ordinal) for agent_id in raw_agents for ordinal in range(1, stage_count + 1)
    }
    if set(stage_paths) != expected:
        raise ValueError(f"Fixture variant {variant_id} stage geometry is incomplete.")
    return tuple(raw_agents), stage_count, stage_paths


def _released_prefix(ordinals: tuple[int, ...], stage_count: int) -> tuple[int, ...]:
    if ordinals != tuple(range(1, len(ordinals) + 1)) or len(ordinals) > stage_count:
        raise ValueError("Released ordinals must be a contiguous released prefix.")
    if not ordinals:
        raise ValueError("At least one released stage is required.")
    return ordinals


def check_reconstruction(
    *,
    fixture_root: Path,
    variant_id: str,
    agent_id: str,
    released_ordinals: tuple[int, ...],
    candidate: str,
):
    agent_ids, stage_count, stage_paths = _fixture_variant(fixture_root, variant_id)
    if agent_id not in agent_ids:
        raise ValueError(f"Unknown fixture agent: {agent_id}.")
    ordinals = _released_prefix(released_ordinals, stage_count)
    truth = "\n".join(
        (
            fixture_root / "oracle" / "checker" / agent_id / stage_paths[(agent_id, ordinal)].name
        ).read_text(encoding="utf-8")
        for ordinal in ordinals
    )
    return score_reconstruction(truth, candidate)


def check_candidate_file(
    *,
    fixture_root: Path,
    variant_id: str,
    agent_id: str,
    released_ordinals: tuple[int, ...],
    candidate_path: Path,
) -> dict[str, object]:
    try:
        candidate = candidate_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return {"error": "candidate could not be read"}
    return check_reconstruction(
        fixture_root=fixture_root,
        variant_id=variant_id,
        agent_id=agent_id,
        released_ordinals=released_ordinals,
        candidate=candidate,
    ).to_dict()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--variant", required=True)
    parser.add_argument("--agent", required=True)
    parser.add_argument("--released", required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    args = parser.parse_args()
    ordinals = tuple(int(value) for value in args.released.split(",") if value)
    result = check_candidate_file(
        fixture_root=args.fixture,
        variant_id=args.variant,
        agent_id=args.agent,
        released_ordinals=ordinals,
        candidate_path=args.candidate,
    )
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
