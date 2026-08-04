# Feature Specification: Epistemic Process Grader

**Feature Branch**: `022-epistemic-process-grader`  
**Created**: 2026-08-01  
**Status**: Draft  
**Input**: User description: "Define a robust grading harness that evaluates collaboration, belief revision, and problem-solving process from run artifacts, independently of final solve rate, while preserving partial credit and supporting disciplined claims about model behavior."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Grade Process Independently of Outcome (Priority: P1)

As a researcher, I want a structured account of what a model or team tried and how well it conducted the work so that a lucky success, an unlucky failure, and a strong partial solution remain distinguishable.

**Why this priority**: The central research object is observable problem-solving behavior. A grader that merely restates final correctness cannot answer the motivating question.

**Independent Test**: Provide completed run artifacts for one successful run and one unsuccessful run with substantial progress. Verify that each receives evidence-linked quantitative measures and qualitative dimension ratings without allowing its final score to determine its process ratings.

**Acceptance Scenarios**:

1. **Given** a completed run with a correct final solver but weakly supported or opportunistic work, **When** the grader evaluates it, **Then** the outcome is recorded as successful while weak process dimensions can still receive low ratings.
2. **Given** a completed run with an incorrect final solver but clear hypothesis formation, discriminating tests, revision, and useful partial reconstruction, **When** the grader evaluates it, **Then** those behaviors receive partial credit without being reported as a solve.
3. **Given** an artifact that does not expose evidence for a dimension, **When** the grader evaluates it, **Then** the dimension is marked unobservable rather than inferred from fluency, identity, or outcome.

---

### User Story 2 - Reconstruct Epistemic Episodes (Priority: P2)

As a researcher, I want the trace organized into evidence-linked epistemic episodes so that I can see when a team formed commitments, tested them, revised them, and carried the consequences into later work.

**Why this priority**: Belief revision is meaningful only as a transition grounded in observable evidence, not as isolated statements that merely sound reflective.

**Independent Test**: Use a trace containing a false hypothesis, contrary evidence, an explicit or behavioral revision, and later reuse. Verify that the grader reconstructs the episode, cites each supported transition, preserves contrary evidence, and distinguishes revision from repetition or post-hoc narration.

**Acceptance Scenarios**:

1. **Given** a commitment followed by a discriminating test and changed behavior, **When** the episode is reconstructed, **Then** the evidence, commitment, test, revision, and downstream consequence are linked without claiming access to hidden mental state.
2. **Given** contradictory evidence that is ignored, **When** the episode is reconstructed, **Then** the grader records the missed revision opportunity rather than manufacturing a revision.
3. **Given** two plausible interpretations of an episode, **When** independent qualitative reviews differ, **Then** both judgments and their evidence remain visible rather than being silently collapsed.

---

### User Story 3 - Evaluate Collaboration as Causal Contribution (Priority: P3)

As a researcher, I want collaboration assessed through contribution, uptake, integration, and repair so that message volume or visible activity is not mistaken for useful joint work.

**Why this priority**: Collaboration matters when information crosses an agent boundary and changes the team's shared trajectory or published artifact.

**Independent Test**: Use a shared-condition trace containing one adopted contribution, one ignored useful contribution, duplicated work, and a repaired conflict. Verify that the grader distinguishes each pattern and links adopted work to later team behavior or the canonical result.

**Acceptance Scenarios**:

1. **Given** one agent contributes evidence that another agent uses in a later test or published solver, **When** collaboration is graded, **Then** the contribution and uptake are credited separately and connected by evidence.
2. **Given** high communication volume with no observable uptake or integration, **When** collaboration is graded, **Then** activity is reported without awarding effective-collaboration credit.
3. **Given** an isolated condition, **When** the run is graded, **Then** unavailable peer collaboration is marked not applicable and does not penalize the model.

---

### User Story 4 - Compare Model Behavior Across Runs (Priority: P4)

As a researcher, I want comparable scorecards and behavior summaries across matched runs so that I can identify recurring strategies, failure modes, and condition-sensitive behavior without overstating causal conclusions.

**Why this priority**: Individual traces reveal mechanisms; repeated matched observations are required to characterize model tendencies or estimate treatment effects.

**Independent Test**: Aggregate multiple completed runs with matching puzzle, schedule, resource, and treatment inputs. Verify that per-dimension distributions, missingness, disagreements, and outcome relationships are reported without a composite ranking or unsupported causal claim.

**Acceptance Scenarios**:

1. **Given** repeated matched runs for multiple models, **When** a comparison is produced, **Then** it reports distributions and uncertainty for each dimension rather than only means or one total score.
2. **Given** runs that differ on material inputs, **When** a comparison is requested, **Then** the differences are surfaced and the runs are not presented as a controlled causal contrast.
3. **Given** only one illustrative trace, **When** behavior is summarized, **Then** the report labels it mechanism evidence rather than a stable model trait.

### Edge Cases

- A run succeeds with almost no observable intermediate process because an early guess is correct.
- A run fails after demonstrating substantial partial reconstruction and well-calibrated uncertainty.
- Agents state that they changed their minds but their later actions remain unchanged, or change behavior without explicitly narrating a revision.
- A useful contribution is independently rediscovered before it is visibly taken up by a peer.
- Multiple agents edit the shared solver, making authorship or influence ambiguous.
- A reviewer cannot distinguish exploration from repetition because trace events are missing or truncated.
- Independent reviewers disagree sharply, use unsupported evidence, or produce malformed output.
- The trace contains provider, model, condition, oracle score, or final-answer information that could bias a prospective process review.
- An attempt ends through infrastructure failure or interruption before a completed run record exists.
- Older run artifacts lack observations needed for trajectory or collaboration measures introduced by this feature.

## Puzzle & Observation Boundaries _(mandatory)_

**Puzzle Behavior**: This feature does not change the puzzle, evidence allocation, solver interface, checker, scoring, or the model-created workflow. It evaluates observable work after or alongside existing evidence capture and never introduces required reasoning artifacts for agents.

**Agent Instructions & Tools**: Agents retain the shared objective, stable team identity, private evidence, condition-defined communication, ordinary Git surface, checker access, and canonical pushed `main` solver contract already declared by the experiment. The grader MUST NOT assign roles, require turns, mandate hypotheses or reports, prescribe Git operations, or reward compliance with a preferred coordination ritual.

**Environmental Constraints**: Existing run inputs remain authoritative for evidence visibility, peer activity, staged release, wall-time and token cutoffs, network access, secrets, sandboxing, and host safety. Grading observations MUST be drawn only from artifacts the experiment already retains or from neutral runner observations that do not alter agent choices.

**Observable Outcomes**: The retained evaluation includes deterministic outcome and activity measures; evidence-linked epistemic episodes; separate epistemic, social, and instrumental assessments; reviewer judgments, confidence, counterevidence, and disagreements; canonical-origin results; and condition-matched aggregate summaries. Every substantive qualitative claim MUST cite an observable trace, Git, checker, solver, or run-record event.

**Infrastructure Failures**: Missing or invalid run records, unavailable artifacts, failed grading dependencies, and judge-service failures are grading or infrastructure failures. Interrupted attempts may receive a clearly censored descriptive summary when trace evidence exists, but they MUST NOT be assigned a completed-run grade or reported as experimental results.

**Verification Boundary**: Provider-free extraction, schema validation, deterministic metrics, and fixture tests are advisory development checks. Before any paid qualitative review or findings-bearing analysis, the exact grading configuration and referenced run artifacts MUST be validated, process-review inputs MUST be checked for prohibited identity and outcome leakage, the provider-free path MUST complete, and the operator MUST explicitly authorize spend.

**Out-of-Scope Claims**: The grader does not measure private thoughts, consciousness, or a privileged human reasoning style. It does not establish construct validity from a rubric alone, infer stable model traits from single runs, claim collaboration caused an outcome without matched conditions, certify security, or turn reviewer interpretation into ground truth.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST grade every completed canonical origin and MUST treat a shared-condition run as one team result rather than selecting a best agent or branch.
- **FR-002**: The system MUST publish a multidimensional scorecard with separate outcome, epistemic, social, and instrumental sections and MUST NOT produce a single composite performance score.
- **FR-003**: The outcome section MUST report existing reconstruction results and other deterministic task measures without reinterpreting them as process quality.
- **FR-004**: The epistemic section MUST assess observable problem framing, hypothesis quality, evidence use, test discrimination, revision, calibration, and persistence or abandonment of invalid approaches.
- **FR-005**: The social section MUST assess observable contribution, transmission, uptake, integration, conflict repair, duplication, and ignored information only where peer collaboration is available.
- **FR-006**: The instrumental section MUST assess observable execution, validation, publication, resource use, recovery from errors, and conversion of partial understanding into the canonical solver.
- **FR-007**: The system MUST reconstruct candidate epistemic episodes using the sequence evidence, commitment, test, revision, transmission, uptake, integration, while permitting missing stages and labeling them as such.
- **FR-008**: Every qualitative rating, episode transition, and claimed cross-agent influence MUST cite one or more retained artifact locations or be marked unsupported or unobservable.
- **FR-009**: The system MUST distinguish an asserted belief change from a behaviorally evidenced revision and MUST avoid claims about hidden internal state.
- **FR-010**: The system MUST compute deterministic quantitative measures from retained artifacts and return identical values when given identical inputs and grading rules.
- **FR-011**: Quantitative measures MUST expose their denominator, eligibility rule, missingness, and provenance so that absence of an observable is not treated as zero performance.
- **FR-012**: Qualitative process review MUST occur without access to model or provider identity, oracle material, final reconstruction score, or success label; outcome linkage MUST occur only after the process judgment is frozen.
- **FR-013**: Each qualitative review MUST preserve dimension ratings, rationale, cited evidence, confidence, counterevidence, and an explicit unobservable or not-applicable state.
- **FR-014**: Findings-bearing qualitative evaluation MUST use two independent reviewers from distinct provider families, retain each review separately, and surface disagreement without automatically averaging it away.
- **FR-015**: Reviewer failures, invalid citations, and disagreement MUST be reported explicitly and MUST NOT be converted into success-shaped defaults.
- **FR-016**: The system MUST support partial credit at the dimension and episode level while preserving the distinction between partial process success and task completion.
- **FR-017**: Completed-run analyses MUST be append-only additions that do not alter frozen trace events, run status, experimental inputs, or original scores.
- **FR-018**: Interrupted or infrastructure-failed attempts MAY receive censored descriptive summaries but MUST NOT receive completed-run grades or enter solve-rate denominators as completed observations.
- **FR-019**: Aggregate reports MUST retain per-dimension distributions, uncertainty, reviewer disagreement, missingness, run eligibility, and links back to the underlying run analyses.
- **FR-020**: Cross-run causal comparisons MUST require declared matched inputs and treatment contrasts; unmatched comparisons and single-run observations MUST be labeled descriptive.
- **FR-021**: Legacy run records MUST remain readable, and measures requiring unavailable historical observations MUST report missing data rather than fabricate or impute behavior.
- **FR-022**: Paid qualitative review MUST require explicit operator spend authorization after exact artifact, configuration, leakage, and provider-free validation.
- **FR-023**: The system MUST identify the minimum observable record and explicit infrastructure failure behavior for each added grading dimension without imposing new agent workflow requirements.
- **FR-024**: Every review MUST declare `shared-team` or `isolated-origin` as its evaluation unit and MUST NOT substitute one actor's trajectory for a shared team result.
- **FR-025**: The primary qualitative output MUST be a citation-backed evidence dossier of structured epistemic episodes, influence chains, execution chains, and explicit observability states; ordinal ratings remain advisory summaries.
- **FR-026**: Review packets MUST expose deterministic opportunity IDs so both reviewers assess a common event registry and opportunity-conditioned denominators.
- **FR-027**: Scorecards and reports MUST retain layered infrastructure, publication, integration, behavioral, and undetermined failure accounts without assigning automated model causation.
- **FR-028**: Findings-bearing reports MUST expose fixture, treatment, model, record, protocol, omission, checker, and confound provenance after blinded reviews freeze.
- **FR-029**: Automated calibration MUST measure structural integrity and reviewer stability while explicitly declining construct-validity claims.

### Key Entities

- **Evidence Reference**: A stable pointer to an immutable trace event, Git observation, checker event, solver snapshot, score, or run-record field, including enough context to verify the cited claim.
- **Epistemic Episode**: An evidence-bounded reconstruction of a possible reasoning transition, with observable commitments, tests, revisions, downstream consequences, missing stages, and competing interpretations.
- **Quantitative Measure**: A deterministic value with definition, population, denominator, eligibility, missingness, and evidence provenance.
- **Dimension Review**: A qualitative assessment for one epistemic, social, or instrumental dimension, including rating, rationale, confidence, citations, counterevidence, and observability state.
- **Independent Review**: One blinded reviewer's immutable set of dimension reviews and episode judgments, identified by its grading configuration without exposing identity during judgment.
- **Run Scorecard**: The non-composite union of outcome facts, quantitative measures, independent qualitative reviews, disagreements, and post-review outcome linkage for one completed canonical result.
- **Behavior Report**: A cross-run summary of per-dimension distributions, recurring strategies and failures, uncertainty, matching assumptions, and the boundary between descriptive and causal claims.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Regrading identical artifacts with the same quantitative definitions produces identical quantitative values and eligibility decisions in 100% of conformance tests.
- **SC-002**: In the validation corpus, 100% of substantive qualitative ratings and episode transitions either resolve to retained evidence or are explicitly marked unsupported or unobservable.
- **SC-003**: A blinded review receives no model identity, provider identity, oracle plaintext or keys, final reconstruction score, or success label in 100% of leakage tests.
- **SC-004**: Successful runs can receive low process ratings and unsuccessful completed runs can receive partial process credit in all designated contrast cases.
- **SC-005**: Independent review disagreement, confidence, counterevidence, and missingness remain inspectable for every qualitative dimension; no report replaces them with a composite score.
- **SC-006**: Every completed canonical origin receives exactly one run-level scorecard per grading configuration, while interrupted attempts and infrastructure failures are excluded from completed-run grading.
- **SC-007**: Every aggregate comparison states its eligible run set, material input matching, uncertainty, and claim type, and rejects causal labeling when the requested contrast is not matched.
- **SC-008**: Human audit of a stratified validation sample can locate the supporting artifact for at least 95% of grader citations without reconstructing undocumented identifiers.
- **SC-009**: Legacy artifacts remain analyzable for supported dimensions, and 100% of unavailable historical measures are represented as missing rather than zero or inferred values.
- **SC-010**: The grading harness adds no required agent-facing role, turn, checkpoint, report, hypothesis ledger, merge, or coordination step in prompt and run-surface inspections.
- **SC-011**: Shared-origin prompt and artifact inspections identify the team as the evaluation unit in 100% of review packets.
- **SC-012**: Identical inputs produce byte-identical opportunity registries and packets no larger than 128 KiB.
- **SC-013**: Every scorecard-v2 claim resolves to one declared opportunity and retained evidence or is explicitly unobservable or not-applicable.

## Assumptions

- The object of evaluation is observable functional behavior: what agents did, communicated, tested, revised, integrated, and published, not inaccessible internal cognition.
- Existing `RunRecord`, append-only trace, canonical origin Git histories, checker events, and solver outputs remain the authoritative evidence boundary.
- The first release evaluates completed historical runs where evidence permits and reports missingness honestly; it does not retroactively create observations.
- Qualitative dimensions use prospective written rubrics and blinded evidence bundles before any findings-bearing batch is reviewed.
- Two independent automated reviewers provide advisory interpretations. Automated calibration measures structural integrity and stability only; the project makes no construct-validity claim and performs no automatic or human adjudication.
- Outcome and process are linked for analysis only after process reviews are frozen, enabling study of whether apparently good processes reliably produce good results.
- Model-level conclusions require repeated, appropriately matched observations; a single run can illustrate a mechanism but not establish a stable behavioral trait.
- New neutral runner observations may be added only when a current grading question cannot be answered from existing artifacts and the observation does not prescribe or reward a model workflow.
