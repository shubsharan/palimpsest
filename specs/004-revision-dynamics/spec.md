# Feature Specification: Revision Dynamics

**Feature Branch**: `004-revision-dynamics` **Created**: 2026-07-26 **Status**: Offline implementation complete; live validation deferred **Input**: Test whether one clock-driven partial re-key causes selective belief revision rather than indiscriminate failure or restart.

## User Scenarios & Testing

### User Story 1 - Observe a localized belief failure (Priority: P1)

A product maintainer reveals one cipher progressively to a capable solver. The solver first develops useful stationary mappings. After a hidden chapter-aligned partial re-key, mappings that changed become locally wrong while comparable unchanged mappings remain useful.

**Why this priority**: The puzzle's central revision mechanic exists only if new evidence invalidates a bounded subset of prior beliefs instead of destroying the whole dictionary.

**Independent Test**: Run one progressively revealed instance containing one hidden partial re-key and compare changed entries with frequency-matched unchanged controls before and after contradictory evidence becomes available.

**Acceptance Scenarios**:

1. **Given** only pre-switch chapters, **When** the solver records mapping hypotheses, **Then** it establishes useful mappings before any contradictory post-switch evidence is visible.
2. **Given** the oracle-defined contradiction threshold has been released, **When** the same hypotheses are rescored, **Then** changed mappings deteriorate more than matched unchanged controls.
3. **Given** most mappings did not change, **When** post-switch evidence arrives, **Then** the unchanged dictionary remains materially useful.

---

### User Story 2 - Detect and selectively adapt (Priority: P2)

A reviewer needs to see whether the solver identifies a localized regime change and repairs changed entries while preserving stable ones.

**Why this priority**: A mechanic that merely causes collapse or a full restart does not test selective belief revision.

**Independent Test**: Review every mapping and switch-hypothesis checkpoint on the reveal-clock timeline and measure detection latency, changed-entry recovery, unchanged-entry retention, and false retractions.

**Acceptance Scenarios**:

1. **Given** sufficiently contradictory evidence, **When** the solver publishes a switch hypothesis, **Then** the first correct hypothesis occurs after the oracle threshold and is measured on the reveal clock.
2. **Given** a correct switch hypothesis, **When** later checkpoints are scored, **Then** changed-entry accuracy recovers without wholesale removal of still-valid mappings.
3. **Given** matched unchanged controls, **When** adaptation completes, **Then** false retractions remain below the predeclared ceiling.

---

### User Story 3 - Make an evidence-backed Gate C decision (Priority: P3)

A maintainer applies a rule fixed before the solver run and either retains the partial-re-key profile, changes one owning dial and reruns, or stops the mechanic.

**Why this priority**: Gate C must change the design or stop when the observed behavior is indiscriminate collapse, invisible change, or restart.

**Independent Test**: Resolve the reveal schedule, oracle switch, solver checkpoints, changed/control trajectories, and decision inputs, then independently apply the predeclared rule.

**Acceptance Scenarios**:

1. **Given** complete valid evidence, **When** all pass predicates hold, **Then** Gate C freezes one revision and reveal profile for Gate D.
2. **Given** a visible but poorly calibrated signal, **When** a declared dial owns the failure, **Then** Gate C records `rework` and invalidates the affected run.
3. **Given** general collapse or no observable revision signal, **When** the decision is applied, **Then** Gate C records `stop` and leaves Gate D, calibration, and release claims unauthorized.

### Edge Cases

- A candidate changed type does not occur often enough on both sides of the switch to generate observable contradiction.
- Changed entries cluster in one frequency band and become incomparable with stable controls.
- The solver raises a switch alarm before contradictory evidence is available.
- The solver detects failure but deletes or rewrites most unchanged mappings.
- A mapping appears accurate before the switch only because the source was recognized.
- The solver reaches the end without a switch hypothesis, or publishes multiple incompatible boundaries.
- A reveal is late, out of order, partial, or measured using solver turns rather than the authoritative clock.

## Evidence & Trust Boundaries

**Owning Milestone**: Roadmap Milestone 7, Revision Dynamics (Gate C). It asks whether clock-driven partial re-keying produces selective belief revision rather than indiscriminate failure or restart in the integrated harness.

**End-to-End Contribution**: The completed offline slice supplies the two-regime instance, reveal schedule, streamed solver boundary, checkpoints, scoring, and replay components that Milestones 4–6 integrate into the complete puzzle lifecycle.

**Model Execution Policy**: No admission canary or judged solver call may run until Milestone 6 records a passing offline-harness completion report. After that authorization, freeze the source and stationary profile, switch boundary, minimum segment length, active-on-both-sides eligibility rule, changed token-mass target, frequency strata, matched-control rule, derived seeds, reveal schedule, contradiction threshold, solver instructions and resources, checkpoint cadence, scoring formulas, latency definitions, pass/rework/stop thresholds, environment, and invalidation graph before the judged attempt.

**Completion Evidence**: The offline implementation is covered by deterministic generation, fake-client, scoring, isolation, and replay evidence. The Gate C decision additionally requires one declaration-bound live attempt executed through the completed Milestone 6 harness.

**Trust & Visibility Impact**: Trusted generation and grading know the source, keys, changed/control sets, switch, and contradiction threshold. The solver sees only released cipher chapters, public puzzle policy, allowed local tools, and its own prior work. It receives no oracle, future chapters, switch truth, source identity, credentials, network access, or multi-agent surface.

**Failure Classification**: Incorrect mappings, missed detection, premature alarms, regressions, and restart behavior are solver outcomes. A late trusted reveal may be retryable only under the predeclared policy. Source drift, oracle leakage, out-of-order release, clock disagreement, malformed checkpoints, undeclared access, or score/replay mismatch is an integrity failure and yields no gate result.

**Invalidation Path**: Changing the retained stationary profile reopens the narrow Gate B premise. Changing switch selection, rotation fraction, segment length, reveal cadence, contradiction threshold, solver policy, scoring, or decision thresholds requires a new Gate C declaration and rerun. A Gate C failure blocks Gate D, calibration, and release claims and returns any implicated component to Milestones 4–6 before another judged attempt.

## Requirements

### Functional Requirements

- **FR-001**: The experiment MUST contain exactly one hidden chapter-aligned partial re-key.
- **FR-002**: Each adjacent segment MUST contain at least 10,000 retained word tokens.
- **FR-003**: Every changed type MUST occur at least the predeclared minimum number of times on both sides of the switch.
- **FR-004**: Changed types MUST span declared frequency strata and target a declared fraction of post-switch token mass.
- **FR-005**: Every changed type MUST have a frequency-matched unchanged control when an eligible control exists.
- **FR-006**: The partial re-key MUST preserve a complete bijection, change every selected entry from both its identity and prior mapping, and leave unselected entries unchanged.
- **FR-007**: Chapters MUST be released atomically on one monotonic clock according to a schedule fixed before the run.
- **FR-008**: The reveal schedule MUST be independent of solver turns, token usage, tool calls, and inspection order.
- **FR-009**: The oracle MUST define the first reveal instant at which contradictory changed-entry token mass reaches the predeclared threshold.
- **FR-010**: The solver MUST record ordered mapping hypotheses, confidence, provenance, switch hypotheses, reconstructions, and resource use at every checkpoint.
- **FR-011**: The grader MUST report active-type accuracy separately for changed entries and matched unchanged controls at every checkpoint.
- **FR-012**: The grader MUST report false retractions, premature alarms, switch detection latency, and adaptation latency.
- **FR-013**: A pass MUST require useful pre-switch mappings, localized post-switch deterioration, selective changed-entry recovery, and preservation of stable mappings.
- **FR-014**: A rework MUST name one owning dial and require a new declaration and run.
- **FR-015**: A stop MUST block Gate D, calibration, and release claims when the mechanic causes general collapse or no observable revision signal.
- **FR-016**: A Gate C pass MAY authorize Gate D only after the exact Milestone 6 harness identity is bound into the decision evidence.

### Key Entities

- **Revision Instance**: The retained literary cipher with two regimes and one hidden switch.
- **Changed Entry Set**: Active-on-both-sides plaintext types whose ciphertext images rotate at the switch.
- **Matched Stable Controls**: Unchanged types selected to match the frequency characteristics of changed entries.
- **Reveal Plan**: Chapter-atomic releases and their authoritative monotonic times.
- **Contradiction Threshold**: The oracle-defined reveal event from which detection latency begins.
- **Solver Checkpoint**: One ordered snapshot of mappings, confidence, provenance, reconstruction, switch hypotheses, and usage.
- **Revision Trajectory**: Changed accuracy, unchanged accuracy, false retractions, detection, and adaptation across checkpoints.
- **Gate C Decision**: The declaration-bound pass, rework, stop, or invalid classification.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Rebuilding the frozen revision instance and reveal plan reproduces 100% of declared bytes and digests.
- **SC-002**: Before the contradiction threshold, the solver records a non-empty mapping set whose accuracy exceeds its first checkpoint by at least 10 percentage points.
- **SC-003**: Immediately after sufficient contradictory evidence, stale accuracy on changed entries drops at least 10 percentage points more than accuracy on matched unchanged controls.
- **SC-004**: After correct switch detection, changed-entry accuracy recovers by at least 10 percentage points from its post-threshold minimum.
- **SC-005**: At the final checkpoint, unchanged-control accuracy remains within 5 percentage points of its best pre-switch value.
- **SC-006**: False retractions affect no more than 10% of previously correct matched unchanged controls.
- **SC-007**: The first credited switch hypothesis occurs after the oracle contradiction threshold and before 75% of the post-threshold reveal interval has elapsed.
- **SC-008**: Every reported score, reveal event, trajectory, and decision recomputes from immutable evidence with zero unresolved integrity failures.
- **SC-009**: A passing decision records Gate D authorization for the exact integrated harness and does not claim to authorize construction retroactively.

## Assumptions

- The Gate B qualified pass is sufficient to use the unrecognized-literary stationary profile for this product experiment.
- One agent and one switch are sufficient to decide whether the mechanic produces the intended signal; population and communication effects belong to later work.
- The changed fraction and reveal cadence are calibrated before the judged run without weakening the success criteria afterward.
- Source-recognition assistance invalidates the intended solver observation.
