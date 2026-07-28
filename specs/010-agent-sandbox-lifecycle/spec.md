# Feature Specification: Attempt-Scoped Agent Sandboxes

**Feature Branch**: `010-agent-sandbox-lifecycle` **Created**: 2026-07-27 **Status**: Draft **Input**: User description: "Give each concurrent agent one dedicated sandbox for the full attempt, keep trusted model and harness control outside those sandboxes, use shared Git for collaboration, grade frozen work in a separate sandbox, recover cleanly from sandbox runtime interruption without blindly retrying commands, and update the project sandbox image so its failing acceptance test passes."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Work in a Dedicated Sandbox (Priority: P1)

Each agent works for the duration of an attempt in its own stable sandbox. The agent can repeatedly inspect its released private evidence, modify its workspace, and run local commands without gaining access to peer-private evidence, host controls, secrets, or the grading oracle.

**Why this priority**: A stable one-agent/one-sandbox boundary is the clearest expression of the experiment's isolation model and avoids repeated sandbox creation during ordinary work.

**Independent Test**: Start a three-agent fixture, make each agent execute multiple commands, and verify that every command uses that agent's same sandbox while the three agents remain isolated from one another and from protected host data.

**Acceptance Scenarios**:

1. **Given** three concurrent agents, **When** each executes multiple commands, **Then** each command runs in the calling agent's dedicated attempt-scoped sandbox.
2. **Given** one agent's sandbox, **When** it probes declared and undeclared paths, **Then** it can access its own workspace, released evidence, reference corpus, and shared Git but cannot access peer workspaces, peer-private evidence, provider secrets, host controls, or the oracle.
3. **Given** commands from different agents, **When** they run concurrently, **Then** their private workspaces and scratch state remain isolated.

---

### User Story 2 - Collaborate Through Ordinary Git (Priority: P2)

Agents collaborate through one ordinary shared Git repository while retaining separate workspaces and private evidence. The harness observes shared ref changes without choosing branches, repairing conflicts, or prescribing a collaboration sequence.

**Why this priority**: Git is the experiment's voluntary communication channel, so the new sandbox lifetime must preserve native collaboration without opening broader cross-agent access.

**Independent Test**: Have one agent commit and push a result, wake another agent from shared activity, and verify that the peer can fetch the result while neither agent can directly read the other's workspace or private evidence.

**Acceptance Scenarios**:

1. **Given** separate agent workspaces and one shared repository, **When** an agent pushes any valid ref, **Then** peers can observe activity and fetch it through ordinary Git.
2. **Given** an uncommitted file in one agent's workspace, **When** a peer inspects its own sandbox, **Then** the file is unavailable unless the first agent communicates it through Git.
3. **Given** a merge conflict or unconventional branch strategy, **When** agents continue working, **Then** the harness records the outcome without repairing or rejecting it.

---

### User Story 3 - Preserve Work Across Sandbox Interruption (Priority: P3)

When the sandbox runtime becomes unavailable, the harness preserves host-backed work and reports the interrupted command as having an indeterminate outcome. If the runtime returns before the attempt cutoff, the agent receives a replacement sandbox over the same declared workspace and can inspect the state before deciding how to continue.

**Why this priority**: Runtime interruption must not erase useful agent work or cause a possibly non-idempotent command to execute twice.

**Independent Test**: Interrupt the runtime during a command that may have partially modified its workspace, restore the runtime, and verify that the command is not replayed, host-backed state is preserved, the agent can inspect that state, and the event remains visible in the trace.

**Acceptance Scenarios**:

1. **Given** an in-flight agent command, **When** the sandbox runtime becomes unavailable, **Then** the harness never automatically replays that command.
2. **Given** a runtime interruption and surviving host controller, **When** runtime service returns before the attempt cutoff, **Then** the affected agent receives a replacement sandbox with the same declared workspace, evidence, reference, and Git access.
3. **Given** runtime service does not return before the cutoff, **When** the attempt ends, **Then** the affected session records an explicit infrastructure or wall-time termination and all available host-backed work remains inspectable.

---

### User Story 4 - Grade Frozen Work Separately (Priority: P4)

After an attempt freezes, an operator can execute the selected team solution in a separate grading sandbox. The grading sandbox sees the selected frozen workspace, frozen shared Git, and complete ciphertext, while trusted scoring remains outside it with exclusive access to the oracle.

**Why this priority**: Separating untrusted solution execution from trusted scoring prevents solver code from reading the answer it is being evaluated against.

**Independent Test**: Freeze a completed fixture, run the selected solution in the grading sandbox, and verify that it produces a candidate without access to private evidence, provider credentials, prepared plaintext, or cipher keys before trusted scoring computes the result.

**Acceptance Scenarios**:

1. **Given** a frozen attempt, **When** grading is triggered, **Then** the selected command runs in a sandbox distinct from every live agent sandbox.
2. **Given** the grading sandbox, **When** it probes its inputs, **Then** it can access only the selected workspace copy, complete ciphertext, frozen shared Git, declared output, and bounded scratch space.
3. **Given** a candidate reconstruction, **When** scoring runs, **Then** trusted scoring compares it with the oracle without making the oracle visible to the grading sandbox.

### Edge Cases

- An agent finishes without ever executing a local command.
- Multiple agents request commands at the same time.
- An agent command exits nonzero, times out, exceeds output limits, or is cancelled while its sandbox remains healthy.
- The sandbox runtime fails before lease creation, during lease creation, during command execution, during replacement, or during cleanup.
- A command modifies the workspace or pushes Git state immediately before its runtime connection is lost.
- A replacement sandbox finds a dirty workspace, an unfinished lock file, or Git state changed by the interrupted command.
- Runtime service returns after the global wall-time cutoff.
- Grading is triggered after live agent sandboxes have already been removed.

## Puzzle & Observation Boundaries _(mandatory)_

**Puzzle Behavior**: The three-agent puzzle, six-stage private evidence, hidden partial re-key, deterministic construction, aggregate private checker, voluntary collaboration, freeze, reviewer-selected execution, and deterministic scoring remain unchanged. This feature changes the lifetime and recovery behavior of command sandboxes, not the solve objective or scientific mechanics.

**Agent Instructions & Tools**: Agents receive the same objective, peer context, private evidence, reference material, local command tool, aggregate reconstruction checker, activity wait tool, and ordinary shared Git. Agents still choose their own roles, strategy, branches, files, command cadence, checker use, and collaboration behavior.

**Environmental Constraints**: Each agent receives one isolated attempt-scoped sandbox with only its own released evidence and workspace plus the shared reference corpus and Git repository. Provider credentials, public network access, peer-private inputs, host controls, prepared plaintext, cipher keys, and the grading oracle remain unavailable. Existing token, wall-time, resource, output, path, image-identity, and secret-handling constraints remain effective.

**Observable Outcomes**: Model responses, tool requests and results, command exits, timeouts, resource termination, runtime interruption and recovery, Git activity, stage release, session lifecycle, frozen work, reviewer selection, execution outcome, and final score remain traceable. Dirty workspaces, partial command effects, merge conflicts, unusual Git use, and failed collaboration remain model or infrastructure outcomes according to their cause.

**Infrastructure Failures**: Missing or stale sandbox identity, unavailable runtime, lease creation or replacement failure, loss of command outcome, cleanup failure, protected-boundary exposure, failed freeze, unavailable grading sandbox, and scorer failure are explicit infrastructure failures. Runtime loss never turns an unknown command outcome into success and never authorizes automatic command replay.

**Out-of-Scope Claims**: The feature does not make live model behavior reproducible, prevent intentional sharing through Git, detect covert communication, prescribe a collaboration workflow, provide adversarial multi-tenant containment, restart the host's sandbox service, or prove reasoning, collaboration, or belief revision.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST assign exactly one attempt-scoped sandbox lease to each active agent before that agent's first local command.
- **FR-002**: Every local command requested by an agent MUST execute through that agent's assigned lease and MUST NOT execute through a peer or grading sandbox.
- **FR-003**: Each agent lease MUST expose only the calling agent's persistent workspace, currently released private evidence, shared reference corpus, ordinary shared Git remote, and bounded private scratch space.
- **FR-004**: Provider credentials, peer workspaces, peer-private evidence, unreleased evidence, host-control surfaces, prepared plaintext, cipher keys, and grading oracle MUST remain unavailable to every agent lease.
- **FR-005**: The three agent workspaces MUST remain distinct, and the shared Git repository MUST remain their only shared writable collaboration surface.
- **FR-006**: Git use MUST remain voluntary and unmetered; the system MUST NOT prescribe branches, commits, merges, files, roles, turns, or retry behavior.
- **FR-007**: Agent leases MUST preserve the existing image identity, network denial, privilege denial, resource limits, output limit, path containment, user identity, and non-secret environment policy.
- **FR-008**: The active sandbox image MUST provide every baseline local command and source-control capability declared by the project acceptance contract.
- **FR-009**: A healthy lease MUST survive ordinary command success, nonzero exit, and agent-level command errors. A timeout, cancellation, output overflow, or resource kill MAY abandon that lease to guarantee command termination, but any later command MUST use a replacement lease over the same declared host-backed inputs.
- **FR-010**: The system MUST remove every successfully opened agent lease when live sessions end and every partial lease set after failed lease setup, using exact owned container identities so unrelated sandboxes cannot be removed.
- **FR-011**: When runtime interruption makes an in-flight command's outcome unknowable, the system MUST record an indeterminate command result and MUST NOT automatically replay the command.
- **FR-012**: If runtime service returns before the attempt cutoff, the system MUST be able to replace the affected lease over the same host-backed workspace, evidence, reference, and Git inputs without discarding their current state.
- **FR-013**: If lease replacement cannot complete before the attempt cutoff, the system MUST terminate the affected session explicitly as an infrastructure or wall-time failure while preserving available host-backed data.
- **FR-014**: Indeterminate outcomes, successful replacement generations, and terminal replacement failures MUST be retained in the attempt trace with the affected agent.
- **FR-015**: Grading MUST execute in a sandbox separate from all agent leases and MUST begin only from frozen attempt inputs.
- **FR-016**: The grading sandbox MUST receive only a writable copy of the selected frozen workspace, complete ciphertext, read-only frozen Git, declared output path, and bounded scratch space.
- **FR-017**: Trusted scoring MUST remain outside the grading sandbox, and the prepared plaintext and cipher keys MUST never enter that sandbox.
- **FR-018**: Existing build, run, evaluate, offline, and sandbox-preparation command names and their agent-visible puzzle behavior MUST remain compatible.
- **FR-019**: A completed attempt MUST publish its durable summary before optional observation, regardless of whether its sessions used, recovered, or abandoned agent leases.

### Key Entities

- **Agent Sandbox Lease**: The attempt-scoped isolated execution environment assigned to one agent, including its identity, owner, declared inputs, lifecycle state, and replacement generation.
- **Sandbox Command Outcome**: The observable result of one agent command, including ordinary completion, configured termination, or indeterminate outcome after runtime interruption.
- **Shared Git Environment**: The ordinary bare repository plus separate persistent agent workspaces used for voluntary collaboration.
- **Grading Sandbox**: The post-freeze isolated execution environment for a reviewer-selected solution, distinct from agent leases and unable to access the oracle.
- **Recovery Event**: A traceable transition describing runtime loss, lease abandonment, replacement, recovery, or terminal infrastructure failure.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In every three-agent acceptance attempt, exactly three agent sandbox identities are used for all healthy live-agent commands, regardless of command count.
- **SC-002**: In 100% of isolation probes, an agent can access all declared inputs and cannot access any peer-private input, provider secret, host-control surface, or oracle data.
- **SC-003**: A fixture in which every agent executes at least five commands completes with no more than three agent sandbox creations before freeze.
- **SC-004**: In 100% of injected runtime-interruption cases, the interrupted command executes at most once, its outcome is not reported as successful, and all host-backed workspace and Git state remains inspectable.
- **SC-005**: When runtime service returns within the attempt limit, the affected agent can inspect and continue from preserved state without another agent gaining access to that state.
- **SC-006**: In every successful cleanup scenario, no owned agent or grading sandbox survives its lifecycle boundary and no unrelated sandbox is removed; cleanup failure is reported explicitly.
- **SC-007**: The grading acceptance flow produces the same deterministic reconstruction score as the established behavior baseline while all oracle-access probes from the grading sandbox fail.
- **SC-008**: The clean sandbox acceptance suite completes successfully with the project-declared image and requires no manual image modification.
- **SC-009**: Every completed interruption fixture retains enough trace data to distinguish command failure, indeterminate outcome, lease recovery, and terminal infrastructure failure.

## Assumptions

- Model inference and the trusted session controller remain outside agent sandboxes; only model-authored local execution occurs inside them.
- Durable workspaces, private evidence, shared Git, traces, and attempt artifacts remain host-backed so sandbox replacement cannot erase them.
- Runtime service restart is an operator or host responsibility; this feature detects availability and recovers leases but does not launch or restart that service.
- An interrupted command is not assumed idempotent. Recovery exposes preserved state to the agent instead of replaying the command.
- Agent-private scratch state may be lost when a lease is replaced; durable agent work belongs in the persistent workspace.
- The active target remains a single-host research runner rather than an adversarial multi-tenant service.
