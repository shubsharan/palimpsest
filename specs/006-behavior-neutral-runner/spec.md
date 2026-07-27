# Feature Specification: Behavior-Neutral Multi-Agent Puzzle Runner

**Feature Branch**: `006-behavior-neutral-runner` **Created**: 2026-07-27 **Status**: Ready for planning **Input**: Replace the evidence-gated harness with a simple three-agent Palimpsest runner that gives models private staged evidence, local tools, aggregate checking, and ordinary shared Git, then observes how they work until time or token limits end the run.

## User Scenarios & Testing

### User Story 1 - Let a frontier-model team solve freely (Priority: P1)

An operator starts one Palimpsest attempt with three model agents. Every agent knows it is one member of a concurrent team, knows that peers hold different private evidence, and has the same shared objective. Agents may use local tools, check their own work, and communicate through a shared Git repository without assigned roles, turns, checkpoints, or a required collaboration pattern.

**Why this priority**: The project exists to observe how frontier models approach the puzzle. The run is not useful if its coordinator supplies the approach being measured.

**Independent Test**: Start three deterministic fixture agents with different behaviors and verify that independent work, Git collaboration, waiting, early voluntary completion, and arbitrary tool use all remain valid model outcomes until a resource cutoff occurs.

**Acceptance Scenarios**:

1. **Given** three agents with private evidence and one shared repository, **When** they begin, **Then** each is told the joint objective, its identity, that two peers are active, and that Git is the team communication channel.
2. **Given** an active agent, **When** it works without using Git or follows an unconventional workflow, **Then** the runner records the behavior without repairing it, prompting a required next action, or invalidating the attempt.
3. **Given** agents that choose to collaborate, **When** they push, fetch, branch, merge, or inspect history, **Then** they use ordinary unmetered Git and choose their own files, cadence, roles, and integration strategy.
4. **Given** an agent that is waiting, **When** new private evidence or peer-visible Git state appears, **Then** it may resume without forcing other agents to synchronize.

---

### User Story 2 - Encounter evidence that challenges prior beliefs (Priority: P2)

During the same open-ended attempt, each agent receives additional private text on a schedule independent of model behavior. At one shared transition stage, later text in every private shard partially changes the substitution mapping, leaving most prior mappings valid while making a controlled subset wrong. This creates a concrete test of whether agents detect that a previously useful rule is no longer fully valid, work together to review it, and update how they apply it rather than forcing contradictory evidence to fit for too long. Agents still decide whether, when, and how to notice, review, preserve, revise, or communicate their beliefs.

**Why this priority**: Partial re-keying tests review of prior beliefs only when contradictory evidence arrives after useful work can form. The runner must make that revision behavior observable without announcing the change, demanding a checkpoint response, or defining how quickly or collaboratively agents should adapt.

**Independent Test**: Deliver a fixed staged fixture containing one hidden partial re-key to three independent sessions and verify that the new evidence appears on schedule, earlier evidence remains unchanged, waiting sessions can observe activity, and no stage requires a model response or structured hypothesis.

**Acceptance Scenarios**:

1. **Given** pre-change evidence, **When** the scheduled post-change stage arrives, **Then** the selected mappings change, unselected mappings remain stable, and all earlier files remain available byte-for-byte.
2. **Given** agents in different lifecycle states, **When** a stage arrives, **Then** working agents continue, waiting agents may resume, and voluntarily finished or exhausted agents remain stopped.
3. **Given** a model that misses or ignores the change, **When** the attempt ends, **Then** the resulting stale code or reconstruction remains a scored model outcome.
4. **Given** agents that infer and share a rule before the transition, **When** later evidence contradicts part of it, **Then** the retained timeline makes it possible to review whether they preserved, questioned, revised, or continued forcing that rule without labeling any response as required.

---

### User Story 3 - Check and review what the team produced (Priority: P3)

Agents may repeatedly evaluate candidate reconstructions against only their currently visible private evidence. After the attempt freezes, a reviewer inspects the shared code, chooses how to run it against the complete ciphertext, scores the produced reconstruction, and reviews the trace without converting workarounds into validity failures.

**Why this priority**: Aggregate checking helps models test their own work without prescribing a decoder, while reviewer-led execution accepts arbitrary team-created code without requiring a solver manifest or file layout.

**Independent Test**: Run fixture attempts with successful, partial, missing, ambiguous, raw-sharing, and broken team code; verify aggregate private checking, final evaluation status, deterministic reconstruction scores, trace retention, and observational raw-overlap reporting.

**Acceptance Scenarios**:

1. **Given** a candidate reconstruction for currently released private text, **When** an agent checks it, **Then** it receives only matched-word count, total-word count, coverage, accuracy, or an execution error without correct words or mismatch locations.
2. **Given** a frozen shared repository, **When** a reviewer selects a command and output, **Then** the exact selection and execution result are recorded before the reconstruction is scored against the complete plaintext.
3. **Given** no runnable output, failed execution, no Git use, raw-text sharing, repeated checking, source recognition, or another process workaround, **When** the attempt is reviewed, **Then** the behavior is retained and reported without changing any available reconstruction score.

### Edge Cases

- One agent finishes before any stage or peer change while the other two continue.
- An agent reaches its token limit while inside a tool call or while waiting.
- The wall-time cutoff occurs while a model response, checker execution, or Git operation is active.
- A stage arrives after an agent voluntarily finishes or exhausts its tokens.
- Multiple peers change Git while another agent waits.
- Git contains no commits, conflicting branches, a broken working tree, large raw-text blobs, or no clear solver entrypoint.
- A checker candidate has missing, extra, malformed, or unresolved tokens.
- A reviewer finds several plausible execution commands or no plausible command.
- The final solver writes no output, times out, exits unsuccessfully, or produces text with a different token count.
- Obvious raw spans are encoded, compressed, fragmented, or otherwise missed by the deliberately narrow overlap observation.

## Puzzle & Observation Boundaries

**Puzzle Behavior**: Three agents solve one distributed word-substitution puzzle from private staged shards. One hidden partial re-key changes a controlled subset of mappings in later evidence. Agents are asked to work as a team through shared Git while choosing every concrete strategy and coordination behavior themselves.

**Agent Instructions & Tools**: Each agent receives the same concise puzzle and teamwork instruction except for its identity and private paths. It has local file, shell, and code tools; a target-excluded shared reference corpus; ordinary authenticated Git; aggregate private reconstruction checking; and activity waiting. Instructions ask agents to share code and compact findings rather than raw ciphertext or reconstructed prose, but the runner does not enforce that request.

**Environmental Constraints**: Private evidence is staged outside the Git checkout on a fixed wall-clock schedule. Prepared plaintext, cipher keys, peer-private files, and checker internals remain unavailable. Each agent has a cumulative model-token budget, and the attempt has one wall-time cutoff. Provider credentials and host controls remain outside agent workspaces.

**Observable Outcomes**: The attempt retains model and tool transcripts, session states, staged-input observations, checker calls and aggregate results, Git history, frozen workspaces, reviewer execution choices, final reconstruction scores, and a deliberately narrow post-run measure of obvious raw overlap. The stage and Git timeline lets a reviewer compare when contradictory evidence arrived with subsequent rule use, revision, and peer coordination without requiring a canonical belief artifact.

**Infrastructure Failures**: Failure to start or contact a model session, deliver declared private evidence, provide ordinary Git, enforce the configured token or wall-time cutoff, execute the checker, or score a reviewer-selected output is reported separately from model behavior. Infrastructure does not repair model work or manufacture a score.

**Out-of-Scope Claims**: The feature does not prove semantic reasoning, collaboration ability, belief revision as a general trait, source non-recognition, secure isolation against malicious code, covert-channel capacity, exact model replay, or benchmark validity. It does not prevent raw relay, checker exploitation, unusual encodings, source recognition, or ineffective collaboration.

## Requirements

### Functional Requirements

- **FR-001**: One attempt MUST create exactly three independent persistent agent sessions working on one shared team objective.
- **FR-002**: Every agent MUST be told its identity, that two peers are working concurrently with different private evidence, and that the shared Git repository is the team's communication channel.
- **FR-003**: Agent instructions MUST NOT recommend a decoding algorithm, assign roles, impose turns, require Git operations, or require mappings, hypotheses, checkpoints, confidence values, file layouts, or intermediate reasoning artifacts.
- **FR-004**: Every agent MUST receive equivalent local tools, the same target-excluded reference corpus, ordinary unmetered Git access, aggregate checking, and activity waiting.
- **FR-005**: Private puzzle evidence MUST remain outside the shared Git checkout and MUST be visible only to its assigned agent until that agent voluntarily communicates it.
- **FR-006**: The system MUST stage complete private evidence segments on one wall-clock schedule independent of model turns, token use, tool calls, Git activity, and checker calls.
- **FR-007**: The puzzle MUST contain one hidden transition stage shared by all three shard streams; every agent MUST receive useful pre-change and post-change evidence, the partial re-key MUST preserve a complete substitution, change the selected mapping subset, leave unselected mappings unchanged, and never rewrite an earlier evidence file.
- **FR-008**: A stage or Git change MUST be able to wake an agent that chose to wait without synchronizing or reinvoking other agents.
- **FR-009**: A final model response MUST voluntarily finish that agent; the runner MUST NOT reinvoke a finished agent.
- **FR-010**: An agent MUST stop when its cumulative model-token budget is exhausted without stopping peers that retain budget.
- **FR-011**: The wall-time cutoff MUST stop all remaining sessions and freeze the shared repository and agent workspaces.
- **FR-012**: The runner MUST NOT limit the number of model responses, tool calls, checker calls, Git operations, branches, commits, or collaboration patterns except through the configured token and wall-time cutoffs or ordinary host-safety limits.
- **FR-013**: Git MUST accept model-created content without experimental byte metering, content warnings, raw-text rejection, publication slots, or required ref structure.
- **FR-014**: Instructions MUST ask agents to collaborate on code and compact findings and to avoid committing raw ciphertext or reconstructed prose.
- **FR-015**: Post-run raw-overlap observation MUST be limited to obvious exact or normalized long spans and MUST NOT block Git, alter a reconstruction score, or invalidate an attempt.
- **FR-016**: Private checking MUST evaluate a model-selected reconstruction only against currently visible evidence assigned to that agent.
- **FR-017**: Private checking MUST return only aggregate matched-word count, total-word count, coverage, accuracy, or an execution error and MUST NOT reveal correct words or mismatch locations.
- **FR-018**: The reviewer MUST be able to record an inferred execution command and output path for the frozen team repository and execute that selection against the complete ciphertext.
- **FR-019**: Final evaluation MUST report `scored`, `not-runnable`, `no-output`, or `execution-error` and MUST preserve any deterministic score that can be computed.
- **FR-020**: The attempt record MUST preserve sufficient raw observations to distinguish model outcomes from infrastructure failures without requiring canonical artifact promotion or exact model replay.

### Key Entities

- **Puzzle Attempt**: One configured three-agent run, its stage schedule, resource limits, shared repository, terminal state, and retained observations.
- **Agent Session**: One persistent model context with identity, private workspace, token usage, lifecycle state, and raw transcript.
- **Evidence Stage**: One scheduled immutable addition to an agent's private ciphertext view.
- **Shared Repository**: The ordinary unmetered Git repository available to all three agents.
- **Checker Observation**: One aggregate evaluation of a candidate reconstruction against currently visible private evidence.
- **Activity Event**: A private-stage or peer-visible Git change that may resume a waiting session.
- **Evaluation Selection**: The reviewer-chosen command, output path, frozen commit or workspace state, and execution result.
- **Attempt Observation**: A raw or derived record used to understand score, resource termination, Git/checker behavior, and obvious raw overlap.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A deterministic fixture starts exactly three independent sessions, and all supported combinations of working, waiting, voluntarily finished, token-exhausted, and time-exhausted states complete without a global round barrier.
- **SC-002**: Zero fixture scenarios require a pull, commit, push, checkpoint, mapping, hypothesis, role, turn, or prescribed file before the attempt can reach a terminal state.
- **SC-003**: One fixed staged puzzle reproduces 100% of evidence bytes, partial re-key selection, aggregate checker results, and final reconstruction scores across repeated fixture runs.
- **SC-004**: Every evidence stage becomes available no earlier than its configured wall-clock offset and without depending on any model or Git action.
- **SC-005**: Checker contract tests expose zero correct plaintext words and zero mismatch locations while returning the declared aggregate measures for valid candidates.
- **SC-006**: An individual token cutoff stops only the exhausted session, and the wall-time cutoff stops every remaining session within the configured shutdown tolerance.
- **SC-007**: Ordinary fixture Git workflows support zero through multiple operations per agent without byte charging, fixed publication cadence, or required ref names.
- **SC-008**: Raw-sharing, no-Git, independent-work, centralized-work, repeated-checking, and broken-solver fixtures all retain their traces and remain reviewable outcomes rather than invalid attempts.
- **SC-009**: Successful, partial, missing, and failed reviewer executions produce the correct declared evaluation status and preserve every score that can be computed.
- **SC-010**: One fresh offline build-run-evaluate fixture completes without an external model call and leaves enough evidence to explain agent lifecycle, staged inputs, checker use, Git state, termination reason, reviewer selection, and score.
- **SC-011**: A fixture that commits a pre-transition rule, continues applying it after contradictory evidence, and later revises it leaves a timeline from which a reviewer can distinguish the evidence arrival, persistence interval, peer communication, and revision without a required hypothesis or mapping submission.

## Assumptions

- The initial active profile uses three private staged shards, one hidden transition shared across all shard streams, six global stages at two-minute intervals, and a changed-token-mass target of approximately 20%.
- Stage cadence, wall-time cutoff, model choice, and per-agent cumulative token budget are operator configuration recorded with the attempt.
- A model's final response indicates voluntary completion. Models that want to remain active use their tools or wait for activity within the persistent session.
- Git is the only peer communication channel supplied by the runner, but the runner does not attempt to detect communication through unprovided channels.
- The aggregate checker is intentionally exploitable through repeated use; checker strategy is part of model behavior.
- A reviewer may need to inspect arbitrary team code manually before choosing an execution command and output path.
- Existing puzzle generation and scoring logic may be reused where it matches this specification; prior gate authorization and hardened harness completion are not prerequisites.
