# Research: Offline End-to-End Puzzle Harness

## Decision 1: Extend the retained Gate C profile into the production instance

**Decision**: Reuse the retained chapters, normalization, entity review, stationary key, partial re-key, matched controls, and reveal geometry as the first production profile. Generalize artifact projection and three-shard packaging around those functions rather than creating another corpus experiment.

**Rationale**: Those puzzle semantics already have deterministic property, leakage, scoring, and replay coverage. The missing evidence is integration, not another corpus choice.

**Alternatives considered**:

- A new corpus family was rejected because it reopens the deferred generalization question and delays the harness.
- Copying Gate C outputs directly was rejected because calibration artifacts are not production bundle inputs and omit three-shard, reference-corpus, and run manifests.

## Decision 2: Use four schema families with individually registered records

**Decision**: Add instance, run-control, grading, and offline-completion schema families. Register each externally exchanged record ID in both runtimes and validate shared golden fixtures.

**Rationale**: Separate schema files keep related `$defs` coherent while preserving record-level validation and avoiding one file per small event.

**Alternatives considered**:

- One monolithic harness schema was rejected because unrelated lifecycle and grading changes would share a version.
- Type-only interfaces were rejected because JSON Schema is the project authority.

## Decision 3: Separate run control from Git admission

**Decision**: Add `@palimpsest/run-control` and `@palimpsest/git-gateway`. The coordinator requests repository actions through the Gateway contract and cannot write refs, ledger entries, or publication snapshots directly.

**Rationale**: The architecture assigns different privileges and integrity failures to these services. A package boundary makes tests and future process separation explicit.

**Alternatives considered**:

- A single orchestration package was rejected because it collapses the most important least-privilege boundary.
- A replacement collaboration API was rejected because the puzzle requires native Git behavior.

## Decision 4: Exercise ordinary Git through a local smart transport

**Decision**: Fixture agents use unmodified Git commands against an authenticated local smart-HTTP transport backed by `git-http-backend`. Receive processing enters quarantine and calls the Gateway admission path before authoritative refs or ledgers change.

**Rationale**: This keeps client-visible clone, fetch, pull, push, stale-update, and disconnect behavior faithful while allowing deterministic local tests without external networking.

**Alternatives considered**:

- Direct filesystem remotes were rejected because they bypass authentication and transport policy.
- A custom commit/message API was rejected because it changes the research object.

## Decision 5: Use deterministic subprocess fixture workers

**Decision**: The host model bridge launches local fixture workers through the same versioned NDJSON request, event, file, quota, and terminal contract later used by provider-backed workers. Fixture workers inspect only released files, use ordinary Git, write private deliverables, and never load provider SDKs or credentials.

**Rationale**: A deterministic worker can exercise every runtime boundary without pretending to be a model or spending API quota.

**Alternatives considered**:

- In-process fake callbacks were rejected for end-to-end evidence because they skip process, filesystem, logging, timeout, and termination behavior.
- Recorded OpenAI responses were rejected because they still couple the harness to an isolated pre-integration model experiment.

## Decision 6: Share one clock contract and inject time only in tests

**Decision**: The production coordinator owns one monotonic epoch. Unit and integration tests inject a deterministic clock, but both clock implementations emit identical reveal, publication, deadline, and freeze events and enforce absolute offsets.

**Rationale**: Fast offline tests must not weaken the rule that solver activity cannot pace evidence or publication.

**Alternatives considered**:

- Turn-based fixtures were rejected because they would validate the wrong lifecycle.
- Blocking real-time tests for every scenario were rejected because failure injection would be slow and flaky.

## Decision 7: Require container isolation for the completion report

**Decision**: Unit tests may use isolated host processes, but the passing Milestone 6 report requires digest-pinned network-disabled containers with explicit read-only public inputs, one agent-private shard/reveal mount, one workspace, one authenticated Git endpoint, and one private output mount.

**Rationale**: Trust-boundary completion cannot be inferred from mocked paths. Docker 29.2.1 is available on the reference host; image digests and daemon information are recorded in evidence.

**Alternatives considered**:

- `sandbox-exec` alone was rejected because the reference architecture is container-based and its policy is deprecated and host-specific.
- Treating process tests as equivalent was rejected because they cannot prove image, mount, credential, or network isolation.

## Decision 8: Treat solver bundles as hostile archives

**Decision**: Validate paths, entry types, counts, byte totals, duplicates, links, devices, sparse entries, executable declaration, inputs, outputs, and producer version before extraction. Execute in a fresh network-disabled container, then compare declared bytes and hashes without importing solver code.

**Rationale**: Grading an untrusted submission is a privileged boundary and must fail closed before execution or promotion.

**Alternatives considered**:

- Extract-then-inspect was rejected because archive traversal and special entries can act during extraction.
- Python imports were rejected because submitted solvers may use any executable runtime.

## Decision 9: Preserve immutable attempts and exact replay identity

**Decision**: Every run uses `artifacts/harness/attempts/<declaration-digest>/<run-id>/`. `attempt.json` is written before side effects; `terminal.json` is atomic and lists every other output. `current.json` is an atomic operator pointer with `evidence:false`.

**Rationale**: Retries, concurrent work, and partial failures must never mix with prior evidence.

**Alternatives considered**:

- Shared work directories and newest-directory discovery were rejected because stale outputs can appear current.
- Overwriting failed attempts was rejected because failure evidence is part of the audit trail.

## Decision 10: Make the authorization claim narrow

**Decision**: A passing offline completion report states only that the integrated implementation is ready for live Gate C/D evaluation. It does not claim the fixture agents solve, revise beliefs, collaborate effectively, or predict model outcomes.

**Rationale**: Deterministic fixture behavior proves software integration, not empirical model behavior.
