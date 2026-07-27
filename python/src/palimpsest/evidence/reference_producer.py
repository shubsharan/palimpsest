from __future__ import annotations

import argparse
import errno
import socket
import sys
import time
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_archive_bytes, canonical_json_bytes, sha256_hex

PRODUCER_NAME = "reference-producer"
PRODUCER_VERSION = "1.0.0"


class ProducerError(RuntimeError):
    pass


def _record(sequence: int, kind: str, request_digest: str, **extra: Any) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "sequence": sequence,
        "kind": kind,
        "requestDigest": request_digest,
        **extra,
    }


def _manifest(
    request: dict[str, Any],
    request_digest: str,
    declared_outputs: list[tuple[str, bytes]],
    mode: str,
) -> dict[str, Any]:
    output_entries = [
        {
            "path": path,
            "byteLength": len(content),
            "sha256": sha256_hex(content),
        }
        for path, content in sorted(declared_outputs)
    ]
    archive = canonical_archive_bytes(
        {
            "schemaVersion": 1,
            "contractId": "canonical-archive",
            "entries": [
                {
                    "path": path,
                    "kind": "file",
                    "contentBase64": __import__("base64").b64encode(content).decode("ascii"),
                }
                for path, content in sorted(declared_outputs)
            ],
        }
    )
    manifest = {
        "schemaVersion": 1,
        "requestDigest": request_digest,
        "producer": {
            "name": PRODUCER_NAME,
            "version": "9.9.9" if mode == "disallowed-producer-version" else PRODUCER_VERSION,
        },
        "environment": request["environment"],
        "immutableInputs": request["immutableInputs"],
        "outputs": output_entries,
        "archive": {
            "byteLength": len(archive),
            "sha256": sha256_hex(archive),
        },
    }
    if mode == "digest-mismatch":
        manifest["outputs"][0]["sha256"] = "0" * 64
    elif mode == "length-mismatch":
        manifest["outputs"][0]["byteLength"] += 1
    return manifest


def produce(request: dict[str, Any], output_dir: Path, mode: str) -> list[dict[str, Any]]:
    if output_dir.exists() and any(output_dir.iterdir()):
        raise ProducerError("Output directory must be empty.")
    output_dir.mkdir(parents=True, exist_ok=True)
    request_digest = sha256_hex(canonical_json_bytes(request))
    records = [_record(0, "started", request_digest)]
    message = request.get("payload", {}).get("message")
    if not isinstance(message, str):
        raise ProducerError("Reference request payload requires a string message.")
    content = message.encode("utf-8")

    if mode == "network-probe":
        probe = socket.socket()
        probe.settimeout(0.25)
        try:
            probe.connect(("1.1.1.1", 53))
        except OSError as error:
            if error.errno not in {errno.EACCES, errno.EPERM}:
                raise ProducerError(
                    f"Network probe failed without a network-denial error: {error}"
                ) from error
        else:
            raise ProducerError("Network probe unexpectedly connected.")
        finally:
            probe.close()

    if mode == "producer-failure":
        (output_dir / "partial.txt").write_bytes(content[:1])
        raise ProducerError("Injected producer failure.")

    declared_outputs: list[tuple[str, bytes]]
    if mode == "missing-output":
        declared_outputs = [("missing.txt", content)]
    else:
        (output_dir / "result.txt").write_bytes(content)
        declared_outputs = [("result.txt", content)]

    if mode == "undeclared-output":
        (output_dir / "extra.txt").write_text("undeclared\n", encoding="utf-8")

    manifest = _manifest(request, request_digest, declared_outputs, mode)
    records.append(_record(1, "completed", request_digest, responseManifest=manifest))
    return records


def _write_record(record: dict[str, Any]) -> None:
    sys.stdout.buffer.write(canonical_json_bytes(record) + b"\n")
    sys.stdout.buffer.flush()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", required=True)
    args = parser.parse_args()
    request = __import__("json").loads(args.request.read_text(encoding="utf-8"))
    request_digest = sha256_hex(canonical_json_bytes(request))

    if args.mode == "timeout":
        _write_record(_record(0, "started", request_digest))
        time.sleep((int(request["deadlineMs"]) / 1000) + 2)
        return
    if args.mode == "malformed-progress":
        _write_record(_record(0, "started", request_digest))
        sys.stdout.write("{not-json\n")
        sys.stdout.flush()
        return
    if args.mode == "truncated-progress":
        _write_record(_record(0, "started", request_digest))
        return

    try:
        records = produce(request, args.output, args.mode)
    except ProducerError as error:
        _write_record(_record(0, "started", request_digest))
        print(str(error), file=sys.stderr)
        raise SystemExit(7) from error

    for record in records:
        _write_record(record)


if __name__ == "__main__":
    main()
