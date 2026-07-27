# Feature Specification: Offline End-to-End Puzzle Harness

**Feature Branch**: `005-end-to-end-harness` **Created**: 2026-07-26 **Status**: Ready for planning **Input**: Build the complete Palimpsest puzzle harness end to end with deterministic fixtures and fake model adapters before any further live model evaluation.

## User Scenarios & Testing

### User Story 1 - Build one playable puzzle bundle (Priority: P1)

An operator builds one complete, immutable puzzle bundle containing everything the trusted runtime, three private agents, clean solver, grader, and replay process require without exposing oracle or future evidence.

**Why this priority**: The runtime cannot be tested honestly until the generator emits the same production-shaped public, private, reveal, scoring, and provenance boundaries that a real run will consume.

**Independent Test**: Build the same frozen request twice and verify that every declared file, canonical byte length, digest, visibility projection, shard boundary, reveal, and oracle relationship is identical and accepted by runtime preflight.

**Acceptance Scenarios**:

1. **Given** a frozen source, profile, seed, and difficulty policy, **When** an operator builds an instance, **Then** the result contains complete public, reference-corpus, private-shard, reveal, scoring, and sealed-oracle manifests with exact immutable references.
2. **Given** the same frozen request and supported environment, **When** the build is repeated, **Then** every promoted artifact byte and digest is identical.
3. **Given** an agent-visible projection, **When** it is inspected for private material, **Then** it contains no source identity, plaintext, key, future chapter, other shard, oracle threshold, credential, or private submission data.

---

### User Story 2 - Complete one production-shaped offline run (Priority: P2)

An operator launches three isolated deterministic fixture agents that receive private shards progressively, collaborate asynchronously through ordinary Git, encounter budget and publication controls, freeze consistently, and submit private deliverables.

**Why this priority**: The puzzle is an asynchronous collaboration system. A generator or collection of unit-tested services is insufficient unless the native Git, reveal, lifecycle, isolation, accounting, freeze, and submission boundaries work together.

**Independent Test**: Run one offline three-agent fixture from prepared bundle through sealed submissions using the production lifecycle and real Git repositories, with all model calls replaced by deterministic fake adapters that use the same host bridge contract.

**Acceptance Scenarios**:

1. **Given** a valid prepared run, **When** the common launch barrier opens, **Then** three agents run concurrently without configured roles, turns, or commit order and can use ordinary clone, fetch, pull, commit, merge, and push workflows.
2. **Given** scheduled chapter releases and publication slots, **When** agents work, **Then** releases follow one authoritative clock and peers observe only immutable published snapshots.
3. **Given** accepted and rejected pushes, **When** the Git Gateway processes them, **Then** ref policy, object safety, logical-state accounting, cumulative budgets, rate limits, and per-sender attribution match the frozen rules exactly.
4. **Given** the push deadline and bounded drain complete, **When** the run freezes, **Then** the final ref map, visibility journal, ledgers, event-chain head, and read-only finalization view agree.
5. **Given** private deliverables from all agents, **When** finalization closes, **Then** submissions are sealed without becoming peer-visible or entering the shared repository.

---

### User Story 3 - Grade, replay, and publish the offline run (Priority: P3)

A reviewer takes only sealed run artifacts, re-executes a hostile-by-default solver bundle in a clean environment, computes all declared scores, reconstructs trusted state, and emits a redacted report whose claims are limited to implementation correctness.

**Why this priority**: A run is not an auditable research artifact until grading and replay prove that accepted Git state, ledgers, events, submissions, scores, and public output are bound to one immutable identity.

**Independent Test**: Starting from the sealed offline run, execute the clean solver, grade it, replay every trusted state transition, and regenerate an identical report bundle without reading mutable pointers or invoking a model.

**Acceptance Scenarios**:

1. **Given** a valid sealed submission, **When** the clean solver executor runs it, **Then** only declared filtered inputs are visible and the reconstruction is compared byte-for-byte with the withheld target.
2. **Given** a hostile, partial, undeclared, malformed, or escaping solver bundle, **When** it is validated, **Then** no success-shaped solver or score artifact is promoted.
3. **Given** a sealed trusted replay bundle, **When** replay runs, **Then** it reproduces every accepted ref/object state, ledger total, reveal, freeze digest, solver result, score, and report digest.
4. **Given** the private completed run, **When** the public report is emitted, **Then** it omits secrets and private telemetry and explicitly states that deterministic fixture behavior is not empirical model evidence.

### Edge Cases

- Two agents push competing fast-forward updates from the same base during one publication slot.
- A sender exposes the same object more than once or two senders expose identical objects.
- A push is admitted before the deadline but completes during bounded drain.
- A client disconnects after a push becomes authoritative but before receiving the response.
- A reveal or publication attempt is early, late beyond tolerance, duplicated, partial, or out of order.
- A process crashes before or after reservation, ref update, ledger commit, event completion, freeze, or artifact promotion.
- A solver archive contains traversal, links, duplicate paths, devices, sparse entries, undeclared files, or entry and byte bombs.
- A mutable operator pointer names a different run than the explicit replay identity.

## Evidence & Trust Boundaries

**Owning Milestone**: Roadmap Milestones 4–6, culminating in the Milestone 6 live-model authorization decision.

**End-to-End Contribution**: Completes generation, preflight, launch, reveal, native Git collaboration, accounting, publication, freeze, private submission, clean execution, scoring, replay, and redacted reporting as one offline lifecycle.

**Model Execution Policy**: Live OpenAI and other external model calls are prohibited. All agent behavior uses deterministic fake model adapters through the same host bridge contract that later live adapters must implement.

**Completion Evidence**: Freeze the instance request, fixture-agent policy, runtime policy, accounting version and budget, reveal and publication clocks, solver bundle, scoring policy, supported environment, exact output set, and failure injection matrix. Completion requires deterministic repeated builds, a sealed production-shaped run, independent replay, public redaction checks, and the full applicable verification suite.

**Trust & Visibility Impact**: Python generation, grading, and replay remain trusted. TypeScript orchestration, Git admission, reveal timing, quota monitoring, freeze, and staging remain trusted. Fixture agents and submitted solver code remain untrusted and receive only their declared shard, released chapters, authenticated Git transport, their own workspace, and their own private output path. Oracle data, other shards, future chapters, credentials, host control surfaces, and peer-private submissions remain inaccessible.

**Failure Classification**: Invalid hypotheses, stale pushes, merge conflicts, duplicate work, budget exhaustion, missed pulls, and incomplete private deliverables are fixture-agent outcomes. Declared process faults before promotion are retryable trusted failures using fresh attempt identities. Ledger/ref/event disagreement, leakage, clock regression, incorrect accounting, failed freeze, replay mismatch, or undeclared output is an infrastructure integrity or validity failure and produces no passing completion report.

**Invalidation Path**: A generator or puzzle-policy change reruns Milestone 4 and every downstream offline result. A Git, lifecycle, reveal, isolation, or host-bridge change reruns Milestones 5–6. A grading, replay, solver, or reporting change reruns Milestone 6. Any later Gate C or D attempt must bind the exact passing Milestone 6 harness identity; a changed harness invalidates that empirical result.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST build one complete instance bundle from frozen inputs with public, private-shard, reference-corpus, reveal, difficulty, scoring, and sealed-oracle projections.
- **FR-002**: Every cross-runtime artifact MUST use a versioned schema, canonical bytes, exact byte length, SHA-256 digest, producer identity, immutable inputs, and a declared output set.
- **FR-003**: The runtime MUST preflight research-plane bundles without conversion-specific puzzle logic.
- **FR-004**: The system MUST launch exactly three isolated fixture agents through one common barrier and MUST NOT prescribe roles, turns, or a commit order.
- **FR-005**: Fixture agents MUST use the same host model bridge, compute-accounting, file, Git, deadline, and submission contracts as later live agents.
- **FR-006**: The fixture model adapter MUST be deterministic, local, network-independent, and incapable of making an external model call.
- **FR-007**: The reveal service MUST release complete chapter batches on one authoritative monotonic schedule independent of agent activity.
- **FR-008**: The collaboration surface MUST use ordinary authenticated Git and production `GitAccountingFrameV1` charging over accepted peer-visible logical state.
- **FR-009**: The Git Gateway MUST enforce ref namespaces, fast-forward policy, quarantine, object and path safety, rate limits, cumulative budgets, transactional reservations, and snapshot-gated fetch.
- **FR-010**: Publication MUST expose immutable fixed-slot snapshots and MUST never expose an intermediate ref map.
- **FR-011**: The run lifecycle MUST enforce launch, push deadline, bounded drain, freeze, pull-only finalization, output sealing, and terminal states without trusted repair of agent work.
- **FR-012**: The event service MUST append hash-chained, idempotent lifecycle, reveal, Git, quota, freeze, submission, and infrastructure events with explicit intent, effect, and completion semantics.
- **FR-013**: Private deliverables MUST remain outside the collaboration repository and inaccessible to peers.
- **FR-014**: The clean solver executor MUST validate hostile bundles before execution, stage only declared inputs, disable unsupported network access, and promote only exact declared outputs.
- **FR-015**: The grader MUST compute reconstruction, entity, dictionary, changed/stable, switch, latency, collaboration, and declared confidence metrics under one versioned scoring policy.
- **FR-016**: Replay MUST reconstruct every accepted ref/object state, published snapshot, visibility record, ledger total, event-chain head, freeze identity, solver result, score, and report from sealed artifacts.
- **FR-017**: The public report MUST redact seeds, source fingerprints, oracle mappings, private shards, future reveal metadata, exact private telemetry, credentials, and private submissions.
- **FR-018**: One root offline command MUST execute the complete build-to-report lifecycle and write one immutable completion report.
- **FR-019**: The completion report MUST state that deterministic fixture behavior proves implementation integration only and authorizes live Gate C/D evaluation without claiming model performance.
- **FR-020**: No command in this feature MAY invoke OpenAI or another external model provider.

### Key Entities

- **Instance Bundle**: The immutable public, private, reveal, scoring, and oracle artifact graph for one puzzle.
- **Run Manifest**: The frozen runtime, agent, policy, timing, budget, and artifact identity for one offline run.
- **Fixture Agent Policy**: Deterministic local behavior expressed through the production host model bridge.
- **Published Snapshot**: One immutable peer-visible Git ref map released at a fixed slot.
- **Push Ledger Entry**: The authenticated transaction, exact accounting frame, charge, reservation, and terminal admission result.
- **Run Event**: One hash-chained intent, effect, completion, or terminal state transition.
- **Freeze Snapshot**: The consistent final ref map, visibility journal, ledgers, and event-chain head.
- **Private Deliverable**: One sealed agent submission outside peer-visible Git.
- **Trusted Replay Bundle**: The exact immutable inputs required to reproduce trusted run state, solver execution, scoring, and reporting.
- **Offline Harness Completion Report**: The evidence and decision authorizing later live model validation.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Two builds from the same frozen request reproduce 100% of declared artifact bytes and digests.
- **SC-002**: One offline command reaches a terminal report through all ten stages: build, launch, reveal, collaborate, freeze, submit, clean execute, score, replay, and redact.
- **SC-003**: Exactly three fixture agents use native Git concurrently and all accepted and rejected operations reconcile to one ref map and per-agent ledger with zero unexplained bytes.
- **SC-004**: Every scheduled reveal and publication occurs atomically and exactly once in the recorded order, with zero intermediate snapshot exposure.
- **SC-005**: Failure injection at every declared lifecycle and promotion boundary yields either one recoverable state or an invalid run, never a mixed or success-shaped partial artifact.
- **SC-006**: The clean solver accepts one valid non-Python fixture and rejects 100% of the hostile bundle fixture matrix before privileged grading begins.
- **SC-007**: Independent replay reproduces every trusted state and all score and report digests with zero unresolved mismatch.
- **SC-008**: Automated visibility tests find zero oracle, future-shard, peer-private, credential, or host-control leakage across every agent and public projection.
- **SC-009**: A second offline run with the same frozen inputs leaves the first attempt byte-identical and produces a separately addressable, independently replayable attempt.
- **SC-010**: The complete offline lifecycle performs zero external model requests and succeeds with outbound model-provider access unavailable.

## Assumptions

- Gate A's frozen `GitAccountingFrameV1` and retained budget interval are the accounting inputs for the offline harness.
- The qualified Gate B unrecognized-literary profile is sufficient to build the production-shaped instance family; broader empirical claims remain deferred.
- The existing Gate C instance, reveal, solver-boundary, scoring, and replay modules are reusable components, not completed live-model evidence.
- One dedicated local host is the reference environment.
- Deterministic fixture agents may intentionally make mistakes, race, conflict, and submit partial work so long as the trusted runtime never repairs those outcomes.
- Container and service isolation may be implemented incrementally, but Milestone 6 cannot pass until the production trust boundaries are exercised rather than mocked away.
