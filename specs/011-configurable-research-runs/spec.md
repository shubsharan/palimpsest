# Feature Specification: Configurable Research Runs

**Feature Branch**: `011-configurable-research-runs` **Created**: 2026-07-27 **Status**: Implemented **Input**: Researcher-authored puzzle configurations and direct multi-provider model comparisons without provider-specific runner code

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Declare and Run One Research Experiment (Priority: P1)

As the researcher, I can describe one puzzle and its model conditions in one readable, checked-in configuration, then run the complete declared experiment without changing source code.

**Why this priority**: A configuration is only useful when it is the authoritative input to a working build-and-run path.

**Independent Test**: Use one configuration containing a homogeneous condition and a mixed-model condition, run it with fixture model providers, and confirm that every attempt uses the declared puzzle, limits, and model assignment.

**Acceptance Scenarios**:

1. **Given** a valid configuration with one puzzle and one homogeneous model condition, **When** the researcher runs the experiment, **Then** the puzzle is built once and every agent in the attempt uses the declared model profile.
2. **Given** a valid configuration with a mixed-model condition, **When** the researcher runs the experiment, **Then** each ordered agent uses its corresponding declared model profile while receiving the same puzzle condition and resource limits as its peers.
3. **Given** several conditions and repetitions, **When** the researcher runs the experiment, **Then** attempts execute sequentially in declaration order and each completed attempt remains independently inspectable.
4. **Given** a malformed configuration or unresolved reference, **When** the researcher starts the experiment, **Then** it fails before creating a puzzle build or attempt.

---

### User Story 2 - Vary Reproducible Puzzle Conditions (Priority: P2)

As the researcher, I can select registered target and reference corpora, the target chapter range, agent and stage counts, and zero or more successive partial re-keys so I can study deliberately different puzzle conditions.

**Why this priority**: Model comparisons are meaningful only when the scientific inputs are explicit and reproducible.

**Independent Test**: Build fixed-seed configurations with two, three, and five agents; different stage counts; and zero, one, and two re-keys, then rebuild each and compare all generated puzzle bytes and declared geometry.

**Acceptance Scenarios**:

1. **Given** registered target and reference corpora with verified provenance, **When** the puzzle is built twice from the same configuration, **Then** both builds contain identical staged evidence, keys, oracle data, and identifiers.
2. **Given** two or more agents and one or more stages, **When** the puzzle is built, **Then** it contains exactly the declared number of private stage streams and every agent receives equivalent stage geometry.
3. **Given** zero re-keys, **When** the puzzle is built, **Then** one stationary substitution key applies to every stage.
4. **Given** multiple ordered re-keys, **When** the puzzle is built, **Then** each declared stage starts a deterministic partial revision of the immediately preceding key and earlier evidence remains immutable.

---

### User Story 3 - Review and Share Comparable Results (Priority: P3)

As the researcher, I can inspect the resolved non-secret experiment definition, model identities, usage, attempts, traces, and later reviewer-selected scores so I can analyze and share findings without reconstructing how a run was configured.

**Why this priority**: The project exists to support research findings, not merely to launch model calls.

**Independent Test**: Complete a multi-condition fixture experiment, inspect its summary and attempts, perform reviewer-selected evaluation on one frozen attempt, and verify that every scientific input and model assignment is recoverable without exposing credentials.

**Acceptance Scenarios**:

1. **Given** a completed attempt, **When** the researcher inspects its records, **Then** the requested provider, model, non-secret settings, actual response model identity when supplied, normalized usage, puzzle build, and termination are present.
2. **Given** completed attempts followed by a later command-level failure, **When** the researcher inspects the output root, **Then** earlier attempts and the latest complete experiment summary remain readable.
3. **Given** a frozen attempt, **When** the researcher chooses a workspace, solver command, and output path, **Then** the existing evaluation flow scores that selection without requiring the experiment runner to prescribe model-created files.
4. **Given** any generated experiment artifact, **When** it is searched for configured credential values, **Then** no credential value is present.

### Edge Cases

- A configuration contains an unknown key, unsupported schema version, duplicate identifier, unresolved provider/model/corpus reference, or an empty run list.
- A mixed condition declares a model assignment count different from the puzzle's agent count.
- A target corpus is also selected as public reference material, a corpus file no longer matches its registered digest, or the requested chapter range does not exist.
- Agent or stage count is outside the supported positive range, or the puzzle has fewer than two collaborative agents.
- Re-key stages are duplicated, unordered, outside stages `2..stageCount`, or cannot produce enough recurring evidence for a valid partial revision.
- A selected model cannot call the supplied tools, omits token usage required by the cutoff, rejects declared settings, is rate-limited, or fails during a turn.
- A command-level infrastructure failure occurs after some attempts have completed.
- An operator requests a repetition count large enough to incur unintended cost; every repetition remains explicit in the resolved configuration and output plan.

## Puzzle & Observation Boundaries _(mandatory)_

**Puzzle Behavior**: Each attempt remains an open-ended concurrent decipherment puzzle. The declared agent count receives private staged evidence derived from one target corpus and may encounter zero or more hidden shared partial re-keys. Model provider and puzzle configuration change the research condition, not the prescribed solving process.

**Agent Instructions & Tools**: Agents receive the shared reconstruction objective, their peer count, private evidence, target-excluded references, aggregate checker, ordinary shared Git, local command sandbox, and activity waiting. They choose their own roles, algorithms, files, Git behavior, and completion timing.

**Environmental Constraints**: Peers in one attempt receive identical evidence geometry, stage schedule, token cutoff, wall-time cutoff, sandbox limits, network denial, and tool surface. Provider credentials remain on the trusted host and are never mounted into model-authored commands.

**Observable Outcomes**: Attempt records retain model assignments, normalized usage, model/tool activity, stage releases, Git history, checker results, termination, frozen work, overlap observations, reviewer selections, execution results, and reconstruction scores. Incorrect work, provider differences, mixed-team behavior, unusual coordination, and voluntary non-collaboration remain observations.

**Infrastructure Failures**: Invalid configuration, unavailable credentials, provider request failure, missing required usage, puzzle construction failure, sandbox failure, artifact publication failure, and optional observation failure are reported separately from model reconstruction quality. Completed durable attempts are not erased by a later experiment failure.

**Out-of-Scope Claims**: This feature does not create a hosted experiment service, provider gateway, account or team system, automatic retry/fallback router, statistical analysis package, model capability benchmark, construct-valid measure of collaboration, or security certification. A configured model name does not prove that different providers expose identical token accounting, sampling, tool-calling, or serving behavior.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST accept one human-readable, schema-versioned experiment configuration that declares exactly one puzzle, its resource limits, provider connections, model profiles, and one or more run conditions.
- **FR-002**: The system MUST reject unknown configuration keys and invalid relationships before creating a build or attempt.
- **FR-003**: The system MUST support direct OpenAI, Anthropic, Google, and OpenAI-compatible provider connections through one provider-neutral model-session boundary.
- **FR-004**: Provider connections MUST reference credentials by environment-variable name; literal credentials MUST NOT be accepted as configuration.
- **FR-005**: A model profile MUST identify one provider connection, one provider model identifier, and optional non-secret model settings.
- **FR-006**: A run condition MUST declare either one model profile for every agent or one ordered model profile per agent, but not both.
- **FR-007**: The system MUST support a positive explicit repetition count per run condition, defaulting to one only when omitted.
- **FR-008**: The experiment runner MUST build the declared deterministic puzzle once and reuse that immutable build across its run conditions and repetitions.
- **FR-009**: Attempts MUST execute sequentially in configuration order; sessions within one attempt MUST remain concurrent.
- **FR-010**: The system MUST perform no automatic model-provider fallback or hidden attempt retry.
- **FR-011**: The system MUST preserve every durable completed attempt when a later condition or repetition fails.
- **FR-012**: The system MUST maintain a minimal atomically published experiment summary containing the resolved non-secret configuration and completed attempt paths.
- **FR-013**: The system MUST retain the existing explicit reviewer-selected evaluation boundary and MUST NOT impose a solver file name, command, workspace, role, or collaboration workflow on agents.
- **FR-014**: The target and reference corpora MUST be selected by identifiers from one checked-in provenance registry.
- **FR-015**: Corpus inputs MUST be verified against their registered digests before puzzle construction.
- **FR-016**: The target corpus MUST NOT also appear in the public reference corpus.
- **FR-017**: A puzzle MUST declare a valid one-based inclusive target chapter range, seed, agent count, stage count, stage interval, and ordered re-key schedule.
- **FR-018**: The system MUST support at least two agents and MUST generate canonical identifiers `agent-1` through `agent-N`.
- **FR-019**: The system MUST support one or more stages per agent and exactly the same stage cardinality and release geometry for all peers.
- **FR-020**: The system MUST support zero or more re-keys at unique ascending stage ordinals between `2` and the declared stage count.
- **FR-021**: Each re-key MUST be a deterministic partial revision of the immediately preceding substitution key and MUST declare its changed token-mass target.
- **FR-022**: Puzzle construction MUST fail explicitly when corpus or stage geometry cannot provide sufficient recurring evidence for a declared re-key.
- **FR-023**: Fixed scientific inputs MUST reproduce build identifiers, stage bytes, key revisions, checker truth, and scoring inputs.
- **FR-024**: Agent prompts, workspaces, private evidence roots, traces, Git setup, frozen records, and evaluation records MUST represent the declared dynamic agent set rather than an exact three-agent enumeration.
- **FR-025**: Every attempt MUST record its puzzle build identity and each agent's requested provider, requested model, non-secret settings, normalized usage, termination, and actual response model identity when the provider supplies one.
- **FR-026**: Token-budget enforcement MUST use provider-reported normalized input and output usage and MUST classify missing required usage as an infrastructure failure rather than estimate it silently.
- **FR-027**: Credential values MUST be excluded from configuration snapshots, traces, attempt records, experiment summaries, errors, and model-authored command environments.
- **FR-028**: Existing deterministic fixture execution MUST remain available for complete verification without external provider calls.
- **FR-029**: Existing model mistakes, tool errors, repeated checking, raw sharing, no Git use, and voluntary early completion MUST remain valid observable outcomes.
- **FR-030**: The operator surface MUST keep the existing sandbox-build, build, run, evaluate, and offline commands and add one experiment command; live build and run selection MUST use the provider-neutral experiment configuration rather than an OpenAI-specific mode.
- **FR-031**: A provider infrastructure-error session MUST still freeze and publish its attempt, after which an experiment runner MUST publish that completed entry and stop nonzero before launching another attempt.
- **FR-032**: Provider error text MUST be scrubbed of every resolved credential value before it reaches traces, stored records, standard error, or model-visible tool results.

### Key Entities

- **Experiment Configuration**: The researcher-authored declaration of one puzzle, limits, provider connections, model profiles, run conditions, and repetitions.
- **Resolved Experiment**: The validated non-secret configuration with defaults and references resolved before side effects.
- **Provider Connection**: A named direct provider driver with a credential environment reference and optional endpoint configuration.
- **Model Profile**: A named requested model plus non-secret common and provider-specific settings.
- **Run Condition**: A named homogeneous or ordered per-agent model assignment with a repetition count.
- **Puzzle Definition**: Target/reference corpus selection, source slice, seed, agent/stage geometry, reveal interval, and successive partial re-key schedule.
- **Re-key Transition**: The stage boundary, changed-token-mass target, derived key version, and changed symbol set for one partial revision.
- **Experiment Summary**: The durable minimal index from resolved conditions and repetitions to completed attempt roots.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A researcher can declare the target corpus, references, seed, agent count, stage count, re-key schedule, limits, provider models, mixed assignments, and repetitions in one file without editing source code.
- **SC-002**: One command completes a fixture experiment containing at least two model conditions and two repetitions and leaves every completed attempt independently inspectable.
- **SC-003**: Rebuilding each fixed configuration in the verification matrix produces byte-identical puzzle artifacts for 100% of tested two-, three-, and five-agent cases with zero, one, and two re-keys.
- **SC-004**: Invalid configurations in every documented edge-case class fail before build or attempt directories are created.
- **SC-005**: Every completed attempt identifies 100% of its agent-to-model assignments and retains normalized usage or an explicit infrastructure-failure reason.
- **SC-006**: Automated secret-canary verification finds zero configured credential values in generated records, traces, errors, or sandbox environments.
- **SC-007**: The current three-agent, six-stage, one-re-key offline fixture continues to complete and score without an external provider call.
- **SC-008**: Reviewer-selected evaluation succeeds for any durable experiment attempt without requiring the experiment runner to prescribe model-created file names or commands.
- **SC-009**: Full repository verification passes with no live provider credentials or billable model calls.

## Assumptions

- One experiment configuration defines one puzzle build; comparisons across different puzzle definitions use separate configuration files.
- Collaborative runs contain at least two agents under the current constitution; single-agent ablations are separate future behavior.
- Run conditions execute sequentially to keep the local machine, provider usage, and artifacts easy for one researcher to reason about.
- Repetitions reuse the same deterministic puzzle build and intentionally vary only nondeterministic model behavior and external serving conditions.
- Provider-reported token accounting is retained as evidence but is not claimed to be semantically identical across providers.
- Provider-specific model settings may be passed through and recorded, but Palimpsest validates only their non-secret structural shape and forbids provider fallback or call-control overrides; the selected provider remains authoritative for their meaning.
- The current registered Project Gutenberg corpora and reviewer-selected evaluation flow remain the starting scientific inputs and scoring boundary.
