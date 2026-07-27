# Feature Specification: Puzzle Architecture Refactor

**Feature Branch**: `009-refactor-puzzle-architecture` **Created**: 2026-07-27 **Status**: Ready for Planning **Input**: Refactor the active puzzle architecture into two clear runtime ownership boundaries and focused responsibilities while preserving puzzle behavior, the five-command operator workflow, deterministic mechanics, sandbox policy, and voluntary Git semantics. Treat private imports, stored records, and exact JSON result shapes as greenfield implementation details.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Operate the Same Puzzle After the Refactor (Priority: P1)

An experiment operator can use the same five puzzle commands, options, defaults, validation rules, and failure boundary after the internal architecture changes. Each command returns the minimum identity, path, status, score, or error data needed to continue the workflow. Fixed scientific inputs produce the same puzzle, reveal schedule, checker aggregates, reconstruction scores, and contractually ordered attempt observations.

**Why this priority**: This feature exists to improve maintainability and durability without changing the experiment an operator runs or the behavior agents experience.

**Independent Test**: Capture the current fixed-seed scientific outputs and minimum command results, run the same build, three-agent offline attempt, overlap observation, evaluation, and scoring flow after the refactor, and compare every declared deterministic outcome and command guarantee.

**Acceptance Scenarios**:

1. **Given** a valid invocation of any existing puzzle command, **When** an operator runs it after the refactor, **Then** the command accepts the same flags, defaults, and required flag relationships and emits one JSON result containing its declared minimum fields.
2. **Given** the same fixed scientific inputs, **When** an operator builds and scores the puzzle before and after the refactor, **Then** build identity, puzzle geometry, checker aggregates, reconstruction score, and contractual trace relationships are unchanged.
3. **Given** an invalid invocation or unavailable required infrastructure, **When** a command fails, **Then** it reports the same error classification through standard error and exits nonzero without emitting a success-shaped result.
4. **Given** an agent or reviewer command, **When** it runs inside the declared sandbox, **Then** identity, mounts, resource limits, network policy, output limits, and termination behavior remain unchanged.

---

### User Story 2 - Maintain One Compact Active Architecture (Priority: P2)

A maintainer can find the active operator application at the repository root and the deterministic puzzle distribution in its genuine runtime boundary. Each major responsibility has one clear owner, while the run coordinator and command dispatcher remain small lifecycle entrypoints rather than collections of unrelated behavior.

**Why this priority**: The current single-package workspace and two oversized runtime files add navigation and coupling without representing additional products or ownership boundaries.

**Independent Test**: Inspect the active source, package metadata, configuration, and dependency graph and verify that there is one root operator application, one deterministic puzzle distribution, no private single-package workspace, no deleted-layout compatibility facade, and no active module that still combines the responsibilities identified for separation.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** a maintainer traces an operator command, **Then** one thin dispatcher routes it to a focused build, run, evaluation, offline-fixture, or sandbox-preparation owner.
2. **Given** the run lifecycle, **When** a maintainer inspects its coordinator, **Then** reveal scheduling, provider construction, fixture behavior, overlap scanning, artifact decoding, and command execution are owned outside the coordinator.
3. **Given** the command sandbox, **When** a maintainer follows path validation, policy construction, image validation, and execution behavior, **Then** each concern has a distinct owner while all callers retain the same sandbox request, result, and identity contract.
4. **Given** the deterministic puzzle distribution, **When** a maintainer changes construction or evaluation behavior, **Then** puzzle construction, scoring, overlap observation, manifest data, and pure geometry have explicit ownership rather than a generic shared model.
5. **Given** the removed package and workspace layout, **When** active imports and configuration are inspected, **Then** no alias, manifest, barrel export, workspace declaration, or compatibility wrapper references that layout.

---

### User Story 3 - Retain a Durable Attempt When Observation Fails (Priority: P3)

An operator can inspect and evaluate a completed run even when optional post-run overlap observation fails. The frozen attempt summary exists before observation begins, identifies the completed run, and points to the same frozen work and trace that later evaluation uses.

**Why this priority**: Optional observation must not make a completed model run disappear or force an operator to reconstruct its evaluation inputs manually.

**Independent Test**: Complete a deterministic attempt, inject an overlap-observation failure immediately after freeze, and verify that the attempt summary and frozen inputs remain readable and that evaluation can still produce its declared result.

**Acceptance Scenarios**:

1. **Given** all sessions have ended and work has frozen, **When** post-run observation starts, **Then** the attempt summary already exists and can be decoded successfully.
2. **Given** overlap observation fails after freeze, **When** the run command returns, **Then** it exits nonzero, reports the observation failure through standard error, emits no success result or fabricated overlap artifact, and leaves the attempt summary, trace, frozen repository, and frozen workspaces intact.
3. **Given** a frozen attempt whose overlap observation failed, **When** an operator evaluates it, **Then** evaluation proceeds from the durable attempt summary without requiring a rerun.
4. **Given** malformed attempt, build, overlap, or evaluation data, **When** a command reads it, **Then** decoding fails with a specific infrastructure error rather than accepting partial or silently defaulted data.

---

### User Story 4 - Verify the Refactor Independent of Local Caches (Priority: P4)

A maintainer can verify the compact architecture from a clean or previously used checkout without ignored cache directories changing the result. Existing behavioral coverage remains, and new boundary-focused coverage protects the extracted responsibilities and durability rule.

**Why this priority**: Verification must report tracked repository structure and observable behavior, not incidental directories created by local tools.

**Independent Test**: Run the full verification suite with ignored cache directories both present and absent, then execute a fresh offline fixture and compare the declared golden outcomes.

**Acceptance Scenarios**:

1. **Given** ignored cache or empty generated directories in the checkout, **When** repository-boundary verification runs, **Then** it evaluates tracked paths and produces the same result as a clean checkout.
2. **Given** the refactored responsibilities, **When** focused tests run, **Then** current-version record decoding, fixture scenario validation, reveal scheduling, overlap failure, attempt durability, path containment, sandbox termination, image identity, and output limits are all exercised.
3. **Given** the implemented `collaborative-revision` fixture scenario, **When** it is selected, **Then** the offline attempt follows that scenario; when any unknown name is selected, the command fails explicitly.
4. **Given** the full offline acceptance flow, **When** it completes, **Then** build, three-agent run, overlap observation, evaluation, and scoring all succeed without an external model call.

### Edge Cases

- An operator supplies an unknown fixture scenario rather than `collaborative-revision`.
- Optional overlap observation fails immediately after the attempt freezes or after partially producing its own output.
- A build, attempt, overlap, trace, or evaluation record contains invalid JSON, a missing required field, an unexpected field type, or an unsupported value.
- The monotonic clock starts at zero, advances exactly to a reveal boundary, or is cancelled while a reveal is pending.
- The system wall clock changes while the monotonic reveal schedule is active.
- A sandbox path is absolute, contains traversal segments, resolves through a symbolic link, or names a non-regular file.
- A sandbox image is missing, mutable, mislabeled, or resolves to an identity different from the frozen attempt.
- A command times out, is cancelled, exceeds output limits, exits nonzero, or fails during container cleanup.
- Git contains no refs, multiple refs, deleted historical content, duplicate blobs, non-text blobs, or unusual paths during overlap observation.
- Ignored cache directories, bytecode caches, or empty generated directories exist in the checkout.

## Puzzle & Observation Boundaries _(mandatory)_

**Puzzle Behavior**: The feature preserves the existing three-agent word-substitution puzzle, six-stage private evidence, hidden partial re-key, fixed-seed construction, aggregate private checker, reviewer-selected execution, deterministic scoring, and all currently observable model choices. It changes maintainability and attempt durability, not the experiment.

**Agent Instructions & Tools**: Agents receive the same shared objective, peer context, private evidence, reference material, `run_command`, `check_reconstruction`, `wait_for_activity`, and ordinary shared Git. Roles, turns, branches, files, Git operations, checker cadence, and solve strategy remain agent-chosen and unenforced.

**Environmental Constraints**: Evidence visibility, monotonic reveal timing, token and wall-time cutoffs, sandbox identity, mount paths, network denial, secret isolation, host-safety limits, output limits, and reviewer execution boundaries remain unchanged.

**Observable Outcomes**: The same model responses, tool activity, session lifecycle, stage releases, checker aggregates, Git behavior, frozen work, raw overlap, reviewer selection, execution result, reconstruction score, unusual behavior, and resource termination remain retained. The refactored runner strictly validates the records it produces and can complete the fresh build-run-evaluate flow from those records; records from earlier implementations are not supported inputs.

**Infrastructure Failures**: Invalid configuration, unknown fixture scenarios, malformed stored records, path-containment violations, unavailable or mismatched sandbox images, launch or cleanup failures, trace corruption, and overlap-observer failures are explicit infrastructure failures. An overlap-observer failure after freeze does not erase the attempt summary or prevent evaluation from using the frozen attempt.

**Out-of-Scope Claims**: This feature does not change the proposal, puzzle difficulty, agent prompt, collaboration semantics, observable record meaning, or scoring policy. It does not preserve old stored records, exact pre-refactor JSON result shapes, or deleted private import paths; prescribe a model workflow; make model behavior reproducible; prove collaboration or belief revision; detect all covert sharing; or expand the existing standard sandbox into an adversarial security claim.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST preserve the `puzzle:sandbox:build`, `puzzle:build`, `puzzle:run`, `puzzle:evaluate`, and `puzzle:offline` operator command names, accepted flags, defaults, required flag relationships, one-object JSON success boundary, and nonzero standard-error failure boundary. Each command MUST return the minimum fields declared by the active operator contract and MAY return additional fields.
- **FR-002**: The system MUST preserve fixed-seed build identities, puzzle geometry, reconstruction scores, checker aggregates, reveal ordering, contiguous trace sequence numbers, nondecreasing elapsed time, per-agent release order, sessions-ended before freeze, freeze before overlap, and reviewer selection before evaluation.
- **FR-003**: Every build, trace, attempt, overlap, and evaluation record produced by the refactored runner MUST be strictly validated and consumable by the active commands that own the fresh build-run-evaluate flow. Records produced by earlier implementations need not decode.
- **FR-004**: The system MUST preserve sandbox request, result, and identity contracts together with mount paths, image validation, network policy, resource limits, output limits, termination behavior, and error classifications.
- **FR-005**: The system MUST preserve voluntary and unmetered Git use; no new required branch, commit, file, role, turn, checkpoint, or coordination sequence may be introduced.
- **FR-006**: The active repository MUST expose exactly two runtime ownership boundaries: one root operator application and one independently packaged deterministic puzzle distribution.
- **FR-007**: The active repository MUST NOT retain a private single-package workspace, an alias or barrel for the deleted package layout, or a compatibility facade for obsolete private import paths.
- **FR-008**: One command dispatcher MUST route the five operator commands without owning their domain behavior.
- **FR-009**: The run coordinator MUST be limited to lifecycle wiring; reveal scheduling, model-provider construction, offline fixture behavior, Git overlap observation, stored-record decoding, and command execution MUST have separate owners.
- **FR-010**: The system MUST use one model-session adapter contract named for the model boundary and one injected monotonic time source for reveal timing.
- **FR-011**: Unused supervision and configuration-parsing surfaces MUST be absent from the active runtime.
- **FR-012**: Sandbox policy contracts, workspace containment, image validation and argument construction, and container execution MUST have distinct ownership while using one trusted host-process behavior wherever lifecycle semantics are identical.
- **FR-013**: The deterministic puzzle distribution MUST separate puzzle construction from evaluation and MUST give manifest, scoring, and overlap data explicit ownership.
- **FR-014**: Shard and transition geometry MUST be independently testable without file access, process execution, or mutation of stored artifacts.
- **FR-015**: After an attempt freezes, the system MUST persist a complete `attempt.json` before starting optional overlap observation.
- **FR-016**: A post-freeze overlap-observation failure MUST leave the frozen attempt inspectable and evaluatable, exit nonzero, report the original infrastructure failure through standard error, emit no success result, and leave no fabricated `overlap.json`. The runner SHOULD append `overlap.failed` when the trace remains writable, but diagnostic failure MUST NOT replace the original observation error.
- **FR-017**: Every stored build, attempt, overlap, and evaluation record MUST be decoded and validated at its command boundary; malformed records MUST fail explicitly without partial defaults.
- **FR-018**: The offline fixture MUST explicitly accept `collaborative-revision` and MUST reject every unknown fixture scenario.
- **FR-019**: Repository-boundary verification MUST derive its result from tracked paths rather than unfiltered directory entries.
- **FR-020**: Existing coverage for sessions, reveal timing, Git activity, trace reopening, evaluation outcomes, path containment, sandbox termination, image identity, and output limits MUST remain active after relocation.
- **FR-021**: Focused regression coverage MUST include stored-record decoders, invalid fixture scenarios, post-freeze overlap failure, clock-controlled reveals, and attempt-summary durability.
- **FR-022**: Current architecture, roadmap, README, formatting inputs, runtime configuration, lock data, and repository guidance MUST describe only the new active layout and MUST remain mutually consistent.
- **FR-023**: Superseded specifications and generated experimental evidence MUST be removed from the working tree after their behavior is captured by the active specification and tests, while the proposal's puzzle meaning MUST remain unchanged.
- **FR-024**: Generated-only legacy package directories and bytecode caches MAY be removed only after confirming that no tracked or active source depends on them.
- **FR-025**: Legacy Gate, harness, replay, temporary evidence, and obsolete package directories MUST be absent from the final working tree and covered by current ignore rules where they are valid generated outputs.
- **FR-026**: Before active behavior is relocated, the system MUST capture fixed-seed build identities, puzzle geometry, reconstruction scores, checker aggregates, contractual trace relationships, and minimum operator results as scientific and command-contract golden cases.
- **FR-027**: The existing development-time version verification capability MUST remain available after the active runtime moves.

### Key Entities

- **Puzzle Build**: The deterministic result of source preparation, cipher construction, transition selection, shard geometry, staged evidence, complete ciphertext, and build identity.
- **Attempt Summary**: The durable post-freeze record connecting session outcomes, frozen repository and workspaces, trace locations, sandbox identity, and later observation and evaluation.
- **Observation Trace**: The ordered attempt chronology whose metadata and events preserve existing timing, sequencing, redaction, and field semantics.
- **Overlap Observation**: Optional post-run analysis of reachable Git text that remains observational and does not alter puzzle validity or scoring.
- **Evaluation Result**: The reviewer selection, execution outcome, reconstruction location, and deterministic score produced from a frozen attempt.
- **Sandbox Identity**: The immutable execution-image identity and effective command policy associated with an attempt.
- **Fixture Scenario**: A named deterministic model-behavior script used to exercise the complete puzzle path without an external model call.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For the captured fixed-seed golden cases, 100% of build identities, puzzle geometry, reconstruction scores, checker aggregates, and contractual trace relationships match the pre-refactor scientific baseline.
- **SC-002**: Contract tests for all five operator commands show zero changes to accepted flags, defaults, required flag relationships, one-object success output, minimum required fields, or nonzero standard-error failure behavior; additional success fields do not fail the contract.
- **SC-003**: A fresh refactored build, attempt, overlap result, and evaluation result all decode through the active current-version readers and complete the supported workflow without an artifact migration or compatibility wrapper.
- **SC-004**: In every injected post-freeze overlap-failure case, `attempt.json` is readable, all frozen inputs remain intact, and evaluation can complete without rerunning the model attempt.
- **SC-005**: The full retained verification suite passes with ignored cache directories both present and absent, including all 44 current operator/runtime cases and all 37 deterministic puzzle cases or their behaviorally equivalent reorganized cases.
- **SC-006**: Repository inspection finds exactly one active root operator application, one deterministic puzzle distribution, and zero active references to the deleted package workspace, alias, barrel, or nested distribution layout.
- **SC-007**: Focused ownership checks find zero active runtime files that still combine all identified sandbox concerns or all identified run-command concerns.
- **SC-008**: A fresh offline fixture completes build, three-agent run, overlap observation, evaluation, and scoring without an external model call and leaves every declared artifact readable.
- **SC-009**: The implemented fixture scenario succeeds in 100% of runs, while every tested unknown scenario fails before attempt execution with a specific error.
- **SC-010**: Architecture, roadmap, README, runtime guidance, configuration, and command help contain zero references to the deleted active layout and agree on the two retained runtime ownership boundaries.
- **SC-011**: Maintainers can trace any of the five operator commands from dispatch to its focused owner in no more than two transitions, while every variable external capability used by reveal timing or model sessions is replaceable in focused tests.

## Assumptions

- This is a greenfield internal refactor: obsolete private import paths, wrapper interfaces, exact JSON result key sets, and stored records from earlier implementations receive no compatibility layer.
- Existing record shapes may remain where they are already the simplest adequate representation, but no code, fixture, or test exists solely to preserve them.
- Git history remains the archive for superseded runner and hardening specifications; this feature carries their still-authoritative behavior into one active specification.
- `docs/proposal.md` remains semantically unchanged because the experiment, agent experience, and claim boundary do not change.
- The five retained commands are sandbox preparation, puzzle build, live run, evaluation, and deterministic offline fixture.
- The implemented offline scenario is `collaborative-revision`; no other fixture scenario is currently part of the supported operator contract.
- Generated-only legacy package directories and runtime bytecode caches may be removed after their contents are revalidated as non-source and untracked.
- Generated historical evidence is disposable once the active golden, focused tests, and fresh acceptance flow cover the retained behavior.
- Implementation planning will choose concrete file names and dependency edges while preserving the ownership outcomes, scientific behavior, command workflow, and current-version validation requirements stated here.
