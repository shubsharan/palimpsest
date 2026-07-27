from __future__ import annotations

import argparse
import json
from pathlib import Path

from palimpsest.contracts import canonical_json_bytes

from .model import AGENT_IDS, PuzzleBuild
from .score import score_reconstruction


def load_puzzle_build(build_root: Path) -> PuzzleBuild:
    manifest_path = build_root / "puzzle-build.json"
    value = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Puzzle build manifest must be an object.")
    return PuzzleBuild.from_dict(value)


def _released_prefix(ordinals: tuple[int, ...], stage_count: int) -> tuple[int, ...]:
    if ordinals != tuple(range(1, len(ordinals) + 1)) or len(ordinals) > stage_count:
        raise ValueError("Released ordinals must be a contiguous released prefix.")
    if not ordinals:
        raise ValueError("At least one released stage is required.")
    return ordinals


def check_reconstruction(
    *,
    build_root: Path,
    agent_id: str,
    released_ordinals: tuple[int, ...],
    candidate: str,
):
    build = load_puzzle_build(build_root)
    if agent_id not in AGENT_IDS:
        raise ValueError(f"Unknown puzzle agent: {agent_id}.")
    ordinals = _released_prefix(released_ordinals, build.stage_count)
    truth = "\n\n".join(
        (
            build_root / build.oracle_root / "checker" / agent_id / f"stage-{ordinal:02d}.txt"
        ).read_text(encoding="utf-8")
        for ordinal in ordinals
    )
    return score_reconstruction(truth, candidate)


def check_candidate_file(
    *,
    build_root: Path,
    agent_id: str,
    released_ordinals: tuple[int, ...],
    candidate_path: Path,
) -> dict[str, object]:
    try:
        candidate = candidate_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return {"error": "candidate could not be read"}
    return check_reconstruction(
        build_root=build_root,
        agent_id=agent_id,
        released_ordinals=released_ordinals,
        candidate=candidate,
    ).to_dict()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", type=Path, required=True)
    parser.add_argument("--agent", required=True)
    parser.add_argument("--released", required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    args = parser.parse_args()
    ordinals = tuple(int(value) for value in args.released.split(",") if value)
    result = check_candidate_file(
        build_root=args.build,
        agent_id=args.agent,
        released_ordinals=ordinals,
        candidate_path=args.candidate,
    )
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
