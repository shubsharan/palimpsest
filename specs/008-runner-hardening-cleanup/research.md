# Research: Runner Hardening and Greenfield Cleanup

## Decision: One injected command sandbox

**Decision**: Replace direct host-shell spawning with a `CommandSandbox` interface and one Docker implementation used by agent commands and reviewer evaluation.

**Rationale**: The current working-directory restriction does not stop absolute paths, parent traversal through tools, symbolic links, environment inspection, or network access. Injection keeps tests deterministic and prevents a second unsafe production path.

**Alternatives considered**:

- macOS `sandbox-exec`: platform-specific, deprecated, and unsuitable for the Linux verification path.
- A restricted shell or command allowlist: prescribes agent workflow and still does not isolate files or credentials.
- Long-lived per-agent containers: adds lifecycle state without a current need; persistent bind mounts already preserve work between short-lived commands.

## Decision: Minimal fixed container policy

**Decision**: Use a digest-pinned Python 3.12.4 slim image with Git and POSIX utilities, executed with fixed mounts, no network, no capabilities, no new privileges, a read-only root, host UID/GID, tmpfs, and bounded CPU, memory, PIDs, time, and captured output.

**Rationale**: Shell, Python, and ordinary Git cover the current fixture and common solver work while the mount view enforces the declared puzzle boundary. Fixed operational limits protect the host and remain independent of model behavior.

**Alternatives considered**:

- Preserve the old Node clean-solver image: it lacks Git and the required Python runtime and represents a superseded manifest-driven evaluator.
- Install every host development tool: broadens the image and claim surface without a current puzzle need.
- Treat limit breaches as invalid attempts: conflicts with outcome-first observation; command termination remains recorded behavior unless the sandbox itself fails.

## Decision: Label-validated local image

**Decision**: Build `palimpsest-puzzle-sandbox:0.1.0`, attach the Dockerfile SHA-256 as an OCI label, validate the label before execution, and record the inspected image ID in each attempt.

**Rationale**: A mutable local tag alone can silently select stale code. A full image promotion system would recreate obsolete infrastructure. One source label plus the runtime image ID is the minimum needed to detect staleness and inspect an attempt.

**Alternatives considered**:

- Commit a machine-specific image ID: IDs vary by architecture and rebuild.
- Pull a mutable public tag at run time: requires network and can change silently.
- Restore the old image lock/promotion protocol: excessive for a local behavior-neutral runner.

## Decision: Resumable trace writer with a sidecar origin

**Decision**: Create `trace.meta.json` once and route live, overlap, and evaluation events through `JsonlObservationLog.create/open`.

**Rationale**: A later process cannot reuse `performance.now()` from the run process. A persisted wall-clock origin plus validation and clamping preserves observable order across processes without claiming exact scheduling replay.

**Alternatives considered**:

- Continue setting post-run `atMs` to zero: corrupts chronology.
- Use only wall-clock timestamps: vulnerable to backward clock movement and less useful for elapsed timing.
- Rewrite the trace after the run: risks changing evidence and is unnecessary.

## Decision: Reachable object scan by blob identity

**Decision**: Enumerate all unique objects reachable from current refs, classify them in a batch, and observe valid text blobs regardless of current tree membership. Separately enumerate reachable commit trees to count repeated blob references across paths and historical trees.

**Rationale**: A committed-then-deleted file remains reachable through its commit but is absent from `ls-tree` at the branch tip. Blob identity naturally deduplicates content for analysis, while tree-reference counts make the reported duplicate decision meaningful.

**Alternatives considered**:

- Scan current branch tips: misses historical content.
- Scan reflogs and unreachable objects: exceeds the ordinary shared Git state promised to agents and makes retention environment-dependent.
- Inspect or reject content before push: changes voluntary Git behavior and turns observation into policy.

## Decision: Delete the legacy dependency graph

**Decision**: Move the small active Python helper closure into `palimpsest.puzzle`, retain only `packages/puzzle-runner`, and delete superseded packages, Gate tools/tests, historical tracked artifacts, specifications 001–005, and dependencies used only by those surfaces.

**Rationale**: Active puzzle imports do not depend on the TypeScript legacy packages. Python puzzle code needs only canonical serialization, corpus parsing, cipher/text helpers, partial revision generation, and reference corpus construction. Compatibility shims would preserve obsolete architecture and verification burden.

**Alternatives considered**:

- Leave disconnected code in place: conflicts with Constitution 3.0 and keeps stale tests authoritative.
- Deprecate with wrappers: adds code without a consumer.
- Retain tracked run artifacts for provenance: Git history already preserves them; generated output belongs under ignored `artifacts/`.

## Decision: Preserve specification 006 as history

**Decision**: Keep `specs/006-behavior-neutral-runner` byte-for-byte and express the Docker and retention changes only in feature 008 and current docs.

**Rationale**: Specification 006 records the completed behavior-neutral refactor. Editing it would rewrite the decision record, while deleting 001–005 and requiring Docker are deliberate later changes.

**Alternatives considered**:

- Update 006 in place: obscures which decisions belonged to the merged feature.
- Delete all prior specs: loses the current runner's primary design record.
