from __future__ import annotations

import argparse
import json
from pathlib import Path

from palimpsest.channel.useful_state import decode_useful_state, encode_useful_state


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--strategy", required=True)
    parser.add_argument("--encoded", required=True, type=Path)
    parser.add_argument("--result", required=True, type=Path)
    args = parser.parse_args()
    checkpoint = json.loads(args.checkpoint.read_text())
    encoded = encode_useful_state(checkpoint, args.strategy)
    decoded = decode_useful_state(encoded, args.strategy)
    args.encoded.write_bytes(encoded)
    args.result.write_text(
        json.dumps(
            {
                "decodedSemanticEquality": decoded == checkpoint,
                "encodedByteLength": len(encoded),
                "strategyId": args.strategy,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
