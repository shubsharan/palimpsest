# Feature Specification: Configurable Run Controls

**Feature Branch**: `019-configurable-run-controls` **Created**: 2026-07-31 **Status**: Implemented **Input**: Make puzzle schedules and resource controls genuine manifest inputs, freeze resolved values per run, and preserve generic returned reasoning-summary evidence.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Configure Each Puzzle Run (Priority: P1)

As a researcher, I can choose a run's stage-release schedule, wall cutoff, token policy, and monetary authorization in the experiment manifest without editing source code or creating a feature branch.

**Why this priority**: Configuration is the runner's public research interface. Values that appear in the manifest must be real inputs rather than decorative copies of repository constants.

**Independent Test**: Resolve and run two provider-free manifests with different valid release offsets, cutoffs, and token policies. Each attempt must follow its own declared controls without source changes.

**Acceptance Scenarios**:

1. **Given** a manifest with six ordered release offsets and a cutoff after the final release, **When** the manifest is resolved, **Then** those exact values control releases and the wall cutoff.
2. **Given** a positive per-agent token limit, **When** a session reaches that cumulative provider-reported usage, **Then** it terminates as token-exhausted.
3. **Given** an explicitly disabled per-agent token limit, **When** reported usage grows, **Then** the session continues until voluntary completion, infrastructure failure, or the wall cutoff.
4. **Given** monetary authorization values, **When** a paid run is prepared, **Then** the declared per-attempt and study-wide ceilings are checked before provider work.

---

### User Story 2 - Freeze One Run Without Freezing Every Run (Priority: P1)

As a researcher inspecting or sharing a result, I can prove exactly which configuration governed that run even though later runs may use different valid values.

**Why this priority**: Reproducibility belongs to the resolved run record, not to repository-wide constants.

**Independent Test**: Resolve two different manifests and verify that each receipt, protocol digest, reservation, trace, and attempt records its own chosen controls and rejects drift after launch.

**Acceptance Scenarios**:

1. **Given** a valid manifest, **When** a run is initialized, **Then** its resolved non-secret controls are included in the frozen protocol and digest.
2. **Given** a launched run, **When** the source manifest or launch controls no longer match its receipt or reservation, **Then** execution fails before additional provider work.
3. **Given** two runs with different valid controls, **When** their artifacts are inspected, **Then** neither is treated as invalid merely because it differs from the other or from the checked-in example manifest.

---

### User Story 3 - Inspect Returned Reasoning Summaries Safely (Priority: P2)

As a researcher, I can inspect the exact summary items returned by a supported provider separately from normalized summary text without retaining hidden reasoning or a complete provider response.

**Why this priority**: Provider-returned evidence is useful across experiments and is independent of any particular clock or budget choice.

**Independent Test**: Synthetic provider responses prove exact ordered summary capture, captured-empty and unavailable-body states, trace propagation, and exclusion of unrelated response fields.

**Acceptance Scenarios**:

1. **Given** returned reasoning summary items, **When** a model turn completes, **Then** item identifiers and ordered summary entries are retained exactly.
2. **Given** a captured response containing no reasoning items, **When** the turn is recorded, **Then** it is distinguishable from an unavailable response body.
3. **Given** encrypted reasoning or unrelated response fields, **When** summary evidence is retained, **Then** those fields and the complete body are absent.

### Edge Cases

- Release offsets must be safe non-negative integers, begin at zero, be strictly increasing, match the constructed stage count, and precede the wall cutoff.
- A wall cutoff that is not after the final release fails before build or provider side effects.
- The token limit is either an explicit positive safe integer or explicitly disabled; missing or ambiguous policy is rejected.
- Study-wide token authorization is required only when a token limit is enabled; monetary authorization remains mandatory for every configuration.
- Arithmetic overflow while computing matrix or replacement authorization fails validation.
- Provider usage remains observable even when it is not a termination limit.
- Unsupported providers omit exact returned-summary evidence rather than inventing an OpenAI-shaped unavailable state.

## Puzzle & Observation Boundaries _(mandatory)_

**Puzzle Behavior**: Configuration changes environmental controls for a puzzle run. It does not prescribe how agents solve, coordinate, commit, or finish.

**Agent Instructions & Tools**: Prompts disclose the resolved wall and token limits. Existing team identity, condition-defined communication, local tools, ordinary Git, checker, activity waiting, and published-main grading remain unchanged.

**Environmental Constraints**: Stage geometry remains determined by the selected puzzle build. The manifest controls release timing, wall cutoff, optional token cutoff, model settings, and monetary authorization within validation bounds.

**Observable Outcomes**: Resolved controls, provider-reported usage, termination, returned summary evidence, tool and Git activity, stage releases, frozen workspaces, reviewer selection, and evaluation remain explicit.

**Infrastructure Failures**: Invalid or drifted configuration, provider, sandbox, trace, release, Git freeze, publication, and evaluation failures remain distinct from model outcomes.

**Verification Boundary**: Provider-free verification is advisory development evidence. Paid or findings-bearing work still requires a clean receipt-bound preflight of the exact committed source and sandbox.

**Out-of-Scope Claims**: This feature does not make arbitrary configurations scientifically comparable, expose hidden chain-of-thought, add automatic retries or provider fallback, or turn the local runner into an experiment service.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The experiment manifest MUST be the authoritative input for stage release offsets and the wall cutoff.
- **FR-002**: The runner MUST accept any safe schedule whose first offset is zero, offsets are strictly increasing, offset count matches the build's stage count, and cutoff is strictly after the final release.
- **FR-003**: The runner MUST NOT compare a valid schedule to one repository-wide experiment schedule.
- **FR-004**: The manifest MUST declare the per-agent token policy explicitly as either a positive limit or disabled.
- **FR-005**: An enabled token limit MUST terminate a session when cumulative provider-reported input plus output usage reaches the declared limit.
- **FR-006**: A disabled token limit MUST never terminate a session based on cumulative token usage while usage remains recorded.
- **FR-007**: Prompts, configuration snapshots, receipts, reservations, protocol digests, traces, and attempts MUST represent the resolved schedule and token policy consistently.
- **FR-008**: Per-attempt and study-wide monetary ceilings MUST remain explicit, safe, and enforced before provider work.
- **FR-009**: Study-wide token authorization MUST be enforced when token limits are enabled and MUST be absent rather than fabricated when disabled.
- **FR-010**: A run's resolved non-secret controls MUST become immutable at launch and drift MUST fail closed before additional provider work.
- **FR-011**: Different valid manifests MUST be independently runnable without source changes, schema-version changes, or feature branches.
- **FR-012**: The checked-in manifest MUST remain one editable example and MUST not define the only accepted runtime values.
- **FR-013**: OpenAI Responses turns MUST retain returned reasoning item identifiers and ordered `summary_text` entries separately from normalized summary text.
- **FR-014**: Returned-summary evidence MUST distinguish captured-empty from response-body-unavailable.
- **FR-015**: Exact-summary capture MUST exclude encrypted reasoning, hidden chain-of-thought, complete response bodies, headers, credentials, and unrelated output fields.
- **FR-016**: Exact-summary capture MUST NOT change prompts, tools, retries, model choice, usage accounting, or session control.
- **FR-017**: Existing condition, communication, Git, checker, evaluation, failure, trace, and sandbox behavior MUST remain unchanged except where needed to carry the resolved controls and summary evidence.

### Key Entities

- **Run Controls**: Release offsets, wall cutoff, explicit token policy, and monetary authorization selected for one manifest.
- **Resolved Run Controls**: Validated non-secret values used by prompts, sessions, receipts, reservations, traces, and attempts.
- **Token Policy**: Either an enabled positive per-agent cumulative limit or an explicit disabled state.
- **Returned Reasoning Summary Evidence**: Capture status plus provider-returned reasoning item identifiers and ordered summary entries.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: At least three distinct valid clock configurations run through provider-free tests without source changes.
- **SC-002**: Tests demonstrate both enabled and disabled token policies, with zero token-exhausted sessions under the disabled policy.
- **SC-003**: Every frozen run-control value has 100% agreement across resolved configuration, prompt, receipt, reservation, protocol, trace, and attempt.
- **SC-004**: Every invalid schedule and unsafe authorization test fails before build or provider side effects.
- **SC-005**: Exact-summary tests retain 100% of supplied identifiers, entry order, types, and text while retaining zero excluded response fields.
- **SC-006**: Full provider-free repository verification passes without live credentials or billable calls.

## Assumptions

- The current puzzle catalog continues to construct six stages; configurability applies to when those stages are released, not to changing scientific build geometry in this feature.
- `null` is the explicit manifest value for a disabled token limit; omission is invalid so resource policy is never ambiguous.
- When token limiting is disabled, the study omits a total token authorization ceiling while still recording actual usage.
- The checked-in example retains the current one-hour schedule and enabled token limit until a researcher edits it for another run.
- Raw returned-summary extraction initially applies only to the direct OpenAI Responses driver because other providers do not share that response shape.
