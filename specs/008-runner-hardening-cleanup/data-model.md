# Data Model: Runner Hardening and Greenfield Cleanup

## Sandbox Policy

Fixed operational configuration used for every untrusted command.

| Field | Meaning | Validation |
| --- | --- | --- |
| `imageTag` | Expected local sandbox tag | Exact supported tag |
| `imageId` | Inspected immutable image identity | Non-empty `sha256:` value |
| `sourceDigest` | Dockerfile digest stored in the image label | Must equal current Dockerfile SHA-256 |
| `profileVersion` | Sandbox identity contract version | `1` |
| `network` | Container network mode | Always `none` |
| `cpus` | CPU ceiling | `2` |
| `memoryBytes` | Memory ceiling | `2147483648` |
| `pids` | Process ceiling | `256` |
| `tmpfsBytes` | Disposable `/tmp` ceiling | `268435456` |
| `maxOutputBytes` | Combined captured stdout/stderr ceiling | `4194304` |

The policy is recorded for inspection. No policy field determines puzzle validity or score.

## Sandbox Mount

One explicitly declared host-to-container path.

| Field           | Meaning                         | Validation                     |
| --------------- | ------------------------------- | ------------------------------ |
| `hostPath`      | Existing host file or directory | Resolved by the trusted runner |
| `containerPath` | Stable absolute container path  | Unique within one request      |
| `access`        | `read-only` or `read-write`     | Fixed by mount role            |
| `kind`          | File or directory               | Must match the host object     |

Agent mounts are workspace, own evidence, reference corpus, and shared Git. Evaluator mounts are copied frozen workspace, public ciphertext, and frozen Git.

## Sandbox Command

One model-authored or reviewer-selected shell invocation represented by a typed union.

Common fields are `command`, `timeoutMs`, and optional trusted cancellation. An agent command additionally carries only the host workspace, own evidence, reference corpus, and active shared Git paths. An evaluation command additionally carries only the copied frozen workspace, public ciphertext, frozen Git, and workspace-relative output path. Callers cannot supply container destinations, arbitrary mounts, a working directory, or environment variables.

`DockerCommandSandbox` alone resolves the typed profile into an internal invocation containing the fixed container paths, mount modes, working directory, and allowlisted environment.

### Result

`exitCode`, `stdout`, `stderr`, `timedOut`, and `outputExceeded` retain explicit command-result semantics. Sandbox setup, inspection, and cleanup failures reject the operation instead of returning a success-shaped command result.

## Trace Metadata

Created before the first event and never rewritten.

| Field           | Meaning               | Validation             |
| --------------- | --------------------- | ---------------------- |
| `schemaVersion` | Trace metadata format | `1`                    |
| `startedAt`     | UTC wall-clock origin | Valid ISO-8601 instant |

## Observation Event

| Field      | Meaning                        | Validation                                  |
| ---------- | ------------------------------ | ------------------------------------------- |
| `sequence` | Total event order              | Positive integer; exactly previous plus one |
| `atMs`     | Elapsed time from trace origin | Finite, non-negative, nondecreasing         |
| `kind`     | Event category                 | Non-empty string                            |
| `agentId`  | Optional owning agent          | One of the three configured agents          |
| `data`     | Redacted observation payload   | JSON-serializable                           |

`JsonlObservationLog.open` validates all prior events before accepting an append. Secret-bearing field names use the same recursive redaction for every producer.

## Overlap Inventory

| Field | Meaning |
| --- | --- |
| `reachableObjectCount` | Unique object IDs returned from current refs |
| `reachableBlobReferenceCount` | Blob entries across all reachable commit trees |
| `uniqueReachableBlobCount` | Unique reachable objects classified as blobs |
| `uniqueTextBlobCount` | UTF-8, non-NUL blobs sent to observation |
| `repeatedTreeReferenceCount` | Blob tree references beyond the first reference to each unique blob |
| `skippedNonTextBlobCount` | Binary or invalid UTF-8 blobs not analyzed |
| `committed` | Mapping from blob object ID to materialized trusted observation input |

Overlap inventory is produced after freeze, does not alter Git, and has no state transition into scoring or validity.

## Attempt Summary

The existing attempt identifier, build root, sessions, trace path, and frozen root remain. The summary adds the trace metadata path and `Sandbox Policy`. Evaluation remains a separate later result under the attempt directory.

## Corpus Fixture

| Field                        | Meaning                                  |
| ---------------------------- | ---------------------------------------- |
| `sourceId`                   | Stable source identifier                 |
| `path`                       | Neutral repository-relative fixture path |
| `title` / `author`           | Human provenance                         |
| `downloadUrl` / `catalogUrl` | Acquisition provenance                   |
| `retrievedAt`                | Original acquisition date                |
| `byteLength` / `sha256`      | Exact retained source bytes              |
| `license`                    | Source license statement                 |

Only Middlemarch, Jane Eyre, and Moby-Dick remain because the active build uses them.
