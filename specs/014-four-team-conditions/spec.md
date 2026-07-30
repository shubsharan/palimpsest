# Feature Specification: Four Team Conditions

**Feature Branch**: `feature/014-four-team-conditions` **Created**: 2026-07-28 **Status**: Draft **Input**: Add canonical shared/isolated communication conditions crossed with stationary/re-key puzzle variants while preserving identical non-treatment inputs and behavior-neutral team instructions.

## User Scenarios & Testing

### User Story 1 - Select One Canonical Condition (Priority: P1)

As a researcher, I can run a named `CS`, `CR`, `IS`, or `IR` condition and know that its communication mode and key regime are derived from that identifier rather than assembled inconsistently.

**Why this priority**: The condition token is the experimental treatment boundary and must resolve to exactly one communication surface and one paired puzzle variant.

**Independent Test**: Resolve every canonical token and reject aliases, case variants, unknown tokens, and arbitrary communication/key combinations.

**Acceptance Scenarios**:

1. **Given** `CS`, **When** it is resolved, **Then** agents share one Git repository and receive the stationary puzzle variant.
2. **Given** `CR`, **When** it is resolved, **Then** agents share one Git repository and receive the re-key puzzle variant.
3. **Given** `IS` or `IR`, **When** it is resolved, **Then** each agent receives an independent Git repository and the corresponding stationary or re-key variant.
4. **Given** any non-canonical identifier or separately supplied treatment component, **When** validation runs, **Then** the attempt is rejected before execution.

---

### User Story 2 - Preserve or Remove Peer Communication (Priority: P2)

As a researcher, I can compare shared and isolated conditions knowing that shared agents can use ordinary peer Git activity while isolated agents retain usable Git without seeing peer repositories, commits, refs, evidence, or activity.

**Why this priority**: Communication availability is the only intended difference within a stationary or re-key condition pair.

**Independent Test**: Run fixture agents against shared and isolated Git environments, publish distinct commits, and prove peer visibility only in the shared environment while every agent can use its own repository.

**Acceptance Scenarios**:

1. **Given** a shared condition, **When** one agent pushes a commit, **Then** peers can fetch it and receive shared Git activity.
2. **Given** an isolated condition, **When** one agent pushes a commit, **Then** only that agent's repository changes and no peer receives the repository, ref, content, or activity.
3. **Given** either communication mode, **When** agents choose not to use Git or work independently, **Then** the attempt continues and records that behavior without penalty.
4. **Given** a completed attempt, **When** it is frozen, **Then** every repository and workspace that existed in that condition is preserved without merging.

---

### User Story 3 - Hold the Puzzle Experience Constant (Priority: P3)

As a researcher, I can inspect condition prompts, schedules, traces, and attempt records to verify that paired conditions differ only in communication availability or key regime as declared.

**Why this priority**: Comparisons are useful only when team identity, private evidence, schedule, tools, limits, references, and evaluation boundary remain stable across conditions.

**Independent Test**: Snapshot all four prompts and provider-free fake-clock traces, compare their invariant sections, and verify exact releases at 0, 5, 10, 20, 30, and 40 minutes with a 60-minute cutoff.

**Acceptance Scenarios**:

1. **Given** all four prompts, **When** they are compared, **Then** only the communication-channel paragraph differs between shared and isolated modes and no prompt reveals the key regime.
2. **Given** any condition, **When** fake time advances, **Then** the six private stages release at the declared offsets and the attempt stops at the declared cutoff.
3. **Given** a completed attempt, **When** its durable records are decoded, **Then** they identify the block, condition, derived communication mode and key regime, exact schedule, usage, termination, sandbox, sessions, and frozen Git topology.
4. **Given** an explicitly selected workspace, **When** evaluation runs, **Then** it uses only that workspace's condition-appropriate frozen repository and canonical `solver.py` interface without merging team outputs.

### Edge Cases

- A condition token uses lowercase, an alias, whitespace, or an unknown two-letter combination.
- A caller tries to supply a condition whose build identity belongs to the opposite key regime.
- One isolated repository changes while another agent is waiting for activity.
- An agent never commits, creates conflicts, shares raw evidence in a shared condition, or finishes before later stages.
- Sandbox setup crosses the 60-minute cutoff before all sessions start.
- A shared or isolated repository fails to freeze after sessions terminate.
- Manual evaluation names a workspace or frozen repository not present in the attempt.

## Puzzle & Observation Boundaries

**Puzzle Behavior**: Three concurrent agents receive different private evidence over the same six-stage schedule. The declared condition determines whether peer communication is available and whether the stationary or re-key paired block is used; it does not prescribe how agents solve or collaborate.

**Agent Instructions & Tools**: Every prompt identifies the word-substitution cipher, states the same team identity and reconstruction objective, declares `origin/main:solver.py` as the sole checkable and gradeable submission, and describes private evidence, references, local commands, published-solver checker, activity wait, resource cutoff, and requested final response. Shared prompts state that one ordinary team Git repository and peer activity are available. Isolated prompts state that each agent has a private usable Git repository and no peer communication channel. Prompts do not reveal re-keying, oracle sets, scores, roles, prescribed workflows, algorithms, or required intermediate artifacts.

**Environmental Constraints**: Shared conditions expose one bare repository to all three workspaces and peer Git activity. Isolated conditions expose one independent bare repository per workspace at the same agent-visible path and no peer Git activity. Every origin begins at the same deterministic commit containing a neutral `solver.py` scaffold. Evidence allocation, stage bytes, release offsets, references, sandbox, network, secrets, models, token limits, wall-time cutoff, checker, and evaluation boundary remain condition-invariant except for the declared key regime.

**Observable Outcomes**: Durable records retain the canonical condition, derived treatment dimensions, block and variant identities, release timestamps, tool and checker activity, Git refs and frozen topology, session responses, usage, termination, sandbox identity, overlap observations, and manual evaluation. Independent work, raw sharing when possible, conflicts, failure to improve the scaffold, early stopping, and unconventional strategies remain outcomes.

**Infrastructure Failures**: Invalid condition/build pairing, missing treatment resources, sandbox setup failure, timer failure, evidence publication failure, repository creation/monitoring/freezing failure, trace publication failure, or evaluation-environment mismatch stop or explicitly fail the attempt. Model choices and unsuccessful collaboration do not become infrastructure failures.

**Verification Boundary**: Provider-free fixture adapters and fake clocks verify condition resolution, visibility, scheduling, freezing, records, prompt neutrality, overlap, and manual evaluation. Advisory development checks remain non-authorizing; provider-backed research still requires the existing clean receipt-bound preflight and retains its tested revision and sandbox identity.

**Out-of-Scope Claims**: These conditions do not prove that communication, collaboration, re-key recognition, or belief revision occurred or caused a score difference. This feature adds no automated behavioral review, aggregation, retry policy, post-hoc merge, benchmark certification, or security claim.

## Requirements

### Functional Requirements

- **FR-001**: The runner MUST accept exactly the canonical condition identifiers `CS`, `CR`, `IS`, and `IR`.
- **FR-002**: Each identifier MUST derive exactly one immutable pair: `CS` shared/stationary, `CR` shared/re-key, `IS` isolated/stationary, and `IR` isolated/re-key.
- **FR-003**: Validation MUST reject aliases, casing variants, whitespace variants, unknown identifiers, and separately supplied treatment combinations.
- **FR-004**: The runner MUST select the stationary paired-build variant for `CS` and `IS`, and the re-key paired-build variant for `CR` and `IR`.
- **FR-005**: Every attempt MUST use exactly three agents, six stages, release offsets of 0, 5, 10, 20, 30, and 40 minutes, and a 60-minute wall-time cutoff.
- **FR-006**: Scheduling MUST use a monotonic clock and stop unreleased stages when the cutoff is reached.
- **FR-007**: Shared conditions MUST provide all agents with workspaces cloned from one ordinary bare Git repository mounted at the common Git path and initialized with the neutral `solver.py` scaffold on `main`.
- **FR-008**: Shared conditions MUST expose repository changes as peer-visible activity without requiring any Git operation.
- **FR-009**: Isolated conditions MUST provide each agent with a usable independent bare Git repository mounted at the same common Git path and initialized with the same scaffold bytes and commit identity as every other origin.
- **FR-010**: Isolated conditions MUST NOT expose another agent's repository, refs, committed content, evidence, workspace, or Git activity.
- **FR-011**: Agent-visible team identity, objective, evidence allocation and timing, references, local tools, checker, non-Git activity, limits, sandbox, and evaluation boundary MUST remain identical across communication-paired conditions.
- **FR-012**: Prompts MUST differ by communication mode only in the channel-availability paragraph and MUST NOT disclose key regime, re-keying, oracle sets, expected effects, scoring expectations, assigned roles, prescribed workflows, decoding algorithms, or required intermediate artifacts.
- **FR-013**: Git commands MUST remain model-chosen and unmetered in every condition. The runner MUST NOT automate agent commits, pushes, merges, conflict resolution, roles, turns, or collaboration cadence.
- **FR-014**: Attempt configuration and durable summaries MUST record block identity, condition, derived communication mode, derived key regime, build variant identity, exact release offsets, cutoff, and sandbox identity.
- **FR-015**: Traces MUST retain actual stage release timestamps, tool and checker activity, Git activity visible under the condition, session responses, usage, termination, and infrastructure errors.
- **FR-016**: Freezing MUST preserve every repository and workspace in its native shared or isolated topology without merging or rewriting model work.
- **FR-017**: Overlap observation MUST scan all frozen repositories independently and remain non-blocking and score-independent.
- **FR-018**: Evaluation MUST select one documented frozen workspace and its corresponding frozen repository, then execute only the canonical `python3 solver.py` interface without post-hoc merging or reviewer-selected commands.
- **FR-019**: Attempt and experiment artifact decoders MUST reject missing, inconsistent, or unsupported condition fields and topology.
- **FR-020**: Provider-free fixtures MUST exercise all four conditions without provider credentials or live model requests.
- **FR-021**: Existing provider adapters, checker scoring, sandbox isolation, receipt-bound preflight, and explicit manual evaluation MUST be reused rather than replaced with condition-specific subsystems.
- **FR-022**: The feature MUST NOT add automated behavioral review, reviewer schemas, outcome aggregation, automatic retries, or result selection.
- **FR-023**: The checker MUST accept no candidate path, explicitly capture the exact current commit from the assigned origin's `refs/heads/main`, materialize only that tree without Git metadata, execute `solver.py` in a fresh one-shot sandbox containing only the supplied released ciphertext and an empty output directory, and return only the commit, aggregate score fields, or an execution error.
- **FR-024**: Final grading MUST execute the selected condition-appropriate frozen origin's captured `refs/heads/main` commit through the same published-solver executor and `python3 solver.py` interface against the complete ciphertext; agent workspaces, evidence directories, reference corpora, Git origins, uncommitted files, other branches, stale tracked outputs, and post-hoc merges MUST NOT count.

### Key Entities

- **Condition**: One canonical identifier and its derived communication mode plus key regime.
- **Communication Mode**: Shared peer-visible Git or isolated per-agent Git with no peer channel.
- **Key Regime**: Stationary or re-key paired puzzle variant selected from the same block.
- **Release Schedule**: Six fixed monotonic offsets and one fixed attempt cutoff.
- **Git Topology**: The shared or isolated set of bare repositories and agent workspaces created and frozen for an attempt.
- **Condition Attempt**: One block-condition execution with immutable treatment, session, trace, sandbox, and frozen-artifact records.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All four canonical identifiers resolve to the declared treatment pair, and every non-canonical identifier or arbitrary pairing is rejected before execution.
- **SC-002**: In provider-free tests, every origin begins at the same scaffold commit, a shared commit becomes visible to both peers, and an isolated commit remains invisible to both peers while every agent can use its own repository.
- **SC-003**: Prompt snapshots across all four conditions contain zero key-regime or oracle disclosures and differ between communication-paired conditions only in the declared channel paragraph.
- **SC-004**: Fake-clock traces for every condition record six releases at exactly 0, 300000, 600000, 1200000, 1800000, and 2400000 milliseconds and stop sessions at 3600000 milliseconds.
- **SC-005**: Stationary conditions use only the stationary build ID and re-key conditions use only the re-key build ID for every tested block.
- **SC-006**: Frozen shared attempts contain one bare repository plus three workspaces; frozen isolated attempts contain three independent bare repositories plus their three workspaces, with no merge step.
- **SC-007**: Every condition attempt round-trips through strict artifact decoders with complete block, treatment, schedule, session, trace, usage, termination, sandbox, and topology records.
- **SC-008**: A provider-free four-condition run completes through build, run, published-main checking, freeze, overlap observation, and explicit manual evaluation with the complete repository verification suite passing.
- **SC-009**: Shared-executor tests prove that a mutated bare-origin `HEAD`, local files, unpushed commits, other branches, Git history, caller-selected candidate paths, and a tracked stale reconstruction cannot affect checker feedback or final grading.

## Assumptions

- Feature 013's five paired blocks and schema-version-3 build manifest are the sole puzzle inputs.
- The fixed schedule is part of the condition runtime, not paired-build identity.
- Stage release activity remains private to its recipient in every condition.
- Isolated agents retain Git as a normal local tool even though it is not a communication channel.
- The same sandbox mount path is used for shared and isolated repositories so agent-visible tooling remains stable.
- Reviewer selection stays explicit and manual; a later protocol feature may freeze the selection rubric but will not automate behavioral interpretation here.
- No live model call, paid calibration, compatibility layer for arbitrary treatment combinations, or new service is in scope.
