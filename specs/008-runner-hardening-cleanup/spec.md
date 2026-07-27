# Feature Specification: Runner Hardening and Greenfield Cleanup

**Feature Branch**: `008-runner-hardening-cleanup` **Created**: 2026-07-27 **Status**: Ready for Implementation **Input**: User description: "Implement the approved runner hardening and greenfield cleanup plan using the Spec Kit workflow and subagents."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Run Without Host Exposure (Priority: P1)

As an experiment operator, I can let agents and a selected reconstruction command use ordinary shell and Git tools without exposing host files, peer-private evidence, oracle data, provider credentials, or public network access.

**Why this priority**: The current host-shell executor can read material outside the intended puzzle workspace. That makes every attempted run unsafe to operate and weakens the meaning of the visibility boundary.

**Independent Test**: Run the deterministic fixture with host, peer, oracle, credential, and network sentinels present. The agents must still be able to edit their workspaces and collaborate through shared Git, while every undeclared surface remains unavailable.

**Acceptance Scenarios**:

1. **Given** three concurrent agents with separate evidence directories, **When** each agent executes arbitrary shell commands, **Then** it can access only its workspace, its released evidence, the public reference corpus, the shared Git repository, and disposable temporary storage.
2. **Given** provider credentials and puzzle oracle files on the host, **When** an agent inspects its files and environment, **Then** neither the credentials nor oracle data are present.
3. **Given** a frozen agent workspace and public ciphertext, **When** the reviewer executes the selected reconstruction command, **Then** the command can produce a candidate but cannot access the oracle, peer evidence, host files, or the public network.
4. **Given** a candidate or selected output path that escapes through a symbolic link, **When** the checker or evaluator validates it, **Then** the operation fails explicitly as an infrastructure boundary error.

---

### User Story 2 - Inspect a Truthful Attempt Record (Priority: P2)

As an experiment reviewer, I can read one chronological trace and one raw-overlap observation that include post-run work and every text blob reachable through the team's shared Git history.

**Why this priority**: Reset timestamps and branch-tip-only scans can misstate when evaluation occurred and can omit content that agents committed and later deleted.

**Independent Test**: Complete a fixture run, commit and delete a unique text fragment before the final tip, append overlap and evaluation events, and verify that the fragment is observed and the entire trace remains strictly sequenced with nondecreasing elapsed times.

**Acceptance Scenarios**:

1. **Given** a completed run trace, **When** overlap and evaluation append later events, **Then** every event has a strictly increasing sequence and a nondecreasing elapsed time.
2. **Given** a text blob committed and later deleted from the branch tip, **When** raw overlap is measured, **Then** the blob remains part of the observed reachable history.
3. **Given** duplicate or non-text Git objects, **When** history is scanned, **Then** duplicate text is processed once, non-text content is skipped, and the scan counts disclose both decisions.
4. **Given** malformed or out-of-order trace records, **When** a later process attempts to append, **Then** it refuses to extend the trace and reports an infrastructure error.

---

### User Story 3 - Work in the Current Runner Only (Priority: P3)

As a maintainer, I can understand, verify, and change Palimpsest through a compact active runner without navigating superseded Gate-era packages, tests, dependencies, specifications, or tracked run artifacts.

**Why this priority**: The repository still verifies and ships disconnected infrastructure whose policies conflict with the behavior-neutral runner and obscure the actual product boundary.

**Independent Test**: From a clean checkout, inspect the package graph and run the full verification suite. Only the active puzzle runner and its required Python mechanics remain, current commands still work, and no obsolete namespace is imported or verified.

**Acceptance Scenarios**:

1. **Given** the cleaned repository, **When** a maintainer searches active code and configuration, **Then** Git accounting, Git gateway, run control, Gate execution, replay, artifact promotion, and cross-runtime contract comparison are absent.
2. **Given** fixed puzzle inputs, **When** the puzzle is built after source relocation, **Then** deterministic build and scoring behavior is unchanged.
3. **Given** the repository history, **When** historical implementation detail is needed, **Then** it remains available through Git without being retained in the active tree.
4. **Given** current project guidance, **When** a maintainer follows it, **Then** it references only the behavior-neutral runner, its current safety boundary, and the retained current feature record.

### Edge Cases

- The container image is missing, stale, or cannot be inspected before a run.
- Docker exits before starting the requested command or is terminated by timeout or cancellation.
- A workspace contains an absolute or relative symbolic link aimed outside an allowed mount.
- The system clock moves backward between the run process and a later evaluation process.
- Git history contains tags, multiple refs, duplicate blobs, binary blobs, unusual paths, or a file deleted from every current tree.
- A generated artifact directory already exists or contains prior output.
- Cleanup accidentally removes a helper or corpus source that the active puzzle still imports.

## Puzzle & Observation Boundaries _(mandatory)_

**Puzzle Behavior**: The feature preserves the existing deterministic three-agent decipherment puzzle, staged private evidence, partial re-keying, aggregate checker, voluntary shared Git collaboration, frozen review selection, raw overlap observation, and deterministic scoring.

**Agent Instructions & Tools**: Agents receive the same shared objective, peer context, `run_command`, `check_reconstruction`, and `wait_for_activity` tools. They may use or ignore Git, choose any workflow, and produce any files or response. The feature changes only where commands execute and which environmental surfaces are visible.

**Environmental Constraints**: Each agent sees only its workspace, released private evidence, the public reference corpus, shared Git, and disposable temporary storage. Reviewer execution sees only the selected frozen workspace, public ciphertext, frozen Git data, and temporary storage. Wall-time and token cutoffs remain unchanged. Provider credentials, host files, peer evidence, oracle data, and public network access are unavailable.

**Observable Outcomes**: Reconstruction scores, tool activity, session state, Git ref changes, checker responses, reviewer selection, execution results, raw overlap, unusual collaboration choices, failed solutions, and resource termination remain observable. Sandbox limits protect the host but do not change scores or invalidate model behavior.

**Infrastructure Failures**: Missing or stale sandbox images, unavailable container execution, malformed traces, inaccessible declared mounts, sandbox launch failures, and escaped candidate/output paths prevent the affected command or evaluation and are reported explicitly. Incorrect commands, nonzero agent-created programs, absent output, and unconventional Git use remain observable outcomes under existing semantics.

**Out-of-Scope Claims**: This feature does not claim adversarial containment, red-team coverage, exact process replay, deterministic model behavior, complete covert-channel detection, construct validity, benchmark validity, or proof that collaboration caused an outcome.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Every agent shell command MUST execute without access to undeclared host paths, peer-private evidence, oracle material, provider credentials, or public network access.
- **FR-002**: Agent commands MUST retain read-write access to their own persistent workspace and ordinary read-write collaboration through the shared Git repository.
- **FR-003**: Agent commands MUST receive only their released private evidence and the public reference corpus as read-only inputs.
- **FR-004**: Reviewer-selected commands MUST execute independently from agent commands with only the selected frozen workspace, public ciphertext, and frozen Git data available.
- **FR-005**: Candidate and evaluator output paths MUST resolve to regular files inside their declared workspace without symbolic-link escape.
- **FR-006**: Sandbox absence, staleness, or launch/cleanup failure MUST produce explicit infrastructure failures, while command timeout, cancellation, resource termination, and output overflow MUST produce explicit command or host-safety outcomes without success-shaped fallback.
- **FR-007**: Attempt records MUST identify the exact sandbox image and operational limits used without treating those limits as puzzle validity criteria.
- **FR-008**: All live, overlap, and evaluation trace events MUST use one validation and redaction path with strictly increasing sequence numbers and nondecreasing elapsed times.
- **FR-009**: A later process MUST refuse to append to a malformed, nonsequential, or time-regressing trace.
- **FR-010**: Raw-overlap collection MUST inspect each unique text blob reachable from current Git refs, including blobs absent from current branch tips.
- **FR-011**: Raw-overlap output MUST report counts for reachable objects, reachable blob references, unique text blobs, repeated tree references, and skipped non-text blobs without blocking or altering the score.
- **FR-012**: The active puzzle build, run, evaluate, and offline operator commands MUST retain their current user-visible purpose and deterministic mechanics.
- **FR-013**: Superseded Gate-era implementation, verification, dependencies, tracked run artifacts, and specifications 001 through 005 MUST be removed from the active tree without compatibility shims.
- **FR-014**: The three corpus files used by the active puzzle and their provenance MUST move to a neutral fixture location while preserving their exact bytes and deterministic build behavior.
- **FR-015**: Current documentation and repository guidance MUST describe only the active behavior-neutral runner and MUST retain feature record 006 unchanged.
- **FR-016**: Full verification MUST cover deterministic mechanics, sandbox visibility, optional Git collaboration, trace chronology, raw-overlap completeness, checker disclosure, resource cutoffs, and absence of prescribed workflow.

### Key Entities

- **Sandbox Execution**: One requested command, its declared mounts, working directory, allowlisted environment, safety limits, immutable image identity, termination status, and captured output.
- **Observation Trace**: A clock origin plus ordered, redacted attempt events identified by sequence and elapsed time.
- **Overlap Inventory**: The deduplicated set of reachable text blobs and counts describing accepted, duplicate, and skipped Git objects.
- **Attempt Record**: The run summary that connects sessions, frozen Git state, trace, overlap observation, sandbox identity, and later evaluation.
- **Corpus Fixture**: One exact public-domain source file plus retained acquisition provenance used for puzzle or reference generation.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In the deterministic containment fixture, 100% of declared workspace, evidence, reference, ciphertext, and Git accesses succeed, while 100% of host, peer, oracle, credential, and public-network probes fail.
- **SC-002**: Across a complete build-run-overlap-evaluate fixture, every adjacent trace pair has a sequence increment of exactly one and an elapsed time greater than or equal to its predecessor.
- **SC-003**: A unique text fragment committed and later deleted is present in raw-overlap input in every regression run, while identical blobs are processed once and repeated reachable tree references are counted.
- **SC-004**: Fixed scientific inputs produce the same build identifier, puzzle geometry, checker disclosure, and score before and after corpus relocation.
- **SC-005**: A clean repository verification has zero active imports, scripts, aliases, or tests referencing the removed Gate-era packages and policies.
- **SC-006**: The active implementation and locked dependency graph contain no runtime dependency used solely by removed subsystems.
- **SC-007**: A fresh offline build-run-evaluate fixture completes without an external model call and retains enough trace and attempt data to explain its score and termination.

## Assumptions

- Docker is available to operators as a required local runtime dependency for untrusted command execution.
- Standard container isolation is a host-safety boundary, not an adversarial security or puzzle-validity claim.
- Current Git refs define overlap reachability; reflog-only and unreachable garbage objects are outside the observation.
- Historical implementation and specifications remain recoverable from Git history.
- `specs/006-behavior-neutral-runner` and every 006-named branch remain unchanged.
- The recovery branch remains untouched because its unmerged contents have not been classified as safe to delete.
