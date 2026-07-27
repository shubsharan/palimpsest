# Feature Specification: Foundation and Evidence Protocol

| Field          | Value                                                 |
| -------------- | ----------------------------------------------------- |
| Feature branch | `001-foundation-evidence-protocol`                    |
| Created        | 2026-07-24                                            |
| Status         | Complete                                              |
| Evidence       | `artifacts/milestone-1/milestone-report.json`         |
| Input          | User description: "milestone 1 from @docs/roadmap.md" |

## User Scenarios & Testing _(mandatory)_

The users of this feature are the Palimpsest maintainers and, later, independent reviewers reproducing the published evidence. Milestone 1 has no agents, no puzzle, and no run lifecycle; its users are the people who must produce and trust the Gate A–D evidence built on top of it.

### User Story 1 - One contract, two runtimes, no disagreement (Priority: P1)

A maintainer defines a cross-runtime contract once, as a schema with an explicit version. Both the TypeScript side and the Python side read that same definition, so a payload that one side accepts is accepted by the other, and a payload one side rejects is rejected by the other for the same reason. When a maintainer changes a contract, the version changes with it, and older recorded artifacts continue to be read under the semantics they were written with.

**Why this priority**: Every later milestone exchanges data across the runtime boundary. A silent disagreement between the two sides would not surface as an error — it would surface as a wrong gate result months later. Nothing else in Milestone 1 is trustworthy without this, and this story alone already delivers value: the Gate A and Gate B teams can start designing their artifacts against a settled contract authority.

**Independent Test**: Take the shared fixture corpus, feed every valid and invalid fixture to each runtime's validator, and compare the two verdict lists. Delivers value as soon as both lists agree, with no other part of this feature built.

**Acceptance Scenarios**:

1. **Given** a fixture that satisfies a contract, **When** each runtime validates it, **Then** both accept it and both produce the same canonical byte representation and the same digest.
2. **Given** a fixture that violates a contract, **When** each runtime validates it, **Then** both reject it, and the rejection identifies the same offending field.
3. **Given** a fixture carrying a contract version the reader does not support, **When** either runtime reads it, **Then** the read fails explicitly rather than being interpreted under the reader's own version.
4. **Given** a fixture containing a field neither side declares, **When** either runtime validates it, **Then** the outcome is the same on both sides and is stated in the contract rather than left to each implementation.
5. **Given** a value outside the range both runtimes can carry without loss — a large seed, a high-precision integer — **When** it round-trips through both runtimes, **Then** the value returned is bit-for-bit the value supplied.
6. **Given** a multi-file artifact, **When** each runtime packages the same set of files, **Then** the two packages are byte-identical and have the same digest.

---

### User Story 2 - A result is either complete and provable, or it does not exist (Priority: P2)

A maintainer asks the trusted research side to produce a result. The work either finishes and yields a result that names every file it produced, with a size and digest for each, bound to the exact inputs, producer version, and environment that made it — or it fails, and leaves behind nothing that could be mistaken for a result. A partially written, truncated, timed-out, or hash-mismatched output never becomes evidence. Retrying does not reuse scavenged pieces of the failed attempt; it starts again from the same immutable request, and the failed attempt stays on the record.

**Why this priority**: This is the property that makes gate evidence mean anything. A half-written artifact that looks successful is worse than a loud failure, because it is citable. Ranked below P1 only because it consumes the contracts P1 defines.

**Independent Test**: Run a reference producer that is deliberately made to fail in each declared way, and confirm that after every failure the output location contains no promoted artifact and the failure is recorded. Then run the honest path twice from the same request and confirm identical bytes and digests.

**Acceptance Scenarios**:

1. **Given** a frozen request, **When** it is run twice in the same supported environment, **Then** both runs promote artifacts with identical bytes and identical digests.
2. **Given** a producer that exceeds its deadline, **When** the deadline passes, **Then** the work is terminated, no artifact is promoted, and the timeout is recorded as a failed attempt.
3. **Given** a producer that exits with a failure status, **When** the run ends, **Then** no artifact is promoted regardless of what files it left behind.
4. **Given** a producer whose progress stream is malformed or ends mid-record, **When** the run ends, **Then** no artifact is promoted.
5. **Given** a producer that declares a file it did not write, **When** the result is checked, **Then** no artifact is promoted.
6. **Given** a producer that writes a file it did not declare, **When** the result is checked, **Then** no artifact is promoted.
7. **Given** a producer whose declared digest or byte length does not match the file it wrote, **When** the result is checked, **Then** no artifact is promoted.
8. **Given** a producer whose version is not in the allowed set for the request, **When** the result is checked, **Then** no artifact is promoted.
9. **Given** any failed attempt, **When** the request is retried, **Then** the retry uses the same immutable request and a clean output location, and cannot inherit any file from the failed attempt.
10. **Given** a promoted artifact, **When** a reviewer inspects it, **Then** it names its immutable inputs, its producer version, its environment, its exact output set, and a size and digest for every output.

---

### User Story 3 - One command, clean checkout, same answer (Priority: P3)

A reviewer clones the repository at a given revision on a supported machine and runs a single verification command. It exercises both the TypeScript and the Python sides, using only the pinned dependency versions recorded in the repository, and reports pass or fail. The two dependency sets stay separate — neither side's packages are resolved through the other's.

**Why this priority**: Reproducibility by an outside party is a release requirement, and the command is the enforcement point for everything above. Ranked third because P1 and P2 define what it verifies.

**Independent Test**: From a fresh clone with no warm caches and no network access beyond the pinned dependency sources, run the single command and confirm it completes successfully.

**Acceptance Scenarios**:

1. **Given** a clean checkout on a supported environment, **When** the verification command runs, **Then** it succeeds using only pinned dependencies and inputs.
2. **Given** a change that breaks contract agreement or artifact promotion, **When** the verification command runs, **Then** it fails and names the broken property.
3. **Given** the verification command, **When** it resolves dependencies, **Then** the TypeScript and Python dependency sets remain independent, each with its own lock record.
4. **Given** an unsupported runtime version, **When** the verification command runs, **Then** it refuses to run rather than producing a result under an unpinned environment.

---

### User Story 4 - A gate result that was decided before the run (Priority: P4)

Before running an experiment that a gate depends on, a maintainer records the question, the inputs that are frozen for it, the thresholds that will decide it, and what a pass, a rework, and a stop each mean. After the run, the same record carries the raw artifact references, the analysis, the result, and the follow-up decision. A reviewer reading the record can see that the thresholds were fixed before the result was known, and can retrieve the exact artifacts the conclusion rests on.

**Why this priority**: Gates A–D produce their reports in this format, so it must exist before Milestone 2 starts. Ranked last within Milestone 1 because it depends on the contract and artifact machinery above and blocks no other Milestone 1 work.

**Independent Test**: Author a gate report for a hypothetical gate, declare its thresholds, then complete it with results, and confirm the format enforces that thresholds and frozen inputs are present and unchanged between the two states.

**Acceptance Scenarios**:

1. **Given** a gate report in its pre-run state, **When** it is validated, **Then** the question, frozen inputs, declared thresholds, and pass/rework/stop criteria must all be present, and the result must be absent.
2. **Given** a completed gate report, **When** it is validated, **Then** it carries raw artifact references, environment and producer versions, analysis, result, and follow-up decision.
3. **Given** a completed gate report, **When** a threshold differs from the one recorded before the run, **Then** the change is detectable rather than silent.
4. **Given** a gate report's referenced artifacts, **When** a reviewer resolves them, **Then** each reference identifies a specific artifact by digest, not by mutable location alone.

---

### Edge Cases

- A payload declares a version the reader does not know: rejected explicitly, never coerced.
- A payload carries a field neither contract declares: both runtimes reach the same verdict under a stated rule.
- A seed or integer exceeds the range one runtime can represent without loss: carried as a string form defined by the contract, never as a lossy numeric.
- A payload contains a non-finite numeric value: rejected by both runtimes.
- Two textually different but Unicode-equivalent strings, or two paths differing only by case: the contract states which is canonical, and both runtimes agree.
- An archive contains an overlong path, an absolute path, a parent-directory reference, a duplicate path, or a non-regular entry: rejected.
- An archive contains zero files, or the maximum declared number of files: both are valid and round-trip identically.
- Two runs package the same files in a different order, or on machines with different local time and user identity: the packaged bytes are identical.
- A producer's progress stream contains a duplicate record, or the stream ends without a terminating record: no artifact is promoted.
- A producer's deadline expires while it is mid-write: the partial file is discarded with the rest of the failed attempt.
- A producer succeeds but the output location already contains files from an earlier attempt: cannot occur — each attempt receives an empty location, and this is verified rather than assumed.
- Available disk is exhausted during promotion: classified as a failed attempt, with no partially promoted artifact left behind.
- A gate report is completed without its declared thresholds ever having been recorded: rejected as malformed.

## Evidence & Trust Boundaries _(mandatory)_

**Owning Gate/Milestone**: Roadmap Milestone 1, "Foundation and evidence protocol". It answers no empirical question of its own; it establishes the cross-language boundary and evidence protocol that Gates A–D (Milestones 2–5) record their results in. Its exit decision is "proceed to feasibility work".

**Minimum Scope**: Milestone 1 builds the least machinery that lets a gate produce evidence a reviewer can check, and no more.

- Only the five contracts the roadmap's contract-readiness table assigns to Milestone 1 are defined: the shared schema/version envelope, canonical JSON, canonical archive, artifact response manifest, and gate report. Domain contracts (`GitAccountingFrameV1`, `InstanceBuildRequest`, `RunManifest`, and the rest) belong to the milestones that first need them.
- The trusted subprocess boundary is built generically, together with a minimal, domain-free reference producer whose only purpose is to exercise the honest path and every declared failure mode. Without a producer, the roadmap's failure-mode evidence cannot be demonstrated; with a domain-bearing producer, Milestone 1 would be pre-building Milestone 6. No corpus, generation, cipher, baseline, or grading logic is written.
- Only the workspace packages Milestone 1 needs are created: the contracts package, the Python research project, and the root verification surface. The operator CLI, control plane, Git gateway, accounting meter, agent scaffold, and container definitions are created by their owning milestones.

**Predeclared Evidence**:

_Frozen inputs_: the fixture corpus for every Milestone 1 contract, including both accepted and rejected cases; the reference producer's requests; the pinned versions of Node, Python, their package managers, and Git recorded in the repository.

_Thresholds_: Milestone 1 is a foundation milestone with binary criteria, not calibrated numeric ones. Every stated property must hold completely; there is no tolerance band and no partial pass. Any numeric limit that appears in a contract (maximum path length, maximum entry count, deadline) is declared in the contract before use, not chosen after observing a failure.

_Required artifacts_: the contract definitions with their versions; the fixture corpus; the recorded verdict lists from both runtimes; the digests of artifacts promoted by repeated runs of a frozen request; the record of every injected failure mode and its outcome; the verification command's output from a clean checkout.

_Verification categories_ (roadmap verification map, row 1): cross-language contracts, canonicalization, and deterministic artifact promotion, as detailed in architecture §13.3.

_Pass_: every property in Success Criteria holds. _Rework_: any contract disagreement, canonicalization mismatch, non-reproducible promotion, or unpinned dependency — fix and re-verify. _Stop_: does not apply; Milestone 1 has no empirical premise that evidence can reject.

**Trust & Visibility Impact**: No oracle data, private shard, agent environment, corpus, or public artifact exists yet, so no existing boundary is crossed or widened. This feature establishes two boundaries that later milestones inherit: the trusted research side runs without network access and is never agent-facing, and no trusted generation or grading code may be installed into an agent-facing package or image. The reference producer is domain-free and holds no secret. Milestone 1 introduces no credential, no mount, and no network path. It creates no public artifact, so there is nothing to redact.

**Failure Classification**: Every failure in Milestone 1 is a blocking foundation defect, not a gate result and not an agent outcome. Contract disagreement between the runtimes, a canonicalization mismatch, a non-reproducible promotion, a success-shaped artifact surviving an injected failure, or an unpinned dependency each block progress to Milestone 2 until fixed. Failures of the reference producer are expected inputs to the evidence, not defects: the producer exists to fail in declared ways.

**Invalidation Path**: There is no upstream gate to rerun. Downstream, every Milestone 1 contract is load-bearing for Gates A–D, so a change to one after evidence has been recorded requires a new contract version or an explicit migration, and invalidates every fixture, promoted artifact, and gate report written under the previous version. Replay must never interpret an older artifact under newer semantics. A defect discovered in the promotion path after a gate has run invalidates that gate's evidence, because its artifacts can no longer be shown to be complete.

## Requirements _(mandatory)_

### Functional Requirements

**Contract authority and versioning**

- **FR-001**: Schema definitions MUST be the single authority for every cross-runtime contract; the TypeScript and Python representations MUST be derived from or validated against those definitions, and neither runtime may hold an independently authored definition of the same contract.
- **FR-002**: Every contract MUST carry an explicit integer version, and every instance MUST declare the version it was written under.
- **FR-003**: Reading an instance whose declared version is not supported by the reader MUST fail explicitly; the reader MUST NOT apply its own version's semantics to it.
- **FR-004**: Milestone 1 MUST define exactly these contracts: the shared schema/version envelope, canonical JSON rules, canonical archive rules, the artifact response manifest, and the gate report. It MUST NOT define contracts assigned to later milestones.
- **FR-005**: Each contract MUST state its handling of fields it does not declare, and both runtimes MUST implement that stated handling identically.

**Canonical representation**

- **FR-006**: The system MUST define one canonical byte representation for a validated payload, such that both runtimes produce identical bytes for the same logical value.
- **FR-007**: Values that cannot be carried across both runtimes without loss — including seeds and integers outside the interoperable numeric range — MUST be represented in a form the contract defines, and MUST round-trip without change.
- **FR-008**: Non-finite numeric values MUST be rejected by both runtimes.
- **FR-009**: A line-delimited record stream MUST consist of one canonical payload per line, with a defined terminator, so that a truncated stream is detectable.
- **FR-010**: The system MUST define one canonical packaging format for multi-file artifacts that removes every source of incidental byte variation, including entry order, timestamps, ownership, and mode variation, so that the same file set always packages to the same bytes.
- **FR-011**: The canonical packaging format MUST reject unsafe or ambiguous entries, including absolute paths, parent-directory references, overlong paths, duplicate paths, colliding paths, and entries that are not regular files or directories.
- **FR-012**: Artifacts MUST be identified by a cryptographic content digest that is independent of any storage or repository representation.
- **FR-013**: The exact canonical bytes for each contract MUST be recorded as fixtures that both runtimes are checked against.

**Artifact production and promotion**

- **FR-014**: A production request MUST name its immutable inputs and MUST be given an empty output location; the request MUST be reusable unchanged for a retry.
- **FR-015**: Every production attempt MUST have a deadline, and exceeding it MUST terminate the attempt without promoting anything.
- **FR-016**: A result MUST be accompanied by a manifest declaring every output file with its content digest, byte length, the producer version, the immutable inputs, and the environment; the declared output set MUST be exact.
- **FR-017**: An artifact MUST be promoted only when all of the following hold: the producer finished successfully, its progress stream is complete and well-formed, the file set on disk exactly matches the declared set with no missing and no undeclared files, every declared digest and byte length matches the file written, and the producer version is allowed for the request.
- **FR-018**: Promotion MUST be atomic: an observer MUST see either no artifact or the complete artifact, never a partial one.
- **FR-019**: When any promotion condition fails, the system MUST promote nothing, MUST leave no success-shaped output behind, and MUST record the failed attempt.
- **FR-020**: A retry MUST use a fresh empty output location and the same immutable request, and MUST NOT be able to reuse any file produced by a failed attempt.
- **FR-021**: The same frozen request run repeatedly in the same supported environment MUST produce byte-identical and digest-identical promoted artifacts.
- **FR-022**: The trusted research side MUST run without network access and MUST NOT be reachable by any agent-facing component.

**Workspace and verification**

- **FR-023**: The repository MUST establish the directory boundaries the architecture assigns to Milestone 1's components, and MUST NOT place trusted generation or grading code in any agent-facing package.
- **FR-024**: The TypeScript and Python dependency graphs MUST remain independent, each with its own lock record; neither may be resolved through the other.
- **FR-025**: A single root verification command MUST invoke both ecosystems' checks and report one overall result.
- **FR-026**: The verification command MUST succeed from a clean checkout using only pinned dependencies and inputs, and MUST refuse to run on an unsupported runtime version rather than producing a result under an unpinned environment.
- **FR-027**: Every runtime, package manager, and tool version that affects evidence MUST be pinned in the repository.
- **FR-028**: A minimal, domain-free reference producer MUST exist that can be driven through the successful path and through each declared failure mode, so that FR-017 through FR-021 are demonstrable end to end. It MUST contain no corpus, generation, cipher, baseline, or grading logic.

**Gate report**

- **FR-029**: The gate report format MUST require, before the judged run, the gate's question or hypothesis, its frozen inputs, its declared thresholds, and its pass, rework, and stop criteria.
- **FR-030**: The gate report format MUST require, after the run, references to the raw artifacts by digest, the environment and producer versions, the analysis, the result, and the follow-up decision.
- **FR-031**: A gate report MUST make a post-run change to a predeclared threshold or frozen input detectable rather than silent.
- **FR-032**: The gate report format MUST be versioned like every other contract, and MUST be validated by both runtimes.

### Key Entities

- **Contract definition**: The authoritative, versioned description of one cross-runtime data shape, including its accepted values, its rejected values, and its handling of undeclared fields. Both runtimes' representations derive from it.
- **Fixture**: A recorded instance of a contract paired with its expected verdict — accepted with known canonical bytes and digest, or rejected for a stated reason. The shared evidence that the two runtimes agree.
- **Production request**: An immutable statement of what to produce: the inputs it may read, the empty location it may write to, its deadline, and the producer versions allowed to satisfy it. Reusable unchanged for a retry.
- **Artifact manifest**: The declaration accompanying a result — the exact output set, each output's digest and byte length, the producer version, the immutable inputs, and the environment. Relates a promoted artifact to everything needed to reproduce and trust it.
- **Promoted artifact**: A result that satisfied every promotion condition. Immutable, digest-addressed, and citable as evidence. Its absence is the only alternative; there is no partial state.
- **Failed attempt record**: The record of a production attempt that did not promote, naming which condition failed. Retained so that retries are visible rather than hidden.
- **Gate report**: The versioned record of one empirical gate, spanning the pre-run declaration and the post-run result, and referencing its raw artifacts by digest.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For 100% of fixtures in the shared corpus, the TypeScript and Python verdicts agree — every fixture accepted by one is accepted by the other, and every fixture rejected by one is rejected by the other for the same declared reason. Zero disagreements.
- **SC-002**: The fixture corpus covers every declared boundary category — large seeds, Unicode strings, path forms, numeric limits, digests, undeclared fields, and version changes — with at least one accepted and one rejected case per category, and no category is uncovered.
- **SC-003**: For 100% of accepted fixtures, both runtimes produce identical canonical bytes and identical digests.
- **SC-004**: A frozen request repeated in the pinned supported environment produces byte-identical and digest-identical promoted artifacts across repeated runs, with zero differing bytes.
- **SC-005**: Across every declared failure mode — deadline exceeded, producer failure, malformed progress, truncated progress, missing declared output, undeclared output, digest mismatch, byte-length mismatch, and disallowed producer version — zero success-shaped artifacts are promoted, and 100% of the attempts are recorded as failures.
- **SC-006**: After any failed attempt, a retry from the same request begins with an empty output location, and zero files from the failed attempt appear in the retry's result.
- **SC-007**: The single verification command succeeds from a clean checkout on a supported environment using only pinned dependencies and inputs, with zero unpinned or network-resolved dependencies.
- **SC-008**: The TypeScript and Python dependency records remain fully independent, with zero packages resolved across the boundary.
- **SC-009**: A gate report cannot reach a completed state without its pre-run question, frozen inputs, declared thresholds, and pass/rework/stop criteria present; every artifact it cites resolves by digest — 100% of citations resolvable; and a post-run alteration of a predeclared threshold or frozen input is detected in 100% of injected cases.
- **SC-010**: A reviewer starting from a clean checkout and the repository's own instructions can reproduce the full verification result without consulting a maintainer.
- **SC-011**: Zero trusted generation or grading code is present in any agent-facing package.
- **SC-012**: Every production attempt completes with network access unavailable — zero attempts require a network call, and results are identical with the network disabled.

## Assumptions

- Milestone 1 predates every empirical gate, so its criteria are binary rather than calibrated. No numeric threshold in this specification is a calibrated parameter, and none should be read as one.
- Gate reports are stored as validated canonical artifacts; a human-readable rendering of a report is a presentation of that artifact, not a second source of truth.
- The specific pinned versions of Node, Python, their package managers, and Git are an implementation decision recorded in the plan and in the repository's pin files, not in this specification.
- The reference producer exists only to exercise the boundary. It is expected to be replaced, not extended, when the first real producer arrives in Milestone 6.
- Contract instances are exchanged as files and as line-delimited streams; no network protocol is introduced at this milestone.
- "Supported environment" means the pinned runtime versions on the reference single-host deployment described in the architecture. Reproducibility on unpinned or unsupported environments is not claimed.
- The two scope boundaries in this specification — building the subprocess boundary with a domain-free reference producer, and creating only the Milestone 1 workspace packages — were confirmed with the maintainer before drafting.
