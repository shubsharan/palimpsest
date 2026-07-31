# Feature Specification: Lean Experiment Engine

**Feature Branch**: `feature/021-lean-experiment-engine`  
**Created**: 2026-07-31  
**Status**: Draft  
**Input**: User description: "Recenter Palimpsest on experiment design with flexible fixtures and explicit experiment configurations, retaining only infrastructure and verification that directly support the science."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Prepare Different Puzzle Fixtures (Priority: P1)

As a researcher, I can describe and prepare word-substitution fixtures with different agent counts, stage counts, source windows, reference material, and key variants without changing runner source code.

**Why this priority**: Flexible, deterministic puzzle inputs are the foundation for asking new scientific questions without turning each experiment into an engineering project.

**Independent Test**: Prepare a two-agent, three-stage fixture and a four-agent, eight-stage fixture from declarations alone, then confirm that repeated preparation yields identical packages and that each package passes its declared allocation and manipulation checks.

**Acceptance Scenarios**:

1. **Given** a valid fixture definition and available corpus inputs, **When** the researcher prepares it twice, **Then** both packages have the same content digest, agent-visible evidence, oracle, and manipulation-check results.
2. **Given** a fixture definition with a stationary variant and a re-key variant, **When** the package is prepared, **Then** the variants share the declared pre-boundary evidence and differ only according to the declared re-key boundary and controls.
3. **Given** a definition whose allocation cannot satisfy its declared scientific constraints, **When** preparation is requested, **Then** preparation fails explicitly without publishing a partial package.

---

### User Story 2 - Execute Explicit Experiment Configurations (Priority: P1)

As a researcher, I can declare an ordered list of runs over prepared fixtures, assign models and communication conditions per run, validate the exact configuration, and execute it without changing source code or coordinating a separate study state machine.

**Why this priority**: The experiment declaration must be the genuine source of run variation so engineering machinery does not dictate or obscure the scientific design.

**Independent Test**: Execute a provider-free manifest containing multiple runs over different fixture geometries, schedules, model bindings, and communication conditions; confirm runs start in manifest order, agents within a run are concurrent, and no undeclared run or retry occurs.

**Acceptance Scenarios**:

1. **Given** a valid manifest with several explicit runs, **When** the experiment executes, **Then** runs execute sequentially in declared order while sessions inside each run begin concurrently.
2. **Given** paired shared and isolated runs with identical non-communication inputs, **When** they execute, **Then** shared agents see ordinary peer Git and the optional team room while isolated agents receive usable private Git and no peer evidence or activity.
3. **Given** a run whose session or container fails, **When** the failure occurs, **Then** the partial trace and explicit infrastructure status are retained, the experiment stops, and the runner performs no automatic retry or replacement.
4. **Given** an invalid, drifted, or insufficiently authorized configuration, **When** execution is requested, **Then** it stops before any provider session is opened.

---

### User Story 3 - Inspect and Re-evaluate Complete Run Evidence (Priority: P2)

As a researcher or reviewer, I can inspect one coherent record of the declared run, model behavior, frozen repositories, and scores, and can re-evaluate the frozen published solvers without rerunning model sessions.

**Why this priority**: Scientific interpretation depends on complete, legible evidence rather than orchestration metadata or a selected best result.

**Independent Test**: Complete one shared and one isolated provider-free run, verify that every canonical origin is evaluated and retained, then re-evaluate each frozen run and reproduce its scores without provider access.

**Acceptance Scenarios**:

1. **Given** a completed shared run, **When** final evaluation occurs, **Then** the one shared canonical origin is evaluated and its exact published-main commit and result are recorded.
2. **Given** a completed isolated run, **When** final evaluation occurs, **Then** every agent's canonical origin is evaluated independently, including missing or non-integrated solver outcomes.
3. **Given** a completed run record and frozen origins, **When** re-evaluation is requested, **Then** a new evaluation result is appended atomically without changing the frozen run configuration, trace, or prior results.
4. **Given** optional overlap analysis, **When** it is run after publication, **Then** its observations are retained separately from run success and scoring.

### Edge Cases

- A fixture definition names duplicate agents, no agents, no stages, an unavailable source or reference, an unknown variant, or a re-key boundary outside the stage range.
- An experiment assigns a model to an agent absent from the fixture, omits a fixture agent, repeats a run ID, uses a schedule with the wrong stage count, or names a changed fixture digest.
- A cutoff occurs before the final release, a token limit is zero or unsafe, or a monetary ceiling exceeds experiment authorization.
- A process exits after trace creation but before final record publication; the run directory remains inspectable as interrupted and is never interpreted as complete.
- An agent finishes without pushing `main`, pushes an invalid solver, or leaves useful work only on another ref; these remain recorded outcomes for that origin.
- Provider-reported identity or usage is missing, differs from the request, or cannot be normalized; the absence or discrepancy is recorded without a success-shaped fallback.
- Re-evaluation encounters a missing frozen origin, changed frozen content, solver timeout, malformed output, or cleanup failure; the new result reports the exact failure without rewriting prior evidence.

## Puzzle & Observation Boundaries _(mandatory)_

**Puzzle Behavior**: Agents solve declared deterministic word-substitution fixtures assembled from private staged evidence. A fixture may vary agent and stage geometry and may expose stationary or partial re-key variants, but Palimpsest remains this puzzle rather than a generic puzzle framework.

**Agent Instructions & Tools**: Every agent receives the shared objective, cipher family, stable team identity, its currently released private evidence, target-excluded references, ordinary local tools, the communication surface declared for the run, an assigned Git origin with a neutral `solver.py`, and aggregate checking of only that origin's pushed `main`. Instructions do not assign roles, turns, algorithms, branches beyond the published ref, checkpoints, consensus, or intermediate reports.

**Environmental Constraints**: Releases follow the run's frozen schedule independent of model behavior. The declared cutoff and optional token limit bound sessions. Shared runs expose peer Git activity and may expose an append-only room; isolated runs expose only private Git and owner activity. Provider credentials, oracle data, unreleased stages, and host resources remain unavailable to agents, and final solver execution remains isolated from the network and trusted data.

**Observable Outcomes**: The record retains resolved secret-free inputs, stage releases, requested and actual model identities, normalized usage, responses and provider-returned safe summaries, tool and checker activity, Git and optional room activity, termination, frozen origins and workspaces, every canonical-origin evaluation, infrastructure errors, and optional post-publication analyses. Incorrect work, no publication, repeated checking, duplicated effort, raw sharing, conflicts, and missing integration remain outcomes.

**Infrastructure Failures**: Invalid or drifted configuration, unavailable inputs, sandbox failure, provider transport failure, trace or freeze failure, and evaluation isolation or cleanup failure are reported separately from model behavior. An abrupt process interruption may leave a trace without a final record; no recovery or validity state is inferred.

**Verification Boundary**: Ordinary development checks remain fast and advisory. Before provider-backed work, the exact manifest and fixture packages are validated, the configured sandbox is probed, a provider-free smoke run is completed, and the operator explicitly authorizes spend. The resolved configuration, fixture and sandbox identities, and validation outcome are retained with each run; no repository-wide receipt or clean-commit lock substitutes for those checks.

**Out-of-Scope Claims**: The feature does not prove reasoning, collaboration value, belief revision, source novelty, security against adversarial agents, deterministic model behavior, or general benchmark validity. It does not add automated statistical conclusions, a hosted experiment service, arbitrary puzzle engines, or prescribed collaboration workflow.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Researchers MUST be able to describe fixture source selection, references, scientific seed, agent identifiers, stage count, variants, re-key boundaries, and scientifically meaningful allocation constraints in one fixture definition.
- **FR-002**: Fixture preparation MUST support at least two agents with three stages and four agents with eight stages without source-code changes.
- **FR-003**: Fixture preparation MUST be deterministic for identical definitions and referenced bytes and MUST identify the complete prepared content with a stable digest.
- **FR-004**: A prepared fixture MUST contain ordered agent-visible stages, variants, target-excluded references, trusted oracle data, construction provenance, manipulation checks, and the scoring contract needed to execute and interpret it.
- **FR-005**: Trusted oracle data, keys, labels, expectations, and manipulation-check results MUST remain outside agent-visible workspaces and evidence.
- **FR-006**: Invalid or unsatisfied fixture definitions MUST fail before a prepared package is published.
- **FR-007**: Researchers MUST be able to declare provider connections, model profiles, an experiment spending ceiling, and an explicit ordered run list in one experiment manifest.
- **FR-008**: Each run MUST declare a unique run ID, prepared fixture, variant, exact agent-to-model assignment, Git visibility, team-room availability, release offsets, cutoff, optional token limit, run spending ceiling, and analysis labels.
- **FR-009**: Manifest validation MUST require agent assignments to match fixture agents exactly, release offsets to match fixture stages, variants and fixture digests to exist, run IDs to be unique, credentials to be environment references, and run ceilings to fit experiment authorization.
- **FR-010**: Run schedules MUST start at zero, increase strictly, and release their final stage before a positive cutoff; token limits MUST be either absent or positive safe integers.
- **FR-011**: Experiment runs MUST execute sequentially in manifest order, while model sessions inside one run remain concurrent and independent.
- **FR-012**: Shared and isolated communication configurations MUST preserve team identity and every non-communication input while exposing only the communication and peer-activity surfaces declared for the run.
- **FR-013**: Every assigned origin MUST begin from the same neutral solver scaffold; Git operations MUST remain model-chosen and unmetered, and only pushed `main` may receive aggregate checking or final grading.
- **FR-014**: The runner MUST NOT require roles, turns, checkpoints, consensus, intermediate files, reports, Git operations, or a prescribed coordination sequence.
- **FR-015**: A run failure MUST retain its available trace and explicit status, stop the experiment command, and MUST NOT trigger automatic retry, replacement, merging, repair, or reinterpretation.
- **FR-016**: Repeating a run after failure MUST require a newly declared run ID.
- **FR-017**: Execution MUST rerun configuration-scoped validation against the exact manifest and fixture packages, probe the sandbox, complete a provider-free smoke path, and require explicit spend authorization before opening a provider session.
- **FR-018**: The system MUST publish one normalized run record atomically after freezing a normally completed or explicitly failed run; a directory without that record MUST be treated only as interrupted.
- **FR-019**: The run record MUST freeze the resolved secret-free run configuration, fixture digest, requested and actual model identities, normalized usage, release and activity evidence, terminations, frozen topology, infrastructure failures, and every evaluation result.
- **FR-020**: Traces MUST be append-only and retain model responses, safe provider-returned summaries when available, tool calls and results, checker use, Git activity, optional room activity, releases, and lifecycle events in observed order.
- **FR-021**: Records and traces MUST exclude credential values, hidden reasoning, complete provider payloads, oracle data, keys, and unreleased evidence.
- **FR-022**: Final evaluation MUST execute the same declared `python3 solver.py` interface used by checking against the exact captured `main` commit from every canonical origin.
- **FR-023**: A shared run MUST retain the result for its one shared origin; an isolated run MUST retain one result for every agent origin without selecting a best result.
- **FR-024**: Missing publication, invalid execution, incomplete integration, and incorrect reconstruction MUST remain explicit evaluation outcomes rather than invalidating the run.
- **FR-025**: Researchers MUST be able to re-evaluate frozen origins without provider access, preserving earlier evaluation results and frozen evidence.
- **FR-026**: Optional overlap analysis MUST run only over frozen records after publication and MUST NOT alter run status, scoring, Git behavior, or evaluation selection.
- **FR-027**: The active system MUST use fixture, experiment, run, and evaluation concepts rather than fixed block IDs, fixed condition IDs, study phases, balanced orders, receipts, reservations, locks, replacement lineage, resume state, or automatic retries.
- **FR-028**: The existing five checked-in fixtures and study matrix MUST remain reproducible as an example preset expressed entirely through the new fixture and experiment declarations.
- **FR-029**: Existing run artifacts MAY remain in Git history but MUST NOT require a compatibility reader, importer, or migration path in the active runtime.
- **FR-030**: Active project documentation MUST describe the lean fixture-to-experiment-to-run-record flow and remove superseded study-platform and feature-history guidance from the working tree.

### Key Entities

- **Fixture Definition**: Researcher's declarative scientific inputs for constructing one family of puzzle variants.
- **Fixture Package**: Prepared deterministic, digest-addressed puzzle material used by runs, containing separately bounded agent-visible and trusted data.
- **Experiment Manifest**: Providers, models, total authorization, and the explicit ordered set of runs to execute; its resolved digest identifies the experiment.
- **Run Declaration**: One fully specified fixture, model, communication, schedule, resource, and analysis configuration.
- **Run Record**: The normalized durable record of resolved inputs, observations, frozen outputs, failures, and evaluation history for one run.
- **Evaluation Result**: One execution and score outcome for one exact canonical-origin `main` commit.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A researcher can add and prepare both a two-agent/three-stage fixture and a four-agent/eight-stage fixture by changing declarations and corpus inputs only.
- **SC-002**: Repeated preparation of each example fixture produces identical content digests, agent-visible stages, oracle data, and manipulation-check results in 100% of test repetitions.
- **SC-003**: Two manifests can vary fixture geometry, variants, schedules, models, and communication surfaces and execute provider-free without source or schema edits.
- **SC-004**: Every attempted provider-backed execution passes exact configuration validation and explicit spending authorization before the first provider request, with zero requests made on validation failure.
- **SC-005**: Every completed shared run retains exactly one canonical-origin evaluation and every completed isolated run retains exactly one evaluation per fixture agent.
- **SC-006**: Re-evaluation reproduces deterministic execution status and score for unchanged frozen inputs while preserving all earlier results.
- **SC-007**: Automated verification detects any leakage of credentials, oracle data, keys, unreleased evidence, hidden reasoning, or complete provider payloads into agent-visible or durable observation surfaces.
- **SC-008**: No active runtime interface requires the historical five block IDs, `CS`/`CR`/`IS`/`IR`, calibration or validation phases, balanced orders, receipts, reservations, replacement lineage, or fixed agent/stage counts.
- **SC-009**: The provider-free end-to-end suite covers multiple explicit runs, concurrent agents, sequential run order, both communication modes, failure-stop behavior, and every canonical-origin evaluation without prescribed model workflow.

## Assumptions

- Palimpsest remains a local word-substitution puzzle environment; supporting arbitrary puzzle families is outside scope.
- Prepared fixture packages are trusted operator inputs and are not mounted wholesale into agent containers.
- Run IDs are immutable experiment identifiers. Repetition is expressed as a new declaration with a new ID rather than hidden retry metadata.
- Public in-code interface names remain unversioned. Serialized documents carry a numeric `schemaVersion` only so incompatible stored data fails explicitly.
- Existing provider adapters, Docker isolation, published-main checker, deterministic Python mechanics, neutral solver scaffold, and optional append-only team room are reused where they directly support the new flow.
- Existing run and study artifacts have archival value through Git history only; the active runtime does not read or migrate them.
