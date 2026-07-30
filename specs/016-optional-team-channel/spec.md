# Feature Specification: Optional Team Channel

**Feature Branch**: `016-optional-team-channel` **Created**: 2026-07-29 **Status**: Draft **Input**: User description: "Add an optional channel agents can use to discuss strategy and ideas outside Git, turn it on or off per test, and try it in the next run."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Enable Direct Team Discussion (Priority: P1)

An experiment operator can enable one shared team channel for a test. Agents in a shared communication condition can post strategy, questions, hypotheses, and coordination messages and can read every teammate message without using Git as a chat transport.

**Why this priority**: Direct discussion is the new experimental capability and should make open-ended collaboration more natural while leaving solver integration in Git.

**Independent Test**: Run a provider-free shared-condition attempt with the channel enabled. Each agent can post and read messages from both peers, and a waiting peer resumes when a message is posted.

**Acceptance Scenarios**:

1. **Given** a shared-condition test with the team channel enabled, **When** one agent posts a message, **Then** both peers can read the same authored message in the same sequence.
2. **Given** a peer waiting for activity, **When** another agent posts a team message, **Then** the waiting peer resumes and can read the new message.
3. **Given** agents exchanging messages, **When** they publish or check a solver, **Then** only the solver pushed to the assigned origin's `main` branch is checkable or gradeable.

---

### User Story 2 - Preserve Git-Only Tests (Priority: P2)

An experiment operator can disable the team channel for a test. The resulting agent prompt, tool surface, activity behavior, and grading boundary preserve the existing Git-only experiment.

**Why this priority**: The optional channel must not erase the existing treatment or silently alter earlier study behavior.

**Independent Test**: Run otherwise identical provider-free shared-condition attempts with the channel disabled and enabled. The disabled attempt exposes no team-message tools or activity, while all non-channel puzzle inputs remain equal.

**Acceptance Scenarios**:

1. **Given** a test with the team channel disabled, **When** agent sessions start, **Then** no direct-message tool is available and the prompt describes Git as the available peer channel.
2. **Given** a test with the channel enabled but an isolated condition, **When** agent sessions start, **Then** no peer message, message activity, or direct-message tool is visible.
3. **Given** an enabled and disabled test, **When** their declared records are inspected, **Then** the selected channel mode is explicit and cannot be confused across attempts.

---

### User Story 3 - Retain the Complete Discussion Record (Priority: P3)

A researcher can inspect the full ordered team discussion after an attempt and relate it to model responses, Git changes, checker calls, stage releases, and termination.

**Why this priority**: Strategy discussion is useful research evidence only if its authorship, order, and timing are durable and auditable.

**Independent Test**: Execute interleaved provider-free posts from all agents, freeze the attempt, and verify that the trace reconstructs the complete ordered transcript exactly once.

**Acceptance Scenarios**:

1. **Given** multiple interleaved posts, **When** the attempt is published, **Then** every accepted message has one author, one attempt-scoped sequence, its content, and its attempt-relative time.
2. **Given** an invalid post or channel infrastructure failure, **When** the tool call completes, **Then** the failure is explicit and no success-shaped message record is produced.

### Edge Cases

- Two agents post near-simultaneously.
- An agent asks to read before any message has been posted or after the latest sequence.
- A message is empty, whitespace-only, or too large for the declared tool contract.
- A caller supplies message-tool arguments when the channel is disabled.
- A waiting agent is awakened by a team message while a stage or Git event is also published.
- The attempt reaches its wall-time cutoff while an agent is reading or posting.

## Puzzle & Observation Boundaries _(mandatory)_

**Puzzle Behavior**: The configured test may add one shared append-only discussion channel to shared communication conditions. It changes how agents can communicate, not the cipher, private evidence, staged release schedule, solver interface, checking, grading, or resource cutoff.

**Agent Instructions & Tools**: Enabled shared-condition prompts state that agents may use the team channel for strategy and ideas and Git for the graded solver. Agents receive simple post and read tools with no assigned roles, turns, required messages, consensus rule, or coordination cadence. Disabled and isolated sessions receive no direct-message tools. `origin/main:solver.py` remains the sole checkable and gradeable artifact.

**Environmental Constraints**: Every accepted message is visible to all agents in the same enabled shared-condition attempt and to no other attempt. There are no private messages. Isolated conditions expose no peer messages or message activity even when the manifest enables the optional channel. Existing evidence, Git topology, sandbox, network, secret, schedule, token, and wall-time boundaries remain unchanged.

**Observable Outcomes**: Durable traces retain the declared channel mode, accepted message sequence, author, content, time, reads, tool failures, wake activity, Git/checker behavior, model responses, usage, and termination. Choosing not to post, ignoring messages, duplicating discussion in Git, disagreement, and unsuccessful coordination remain model outcomes.

**Infrastructure Failures**: Invalid configuration, channel construction failure, trace publication failure, or inconsistent prompt/tool/artifact declarations fail explicitly. Empty or oversized messages and invalid cursors are ordinary tool errors. Lack of messages or poor use of the channel is not an infrastructure failure.

**Verification Boundary**: Provider-free fixtures verify enabled delivery, disabled absence, isolated non-observability, wake behavior, ordered tracing, prompt disclosure, and unchanged Git grading. Advisory development checks remain non-authorizing. A clean receipt-bound preflight is required before a paid or findings-bearing run and binds the selected channel mode, prompts, source revision, and sandbox identity.

**Out-of-Scope Claims**: This feature does not claim that direct discussion improves scores, proves collaboration, exposes hidden reasoning, produces consensus, or isolates the causal effect of communication without paired runs. It adds no private messaging, service, account, database, automated moderator, summarizer, role assignment, or post-hoc solver merge.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Every test manifest MUST declare the optional team channel as exactly `enabled` or `disabled`.
- **FR-002**: The selected channel mode MUST be bound into the resolved manifest, design receipt, prompt identity, attempt protocol, and durable attempt record.
- **FR-003**: An enabled shared-condition attempt MUST provide all three agents one append-only team channel with a single attempt-scoped message order.
- **FR-004**: Every accepted message MUST contain exactly one canonical agent author, non-empty bounded content, a unique increasing sequence, and attempt-relative publication time.
- **FR-005**: Every agent in an enabled shared-condition attempt MUST be able to read messages after a supplied sequence without seeing messages from another attempt.
- **FR-006**: Posting a message MUST create condition-visible activity that can resume peers waiting for activity.
- **FR-007**: Disabled attempts and all isolated-condition sessions MUST expose no message tools, messages, or message activity.
- **FR-008**: Agent prompts MUST accurately distinguish enabled direct discussion, Git-only shared communication, and isolated communication without prescribing roles, turns, message counts, consensus, or a coordination sequence.
- **FR-009**: Direct messages MUST NOT be accepted as solver submissions, receive oracle-backed scores, alter Git, or affect final grading; only the declared pushed `main` solver may be checked or graded.
- **FR-010**: Durable traces MUST record every accepted message once with its author, sequence, content, and time and MUST retain message tool reads and failures in normal tool activity.
- **FR-011**: Invalid mode values, invalid message authorship, empty or oversized content, and invalid read cursors MUST be rejected explicitly.
- **FR-012**: The feature MUST preserve the existing cipher inputs, private evidence allocation, release schedule, Git topology, solver scaffold, checker, evaluation interface, token budget, cutoff, sandbox, and provider behavior.
- **FR-013**: The feature MUST NOT add private messages, external services, accounts, databases, automated summaries, moderators, required responses, roles, rounds, or post-hoc merging.

### Key Entities

- **Team Channel Mode**: The explicit per-test selection of `enabled` or `disabled`, bound into configuration and attempt provenance.
- **Team Message**: One accepted attempt-scoped post with sequence, author, content, and publication time.
- **Team Channel Activity**: A peer-visible wake event indicating that at least one new message can be read.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Provider-free tests deliver 100% of accepted messages to all and only the three agents in an enabled shared-condition attempt, in identical order.
- **SC-002**: Provider-free tests expose zero direct-message tools, messages, or wake events in disabled and isolated sessions.
- **SC-003**: Every accepted message appears exactly once in the durable ordered trace with complete author, sequence, content, and timing fields.
- **SC-004**: Waiting peers become able to observe a newly posted message without polling Git or waiting for the next evidence stage.
- **SC-005**: Enabled and disabled attempt records are unambiguously distinguishable while their non-channel puzzle, resource, sandbox, and grading inputs remain identical.
- **SC-006**: The complete repository verification suite and a clean receipt-bound preflight pass without a live provider call.

## Assumptions

- The channel is a single public room for the three agents; private or agent-targeted messages are out of scope.
- Message text consumes the agents' normal model context and token budget; no separate communication budget is introduced.
- The checked-in experiment configuration enables the channel so the next run exercises it, while changing the declared mode to `disabled` restores Git-only behavior.
- Enabling the channel affects only shared conditions. Isolated conditions remain peer-isolated by definition.
