# Feature Specification: Blind Calibration and Team-Level Evaluation

**Feature Branch**: `020-blind-team-evaluation` **Created**: 2026-07-31 **Status**: Draft **Input**: Redesign checking, evaluation, diagnostics, block validity, and behavior records, then run one fresh four-cell GPT-5.6-sol calibration.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Check Published Solvers Without Correctness Feedback (Priority: P1)

As a researcher, I can let an agent validate that its published solver executes and covers the visible ciphertext without disclosing whether any reconstructed word is correct.

**Why this priority**: Correctness feedback changes model work and can turn the checker into an oracle. Blind feedback is the central experimental boundary for the next calibration.

**Independent Test**: Check correct and incorrect published outputs with the same length and prove that both receive identical successful feedback containing only the captured final commit, execution validity, output validity, word counts, and bounded coverage.

**Acceptance Scenarios**:

1. **Given** two runnable published solvers whose outputs have the same valid length but different correctness, **When** each solver is checked, **Then** the returned feedback is identical apart from captured commit identity.
2. **Given** a solver that is missing, empty, malformed, oversized, timed out, or incomplete, **When** it is checked, **Then** it receives an explicit non-correctness terminal result.
3. **Given** any checker call, **When** its execution path and result are inspected, **Then** no oracle plaintext, checker truth, matched count, accuracy, correctness delta, mismatch location, or other oracle-derived value was opened or returned.
4. **Given** an agent uses the checker repeatedly, **When** the attempt is frozen, **Then** every call and result remains visible in the trace as model behavior.

---

### User Story 2 - Evaluate Every Canonical Team Artifact (Priority: P1)

As a researcher, I can evaluate every final canonical origin without choosing a reviewer workspace, repairing model work, or manufacturing an integrated submission.

**Why this priority**: Selecting one workspace hides team outcomes in isolated conditions and introduces reviewer discretion after model work has ended.

**Independent Test**: Freeze one shared-condition attempt and one isolated-condition attempt, then verify that evaluation produces exactly one terminal origin result for the shared attempt and exactly three independent terminal origin results for the isolated attempt.

**Acceptance Scenarios**:

1. **Given** a shared condition, **When** evaluation begins after freeze, **Then** the one frozen shared origin's literal final `refs/heads/main` is evaluated once and recorded as the realized team product.
2. **Given** an isolated condition, **When** evaluation begins after freeze, **Then** all three frozen private origins' literal final `refs/heads/main` values are evaluated independently and no integrated team product is recorded.
3. **Given** multiple evaluated final origins, **When** the collective ceiling is computed, **Then** it selects the best observed origin result at each position for analysis without creating or publishing a synthetic reconstruction.
4. **Given** a realized product and a meaningful multi-origin collective ceiling, **When** diagnostics are finalized, **Then** the integration gap is recorded; otherwise it is `null` with an explicit reason.
5. **Given** an evaluation request containing a workspace, notes, alternate command, or alternate output path, **When** it is validated, **Then** it is rejected before scoring.

---

### User Story 3 - Inspect Diagnostic Rather Than Opaque Outcomes (Priority: P1)

As a researcher, I can inspect where each canonical artifact succeeded across time, evidence ownership, and manipulation type while retaining the existing aggregate score.

**Why this priority**: An aggregate score alone cannot distinguish specialist evidence use, sentinel retention, late revision, missing output, or integration.

**Independent Test**: Score synthetic reconstructions covering pre-boundary and post-boundary regions, changed and stable-control words, sentinel and specialist evidence, every stage and evidence owner, every changed type, and missing and extra output tokens.

**Acceptance Scenarios**:

1. **Given** a scored origin, **When** diagnostics are generated, **Then** they include overall, pre-boundary, and post-boundary accuracy.
2. **Given** changed positions and matched stable controls, **When** diagnostics are generated, **Then** before-boundary and after-boundary accuracy is reported separately for both groups.
3. **Given** sentinel and specialist positions, **When** diagnostics are generated, **Then** their before-boundary and after-boundary accuracy is reported separately.
4. **Given** staged evidence with owners and changed types, **When** diagnostics are generated, **Then** every stage, evidence owner, and changed type has an explicit result and changed-type macro accuracy is reported.
5. **Given** missing or extra reconstruction tokens, **When** scoring completes, **Then** coverage and positional handling are explicit and deterministic rather than silently truncating or padding the result.
6. **Given** an active model session, **When** it has not yet frozen, **Then** no diagnostic or oracle-derived score is visible to an agent.

---

### User Story 4 - Build Or Reject Any Supplied Text (Priority: P2)

As a researcher, I can give the puzzle builder any local UTF-8 prose file and receive either one sealed, runnable puzzle or an explicit rejection from the same command.

**Why this priority**: The new instrument is not credible if specialist evidence falls back to a weak allocation or stable controls are incomplete or poorly matched.

**Independent Test**: Build an eligible unregistered plain-text file twice and compare every byte, then submit malformed, short, and scientifically infeasible files and prove that each exits nonzero without publishing output.

**Acceptance Scenarios**:

1. **Given** a candidate build, **When** validity is assessed, **Then** specialist evidence geometry and stable-control quality are represented by separate evidence and control tiers.
2. **Given** a paid calibration block, **When** it is accepted, **Then** its evidence tier is at least balanced, its stable controls are complete, and its control tier is explicitly recorded.
3. **Given** a target source, **When** candidate selection runs, **Then** it begins after the first 20 percent of canonical paragraphs and selects the first 16,000-to-20,000-word window satisfying the phase gate.
4. **Given** no qualifying window within the bounded search, **When** the build command ends, **Then** it exits nonzero and publishes no partial build rather than accepting a fallback or weakened gate.
5. **Given** any eligible local source, **When** it is built, **Then** source identity and seed are derived deterministically from the supplied bytes and retained in the sealed manifest.
6. **Given** ordinary UTF-8 prose, Gutenberg text, or Gutenberg HTML, **When** it is supplied, **Then** the same command normalizes it into candidate paragraphs without a separate discover, promote, or pin workflow.

---

### User Story 5 - Run One Fresh Calibration and Stop (Priority: P2)

As a researcher, I can run the redesigned instrument once across all four communication and evidence cells and automatically evaluate every final origin.

**Why this priority**: The instrument needs fresh empirical calibration evidence before any separate follow-up study is designed.

**Independent Test**: From the exact clean verified revision, create a fresh immutable study root and complete `CS`, `CR`, `IR`, and `IS` sequentially on `calibration-odd-women`, producing terminal evaluation, diagnostic, behavior, resource, and provenance records for every cell.

**Acceptance Scenarios**:

1. **Given** a clean receipt-bound preflight and the existing approved credential, **When** calibration starts, **Then** a fresh study root and immutable design receipt are created before the first provider session.
2. **Given** the calibration manifest, **When** all four cells run, **Then** each uses three GPT-5.6-sol agents at medium reasoning, releases at 0, 5, 10, 20, 30, and 40 minutes, and stops at 60 minutes without a cumulative token cutoff.
3. **Given** the communication treatment, **When** a shared cell runs, **Then** the ordinary team channel and shared Git condition are available; when an isolated cell runs, neither peer communication nor peer evidence is exposed.
4. **Given** any completed attempt, **When** it freezes, **Then** every canonical origin receives an explicit terminal evaluation outcome and diagnostic and behavior-review records are generated automatically.
5. **Given** the four-cell calibration has terminated, **When** the coordinator completes `IS`, **Then** the study is complete.

### Edge Cases

- A checker output has the right word count but entirely wrong content.
- A solver publishes a non-regular `main` ref, leaves `main` unborn, or changes other refs after the captured commit.
- One isolated origin is missing, malformed, timed out, or incomplete while the other two are scoreable.
- The collective ceiling has only one scoreable origin, or a shared condition has no meaningful multi-origin comparison.
- Diagnostic denominators are empty for a region, stage, owner, or changed type.
- Output has fewer or more positional tokens than the ciphertext.
- Stable controls are incomplete even though an evidence tier is balanced.
- An allocation records a fallback, has an absent tier, or contradicts its sealed manipulation records.
- A source-recognition statement is indirect, repeated, or appears before the first explicit recognition event.
- A provider response contains an empty reasoning summary.
- A completed calibration cell is inaccurate, shows no collaboration or revision, fails to integrate peer work, or exhausts the one-hour clock.
- An infrastructure failure occurs before durable publication or leaves one canonical origin without a terminal evaluation outcome.
- Total calibration authorization would exceed four attempts at the existing $10 per-attempt ceiling.

## Puzzle & Observation Boundaries _(mandatory)_

**Puzzle Behavior**: Three agents reconstruct one staged word-substitution puzzle per condition. Checking validates only the published solver's execution, output validity, and plaintext-independent word coverage. The runner does not expose correctness until all model work and canonical origins are frozen.

**Agent Instructions & Tools**: Every agent receives the same shared objective, stable team identity, evidence schedule, one-hour clock, no token cutoff, ordinary local tools, model-chosen unmetered Git, and `check_published_solver`. Shared conditions expose ordinary peer Git and the team channel; isolated conditions expose usable private Git without peer evidence or activity. Agents are not assigned roles, turns, reports, a merge procedure, consensus rules, checker-call limits, or a required coordination workflow.

**Environmental Constraints**: Private staged evidence remains outside agent-visible repositories. Only condition-defined communication differs across paired cells. Model workspaces have no oracle plaintext, checker truth, public sandbox network, or provider credentials. The host captures each assigned origin's literal final `refs/heads/main` and never repairs, merges, ranks, or selects model artifacts.

**Observable Outcomes**: Frozen traces retain checker calls and runnability-only results, communication and Git use, cross-agent integration, negative interference and conflict recovery, explicit belief revisions and downstream effects, source-recognition evidence and first explicit recognition time, resource use, returned reasoning-summary coverage, final artifact provenance, aggregate scores, origin-level diagnostics, team product status, collective ceiling, and nullable integration gap.

**Infrastructure Failures**: Invalid or drifted configuration, inadequate block validity, missing credentials, stale preflight, provider or sandbox failure, release or timer failure, trace failure, Git freeze or publication failure, and evaluation infrastructure failure remain distinct from low accuracy, missing integration, conflict, no checker use, source recognition, early completion, or other model outcomes.

**Verification Boundary**: Provider-free acceptance, the full offline four-condition fixture, advisory local CI, repository verification, and a clean receipt-bound preflight must pass on the exact committed revision before paid work. The preflight receipt binds that revision and precise runnable sandbox image to the calibration artifacts. A provider response alone is not a completed or scored result.

**Out-of-Scope Claims**: Calibration does not validate the construct, eliminate source recognition, prove hidden reasoning, require successful collaboration or revision, establish security against a hostile operator, rank or repair origins, create a synthetic team reconstruction, or authorize validation. Natural public-domain prose remains the construct; private prose and a separate recognition factor are excluded.

## Requirements _(mandatory)_

### Functional Requirements

#### Blind Checking

- **FR-001**: `check_published_solver` MUST use the feedback contract `published-runnability-coverage-v1`.
- **FR-002**: A successful checker result MUST contain only the captured literal `refs/heads/main` commit, execution status, output-validity status, ciphertext word count, output word count, and bounded word coverage.
- **FR-003**: Checker feedback MUST NOT contain or derive matched-word count, accuracy, correctness delta, mismatch location, plaintext content, key content, or any other oracle-derived value.
- **FR-004**: Word coverage MUST be computed without opening oracle plaintext or checker truth.
- **FR-005**: Correct and incorrect outputs with the same valid length and execution behavior MUST receive identical feedback except for captured commit identity.
- **FR-006**: The checker MUST produce explicit, deterministic results for valid, missing, empty, malformed, oversized, timed-out, and incomplete solver outputs.
- **FR-007**: Every checker call and returned result MUST remain in the agent-observable trace.

#### Canonical Evaluation and Diagnostics

- **FR-008**: Evaluation MUST use policy `all-canonical-main-snapshots-v1` and MUST NOT accept reviewer workspace selection, notes, alternate commands, or alternate output paths.
- **FR-009**: Shared conditions MUST capture and evaluate the one frozen shared origin's literal final `refs/heads/main` exactly once.
- **FR-010**: Isolated conditions MUST capture and independently evaluate all three frozen private origins' literal final `refs/heads/main` values.
- **FR-011**: Evaluation MUST NOT repair, merge, rank, choose, or substitute any final origin.
- **FR-012**: The shared origin result MUST be recorded as the realized team product for `CS` and `CR`; `IS` and `IR` MUST explicitly record that no integrated team product exists.
- **FR-013**: Evaluation MUST compute a position-wise collective ceiling over scoreable evaluated final origins without constructing or publishing a synthetic reconstruction.
- **FR-014**: Integration gap MUST be recorded only when a realized team product and a meaningful multi-origin ceiling both exist; all other cases MUST store `null` and an explicit reason.
- **FR-015**: Every canonical origin MUST receive an explicit terminal evaluation outcome even when its solver cannot be scored.
- **FR-016**: The existing `normalized-positional-word-v1` aggregate metric MUST remain the primary metric.
- **FR-017**: Every scored origin MUST also receive `palimpsest-diagnostics-v1`.
- **FR-018**: Diagnostics MUST report overall, pre-boundary, and post-boundary accuracy.
- **FR-019**: Diagnostics MUST separately report changed-position and matched-control accuracy before and after the boundary.
- **FR-020**: Diagnostics MUST separately report sentinel and specialist accuracy before and after the boundary.
- **FR-021**: Diagnostics MUST report results for every stage, evidence owner, and changed type plus macro changed-type accuracy.
- **FR-022**: Diagnostics MUST record output coverage and deterministic positional handling for missing and extra output tokens.
- **FR-023**: Diagnostics and oracle-derived evaluation MUST occur only after origins are frozen and MUST remain invisible to agents.

#### Source Validation and Sealing

- **FR-024**: Build validity MUST represent `evidenceTier` separately from `controlTier`.
- **FR-025**: `evidenceTier` MUST summarize specialist ownership, occurrences, solo coverage, and stage and region balance.
- **FR-026**: `controlTier` MUST summarize stable-control completeness and matching distance.
- **FR-027**: A paid calibration block MUST have `evidenceTier` of at least balanced, complete controls, and an explicitly recorded control tier.
- **FR-028**: The active study MUST contain exactly one calibration block and the order `CS`, `CR`, `IR`, `IS`.
- **FR-029**: Provider-backed preparation MUST reject an evidence fallback before credentials are read or model adapters are created.
- **FR-030**: `puzzle:build` MUST accept a local source path directly with no registry, discovery, or manual promotion step.
- **FR-031**: The builder MUST accept valid UTF-8 ordinary prose, Gutenberg text, and Gutenberg HTML and MUST reject empty, non-UTF-8, structurally insufficient, or scientifically infeasible input explicitly.
- **FR-032**: Source identity and seed MUST be derived deterministically from the supplied bytes; the sealed build MUST retain the source digest and selected window.
- **FR-033**: For each target, candidate inspection MUST begin after the first 20 percent of canonical paragraphs and select the first 16,000-to-20,000-word window satisfying its phase-specific gate.
- **FR-034**: Candidate search MUST remain deterministic and bounded; absence of a qualifying window MUST stop the workflow before paid work rather than weaken a gate.
- **FR-035**: Every sealed block MUST retain its source digest, seed, selected window, allocation record, manipulation record, evidence tier, control tier, and phase-gate result.

#### Protocol and Behavior Records

- **FR-036**: The strict study manifest, puzzle build, attempt summary, design receipt, phase summary, and evaluation record MUST use schema versions 6, 4, 7, 4, 3, and 2 respectively.
- **FR-037**: The strict manifest MUST replace reviewer selection with checking feedback `published-runnability-coverage-v1`, primary metric `normalized-positional-word-v1`, diagnostic metric `palimpsest-diagnostics-v1`, and evaluation policy `all-canonical-main-snapshots-v1`.
- **FR-038**: Receipts, reservations, frozen protocols, traces, attempts, and evaluation records MUST agree on the resolved checking, scoring, canonical-origin, schedule, resource, and artifact-provenance contracts.
- **FR-039**: The behavior rubric MUST record communication use, cross-agent integration, negative interference, and conflict recovery.
- **FR-040**: The behavior rubric MUST record each observed sequence of prior rule, contradictory evidence, replacement rule, and downstream effect without requiring such a sequence to occur.
- **FR-041**: The behavior rubric MUST record source-recognition evidence and the time of the first explicit recognition without claiming recognition was eliminated.
- **FR-042**: The behavior rubric MUST record checker use while prohibiting interpretation of checker validation as correctness.
- **FR-043**: The behavior rubric MUST record resource usage, returned reasoning-summary coverage, and final artifact provenance, and MUST remove reviewer-selection rationale.
- **FR-044**: An empty provider reasoning summary MUST remain empty captured evidence rather than be treated as missing hidden reasoning.

#### Verification and Calibration

- **FR-045**: Provider-free acceptance MUST prove the checker disclosure boundary, all declared solver failure modes, shared and isolated evaluation cardinality, prohibited evaluation inputs, complete synthetic diagnostics, collective-ceiling semantics, nullable integration-gap semantics, and pre-adapter evidence-fallback rejection.
- **FR-046**: Provider-free acceptance MUST prove eligible unregistered input seals byte-identically and rejected input exits nonzero without publishing any build.
- **FR-047**: Provider-free acceptance MUST complete the full offline `CS`, `CR`, `IR`, and `IS` fixture, advisory local CI, full repository verification, and a clean receipt-bound preflight on the exact committed revision.
- **FR-048**: Paid calibration MUST create a fresh study root and immutable design receipt before running `CS`, `CR`, `IR`, and `IS` sequentially on `calibration-odd-women`.
- **FR-049**: Each calibration attempt MUST use three GPT-5.6-sol agents at medium reasoning with releases at 0, 5, 10, 20, 30, and 40 minutes, a 60-minute cutoff, and no cumulative token cutoff.
- **FR-050**: Actual token and monetary usage MUST be retained as evidence even though token use does not terminate sessions.
- **FR-051**: Paid calibration MUST retain the existing $10 per-attempt authorization and MUST NOT exceed $40 across the four planned cells.
- **FR-052**: Each frozen calibration attempt MUST automatically evaluate every canonical origin and generate diagnostic and behavior-review records.
- **FR-053**: The experiment command MUST expose one calibration workflow and MUST reject phase selection.
- **FR-054**: Collaboration, revision, integration, accuracy, source recognition, checker frequency, and resource consumption MUST remain measured model outcomes rather than calibration pass criteria.

### Key Entities

- **Blind Checker Result**: Captured published commit plus execution, output validity, word counts, and plaintext-independent coverage visible during model work.
- **Canonical Origin Snapshot**: One assigned origin's literal final `refs/heads/main` commit captured at freeze and evaluated without repair or selection.
- **Origin Evaluation**: Terminal status, aggregate metric, optional diagnostics, output coverage, and provenance for one canonical origin.
- **Team Evaluation**: Realized product status, collective ceiling, and nullable integration gap derived from origin evaluations without synthesizing an artifact.
- **Diagnostic Record**: Post-freeze measurements by boundary, manipulation/control status, sentinel/specialist role, stage, evidence owner, changed type, and output position.
- **Evidence Tier**: Phase-gating summary of specialist ownership, occurrences, solo coverage, and stage and region balance.
- **Control Tier**: Phase-gating summary of stable-control completeness and matching distance.
- **Sealed Study Block**: Pinned source and seed, deterministic window, allocation and manipulation records, validity tiers, and phase result.
- **Behavior Review**: Trace-grounded observations about communication, integration, interference, belief revision, recognition, checker interpretation, resources, reasoning-summary coverage, and artifact provenance.
- **Calibration Study**: One fresh receipt-bound sequence of four attempts whose empirical outputs are reviewed before any validation decision.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In acceptance tests, 100 percent of correct and incorrect same-length solver pairs receive identical non-commit checker feedback, and zero checker paths open oracle plaintext or checker truth.
- **SC-002**: The checker produces the expected terminal result in 100 percent of valid, missing, empty, malformed, oversized, timed-out, and incomplete solver fixtures.
- **SC-003**: Every shared fixture emits exactly one canonical-origin result and every isolated fixture emits exactly three, with zero accepted reviewer-selection or evaluation-override inputs.
- **SC-004**: Synthetic diagnostic fixtures produce exact expected results for every declared boundary, changed/control, sentinel/specialist, stage, owner, changed-type, missing-token, and extra-token case.
- **SC-005**: Collective ceiling and integration gap tests cover every shared, isolated, partial-failure, single-scoreable-origin, and no-scoreable-origin case with an explicit deterministic result or null reason.
- **SC-006**: Eligible unregistered input seals from its first qualifying bounded window byte-identically, while every rejected input publishes zero build files.
- **SC-007**: Invalid or fallback evidence causes zero credential reads, zero provider adapter creations, and zero paid calls.
- **SC-008**: The complete provider-free four-condition fixture, advisory local CI, repository verification, and clean receipt-bound preflight pass on one exact committed revision.
- **SC-009**: The paid calibration produces exactly four sequential attempt records and terminal evaluation outcomes for 100 percent of their canonical origins without exceeding $40 authorization.
- **SC-010**: All four calibration attempts retain diagnostics separating sentinel from specialist performance, behavior review including source-recognition and resource evidence, actual usage, final artifact provenance, and no correctness disclosure during model work.
- **SC-011**: The calibration ends after `IS`, regardless of collaboration, revision, integration, recognition, or reconstruction accuracy.

## Assumptions

- The next unused sequential feature number is `020` because `019-configurable-run-controls` is the branch from which this feature is created.
- The four-cell calibration, runnability-only checker, and measured source recognition are the selected defaults because no alternatives were supplied.
- The existing OpenAI credential may be reused for the paid calibration without exposing it to agents; availability is checked only after all provider-free gates pass.
- The current direct provider session, three-agent assignment, prompt objective, neutral scaffold, staged evidence, condition mapping, and provider-neutral runner remain in place except for the explicitly changed checking, evaluation, recording, catalog, and resource contracts.
- The hour-only resource regime is intentional. Tokens and cost are observed, but only the clock and existing monetary authorization bound the planned calibration.
- Natural public-domain prose remains the construct. Private or commissioned prose and a separately randomized recognition factor are outside this feature.
- Historical Feature 017 and 018 runs and artifacts remain immutable and are not migrated to the new schemas.
- Any later validation is a separate study with its own manifest, sources, and receipt.
- A failed source gate or stale preflight blocks paid work. It does not authorize alternate material, a relaxed threshold, or an unbound live run.
- The constitution's current oracle-backed aggregate-checker clause must be amended and synchronized with dependent guidance before implementation because blind checking intentionally changes that governed boundary.
