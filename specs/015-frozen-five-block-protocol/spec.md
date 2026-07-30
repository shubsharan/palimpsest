# Feature Specification: Frozen Five-Block Protocol

**Feature Branch**: `feature/015-frozen-five-block-protocol` **Created**: 2026-07-28 **Status**: Implemented **Input**: Freeze one five-block, four-condition study protocol with balanced validation order, a calibration design receipt, explicit infrastructure-failure replacement lineage, provider-free acceptance, and declared token and monetary ceilings.

## User Scenarios & Testing

### User Story 1 - Freeze The Study Design (Priority: P1)

As a researcher, I can prepare one strict study manifest and receive a design receipt before calibration attempts begin, so the puzzle builds, model assignment, condition orders, prompts, scoring, rubric, and failure rules used for validation are recoverable and cannot drift silently.

**Why this priority**: A validation result is interpretable only if its scientific design is bound before calibration behavior can influence later choices.

**Independent Test**: Resolve the manifest, prepare all five deterministic paired builds, write the design receipt before any model session opens, and prove that every scientific-field mutation is rejected while only the declared operational budget fields can change with an explicit adjustment record.

**Acceptance Scenarios**:

1. **Given** a valid manifest and no study root, **When** calibration begins, **Then** all five paired builds are prepared and one immutable design receipt is published before the first attempt.
2. **Given** a completed calibration, **When** validation uses the same manifest and receipt, **Then** the receipt-bound builds, model assignment, condition orders, prompt/scoring boundary, rubric, ceilings, and failure rules are accepted.
3. **Given** a manifest that changes a frozen field, **When** validation begins, **Then** it fails before a validation attempt or provider call.
4. **Given** a change only to a predeclared calibration-adjustable per-agent token budget or per-attempt monetary authorization ceiling, **When** validation begins, **Then** the before/after value and manifest digest are recorded and the immutable design still matches.

---

### User Story 2 - Execute Calibration And Validation (Priority: P2)

As a researcher, I can select calibration or validation and have the runner expand the correct block-condition cells sequentially in the frozen order without manually assembling attempts.

**Why this priority**: One deterministic expansion prevents order drift while retaining the existing simple local build, run, freeze, overlap, and explicit evaluation boundaries.

**Independent Test**: Use a provider-free durable-attempt fixture to execute calibration as four attempts on the calibration block, then validation as sixteen attempts on the four validation blocks, and verify every phase, block, condition, order position, build, protocol, and design identity. Pair it with the retained fake-clock one-attempt acceptance to verify the unchanged three-session runtime.

**Acceptance Scenarios**:

1. **Given** the calibration phase, **When** it runs, **Then** the calibration block executes `CS`, `CR`, `IR`, and `IS` sequentially.
2. **Given** the validation phase, **When** it runs, **Then** its four blocks use, in order, `CS CR IR IS`; `CR IS CS IR`; `IS IR CR CS`; and `IR CS IS CR`.
3. **Given** any phase, **When** one attempt is active, **Then** no other attempt is active, while the three sessions inside that attempt remain concurrent.
4. **Given** a standalone paired build, **When** one canonical condition is selected, **Then** `puzzle:run` executes that condition with the same fixed assignment and frozen protocol inputs without expanding a phase.
5. **Given** a provider-backed phase, **When** no current clean receipt-bound preflight matches the source and sandbox, **Then** no provider session begins.

---

### User Story 3 - Preserve And Replace Infrastructure Failures (Priority: P3)

As a researcher, I can preserve a frozen infrastructure-failure attempt, stop the phase, and explicitly append one cited replacement without converting model outcomes into retryable failures.

**Why this priority**: Infrastructure can fail during a long local study, but silent retries or selective replacement would compromise the observational record.

**Independent Test**: Freeze an attempt with an eligible infrastructure classification, confirm the phase stops nonzero, append an explicitly cited replacement, and reject automatic, duplicate, missing, non-frozen, or model-outcome replacements.

**Acceptance Scenarios**:

1. **Given** a frozen attempt classified under the manifest's infrastructure-failure policy, **When** it is indexed, **Then** the phase stops nonzero and retains the attempt unchanged.
2. **Given** that failed attempt, **When** the researcher explicitly cites it for replacement, **Then** one new attempt is appended with immutable lineage and the original remains unchanged.
3. **Given** an unsuccessful reconstruction, early stop, no Git use, conflict, low score, or other model outcome, **When** replacement is requested, **Then** the request is rejected before execution.
4. **Given** a cited attempt already replaced, not frozen, outside the selected phase, or absent from the phase index, **When** replacement is requested, **Then** no attempt is launched.
5. **Given** an eligible successful replacement, **When** the phase is invoked again, **Then** it continues with the next unstarted planned cell and never relaunches the cited cell automatically.

### Edge Cases

- The manifest omits or reorders a block, condition, model assignment, release offset, failure-policy value, ceiling, scoring identifier, or rubric digest.
- A validation phase is requested before calibration completes or against a different study root.
- Prepared build bytes or identities no longer match the calibration design receipt.
- An adjustable budget exceeds its receipt-bound study-wide token or monetary ceiling.
- A phase is invoked after some planned cells are already durably indexed.
- A failure occurs before any frozen attempt can be published.
- A replacement itself has an infrastructure failure.
- A phase reaches a declared total ceiling before launching its next cell.

## Puzzle & Observation Boundaries

**Puzzle Behavior**: The same three-agent word-substitution puzzle runs once per block-condition cell. Calibration has one block and four cells; validation has four blocks and sixteen cells. Condition selection still determines only native peer communication and stationary or re-key evidence. Neither phase nor order prescribes how agents solve.

**Agent Instructions & Tools**: Every attempt reuses the Feature 014 prompt, team identity, word-substitution objective, identical neutral scaffold, model-chosen unmetered Git, private staged evidence, target-excluded references, local commands, published-main checker, activity wait, and requested final response. Only `origin/main:solver.py` is checkable and gradeable. Phase, block order, design receipt, ceilings, rubric, replacement eligibility, and other cells are trusted operator inputs and are not added to the agent prompt.

**Environmental Constraints**: Every cell retains exactly three agents, six releases at 0, 5, 10, 20, 30, and 40 minutes, a 60-minute cutoff, the condition-native Git topology, no public sandbox network, no provider credentials in model workspaces, and one explicit per-agent token budget. Validation uses receipt-bound puzzle builds and permits only recorded changes to the manifest-declared operational budget fields within immutable total ceilings.

**Observable Outcomes**: Study, phase, and attempt records retain block and condition order, design and protocol digests, model bindings, usage, authorized monetary ceiling, replacement lineage, infrastructure classification, sessions, traces, native frozen Git, overlap, reviewer selection, and deterministic score. Calibration adjustments are recorded as before/after values. Model behavior remains untouched and unaggregated.

**Infrastructure Failures**: Configuration, credential preflight, missing or mismatched design receipt, receipt-bound build drift, provider/session infrastructure state, sandbox, timer, stage publication, Git, trace, freeze, artifact, ceiling, overlap, or evaluation infrastructure can fail explicitly. Only a strict frozen attempt classified `session-infrastructure-error` is eligible for an appended replacement. Pre-freeze failures block that study root without relaunch, while post-publication overlap or evaluation failures are repaired against the same attempt rather than used to repeat model behavior.

**Verification Boundary**: A provider-free coordinator fixture verifies all twenty cells, receipt freeze, adjustment rules, ceiling arithmetic, replacement eligibility, and records. The retained fixture-adapter/fake-clock attempt and real local Git/Docker tests separately verify the unchanged concurrent session, freeze, overlap, and scoring path. Together they require no billable calls. Advisory checks remain non-authorizing. Every future provider-backed phase still requires the existing clean receipt-bound preflight and retains the tested source revision and sandbox identity.

**Out-of-Scope Claims**: The protocol does not automate behavioral review, rubric application, statistical aggregation, provider-price truth, retries, result selection, post-hoc merging, or benchmark claims. Declared monetary ceilings are operator authorization records, not a claim that provider invoices can be predicted or stopped exactly.

## Requirements

### Functional Requirements

- **FR-001**: The runner MUST accept one strict schema-version-2 study manifest and MUST reject schema version 1, its obsolete `runs` shape, unknown fields, aliases, and compatibility inputs.
- **FR-002**: The manifest MUST declare exactly the five registered blocks, with `calibration-theron-ware` as calibration and the four registered validation blocks in their fixed order.
- **FR-003**: The manifest MUST declare exactly three ordered agent-to-model assignments and MUST use that same assignment for every cell.
- **FR-004**: The manifest MUST declare the existing direct provider connections and model profiles without retaining literal credentials.
- **FR-005**: The manifest MUST declare the exact six release offsets, 60-minute cutoff, per-agent token budget, per-attempt monetary authorization ceiling, study-wide token ceiling, and study-wide monetary ceiling.
- **FR-006**: The sum of maximum authorized cell tokens and monetary ceilings MUST remain within the frozen study-wide ceilings before a phase launches.
- **FR-007**: The manifest MUST declare calibration order `CS CR IR IS` and the four validation orders `CS CR IR IS`, `CR IS CS IR`, `IS IR CR CS`, and `IR CS IS CR` paired to the validation blocks in declaration order.
- **FR-008**: The manifest MUST declare one deterministic reconstruction-scoring boundary, one versioned rubric file plus digest, and the explicit reviewer workspace-selection boundary; the solver command and output path remain canonical rather than reviewer-selected.
- **FR-009**: The manifest MUST declare a failure policy that stops on a frozen `session-infrastructure-error`, forbids automatic retry, and permits only explicit appended replacement of the cited attempt.
- **FR-010**: The manifest MUST restrict calibration-adjustable fields to the per-agent token budget and per-attempt monetary authorization ceiling; schedules, total ceilings, and every scientific field MUST remain immutable.
- **FR-011**: Calibration MUST prepare and validate all five paired builds before writing the design receipt.
- **FR-012**: Calibration MUST atomically publish the design receipt before opening the first model session.
- **FR-013**: The design receipt MUST bind the complete immutable manifest projection, rubric bytes, complete canonical tree seals for all five build roots, prompt snapshots, scoring boundary, model assignment, condition orders, failure rules, sandbox policy, and total ceilings with deterministic digests.
- **FR-014**: Every study launch MUST require the matching design receipt, phase prerequisites, and an unchanged canonical tree seal for the selected build immediately before reservation or provider work and again immediately before durable attempt publication; validation MUST additionally require the completed calibration index.
- **FR-015**: Validation MUST reject immutable drift and MUST record every permitted adjustable-field change with its original value, resolved value, prior manifest digest, and current manifest digest.
- **FR-016**: `puzzle:experiment --phase calibration` MUST expand exactly four sequential cells for the calibration block.
- **FR-017**: `puzzle:experiment --phase validation` MUST expand exactly sixteen sequential cells across the four validation blocks in the declared balanced orders.
- **FR-018**: `puzzle:run --condition` MUST continue to run one canonical condition against an explicitly supplied paired build without phase expansion.
- **FR-019**: Planned cells MUST execute sequentially under one exclusive local coordinator per phase and MUST retain concurrent three-session behavior only inside each attempt.
- **FR-020**: Phase invocation MUST read its durable index, skip already completed planned cells without relaunching them, and refuse to pass an unresolved infrastructure-failure cell.
- **FR-021**: Every attempt summary MUST record standalone or study-phase provenance, block, canonical condition, protocol digest, complete selected-build and frozen-Git tree seals, monetary authorization ceiling, infrastructure classification, and optional replacement lineage; calibration, validation, and replacement attempts MUST additionally record condition-order position and design digest.
- **FR-022**: Every phase summary MUST record its manifest digests, design digest, ordered planned cells, durable attempts, adjustments, cumulative token usage, cumulative authorized monetary ceiling, completion state, and failure state.
- **FR-023**: A session-infrastructure-failure attempt MUST be frozen and indexed before the phase stops nonzero; a pre-freeze failure MUST leave an unresolved reservation and MUST NOT be relaunched in the same study root.
- **FR-024**: A replacement MUST require an explicit cited attempt ID, MUST inherit its block, condition, phase, order position, design identity, assignment, and budgets, and MUST append a new immutable attempt with `replacementOfAttemptId`.
- **FR-025**: The runner MUST reject replacement of a model outcome, absent attempt, non-frozen attempt, other-phase attempt, successful attempt, or already replaced attempt before execution.
- **FR-026**: The runner MUST NOT retry automatically, overwrite an attempt, merge model work, choose a result, apply the behavioral rubric, or aggregate reconstruction outcomes.
- **FR-027**: Provider-backed run and phase commands MUST require the existing current clean receipt-bound preflight before a provider session begins.
- **FR-028**: Provider-free acceptance MUST exercise the complete five-block by four-condition protocol with fixture adapters and fake clocks and MUST make no provider request.
- **FR-029**: Configuration, design receipt, attempt, phase, and replacement decoders MUST reject missing, inconsistent, unsupported, secret-bearing, or lineage-invalid records.
- **FR-030**: `puzzle:build --block`, manual `puzzle:evaluate`, deterministic scoring, checker behavior, native Git topology, overlap observation, sandbox isolation, and durable publication before optional observation MUST remain intact.

### Key Entities

- **Study Manifest**: The sole strict declaration of blocks, assignment, treatment orders, schedule, budgets, ceilings, provider/model references, scoring, rubric, adjustable fields, and failure rules.
- **Design Receipt**: The calibration-time immutable binding over the manifest's scientific projection, rubric, paired builds, prompts, scoring, sandbox policy, and total ceilings.
- **Phase Plan**: The ordered calibration or validation cells derived from the manifest.
- **Phase Summary**: The append-safe index of planned cells, durable attempts, adjustments, resource accounting, completion, and failure.
- **Planned Cell**: One immutable block-condition position in a phase.
- **Replacement Attempt**: One explicitly appended attempt that cites an eligible frozen infrastructure-failure attempt while inheriting its treatment inputs.

## Success Criteria

### Measurable Outcomes

- **SC-001**: One valid manifest resolves to exactly five blocks, three fixed agent assignments, four calibration cells, sixteen validation cells, and twenty total block-condition cells.
- **SC-002**: All schema-version-1, unknown-field, order-drift, schedule-drift, assignment-drift, rubric-drift, failure-policy-drift, secret-bearing, and ceiling-overflow fixtures fail before an attempt starts.
- **SC-003**: The design receipt is durably present and decodable before the first calibration session event and binds every byte, path, symlink target, and executable bit under all five deterministic build roots plus the immutable study design.
- **SC-004**: Validation accepts 100% of changes limited to declared adjustable budget fields within total ceilings and rejects 100% of tested immutable-field changes before execution.
- **SC-005**: Provider-free calibration produces four ordered durable attempts and provider-free validation produces sixteen ordered durable attempts using the four declared balanced validation sequences.
- **SC-006**: Every successful phase contains no overlapping attempts, while every attempt still contains exactly three concurrent sessions.
- **SC-007**: Every indexed attempt round-trips with its phase, position, design/protocol identities, treatment, resource authorization, infrastructure classification, and replacement lineage.
- **SC-008**: Every tested eligible infrastructure failure stops nonzero and can receive one explicitly cited appended replacement; every tested model outcome or invalid lineage receives zero replacement attempts.
- **SC-009**: A resumed phase launches zero already indexed cells and proceeds only after every earlier infrastructure-failure cell has an eligible successful replacement.
- **SC-010**: The complete provider-free twenty-cell coordinator, retained fake-clock attempt runtime, strict negative cases, replacement policy, prompt snapshots, focused suites, full repository verification, clean-checkout preflight, and diff check pass without a live provider call.

## Assumptions

- Feature 013's five catalog entries and deterministic schema-version-3 paired builds are the only study blocks.
- Feature 014's four condition mappings, prompts, schedule constants, native Git topologies, attempt durability, overlap, and explicit evaluation are preserved rather than reimplemented.
- Calibration uses the first balanced sequence, `CS CR IR IS`.
- Calibration prepares all five builds so the design receipt can bind actual allocation and manipulation artifacts before model behavior is observed.
- The only adjustable operational fields are one uniform per-agent token budget and one uniform per-attempt monetary authorization ceiling; immutable total ceilings still bound both.
- Declared monetary ceilings are authorization and provenance values. Provider billing remains an external fact and is not inferred from model usage.
- A phase can be resumed from its durable index, but a recorded planned cell is never relaunched; an eligible replacement is always a separate explicit command and artifact.
- Validation requires a completed calibration phase in the same study root.
- Study artifacts are protected against accidental or out-of-band local drift, not against a trusted operator coherently rewriting artifacts and their embedded seals; signatures, immutable storage, and an external transparency service remain out of scope.
- The frozen rubric is retained for later human or automated review but is not applied by this feature.
- No live model call, paid calibration, automated review, outcome aggregation, statistical analysis, service, database, account, dashboard, retry engine, compatibility layer, or benchmark claim is in scope.
