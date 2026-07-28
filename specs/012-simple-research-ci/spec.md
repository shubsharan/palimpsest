# Feature Specification: Simple Research Verification

**Feature Branch**: `012-simple-research-ci` **Created**: 2026-07-28 **Status**: Complete **Input**: User description: "Keep CI to basic dependency, build, lint, and Docker smoke checks; use an explicit full preflight before spending on experiments or publishing findings; record tested commit provenance; remove required verify branch protection; and stop compiling an exact host Git release."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Get Fast Change Feedback (Priority: P1)

As a maintainer, I want inexpensive automated feedback on proposed and merged changes so that ordinary repository mistakes are visible without making every merge wait for the full experimental verification suite.

**Why this priority**: Dependency, formatting, lint, compile, and sandbox-definition failures are cheap to catch early, while behavioral verification on every change is disproportionate for a small research project.

**Independent Test**: Introduce one representative dependency, formatting, lint, compile, or Dockerfile build failure and confirm the automated check reports it without running the behavioral suites or becoming a required merge condition.

**Acceptance Scenarios**:

1. **Given** a proposed change or push, **When** automated feedback runs, **Then** it installs locked dependencies, checks formatting and lint, compiles the TypeScript project, and builds the sandbox image.
2. **Given** the automated feedback fails, **When** the maintainer reviews the change, **Then** the failure is visible but does not constitute a required branch-protection gate.
3. **Given** the automated feedback runs, **When** its work is inspected, **Then** it does not run unit suites, real-container behavior tests, the deterministic fixture, or compile an exact host Git release.

---

### User Story 2 - Verify Before Spending (Priority: P1)

As a research operator, I want one explicit preflight immediately before a paid or findings-bearing live experiment so that the consequential run starts only from source and an experimental sandbox that passed the complete deterministic and containment checks.

**Why this priority**: A broken runner is most consequential when it wastes model spend or contaminates empirical results.

**Independent Test**: Run the preflight from a clean checkout and confirm it rebuilds and tests the experimental sandbox, exercises the deterministic end-to-end fixture, and creates a successful receipt for the current source revision; then introduce a dirty source change or failing check and confirm no successful receipt is produced.

**Acceptance Scenarios**:

1. **Given** a clean source revision and available container engine, **When** the operator runs preflight, **Then** the complete verification suite and a fresh deterministic build-run-evaluate fixture pass.
2. **Given** modified or untracked source, **When** the operator runs preflight, **Then** it fails before issuing a successful receipt.
3. **Given** any full-suite, sandbox-build, containment, cleanup, or fixture failure, **When** preflight ends, **Then** it reports failure and does not authorize a live run.

---

### User Story 3 - Trace Findings to Tested Code (Priority: P2)

As a researcher or reviewer, I want each live experiment artifact to identify the exact tested source revision and sandbox so that later findings can be tied to the code and agent environment that actually produced them.

**Why this priority**: Publication integrity depends on traceable experimental inputs, not on whether every earlier merge passed a heavyweight gate.

**Independent Test**: Complete preflight, start a live run from the unchanged checkout, and inspect its artifacts to confirm they contain the tested source revision and sandbox identity; then change the checkout or sandbox and confirm the stale preflight cannot authorize a run.

**Acceptance Scenarios**:

1. **Given** a successful current preflight, **When** a live experiment starts, **Then** its attempt artifacts retain the tested source revision and sandbox identity.
2. **Given** the source revision, worktree state, or sandbox identity differs from the successful preflight, **When** a live experiment is requested, **Then** it fails before an external model call.
3. **Given** experiment artifacts under review for publication, **When** a reviewer inspects them, **Then** the reviewer can determine which source revision and sandbox passed preflight.

### Edge Cases

- The repository is on a detached source revision.
- The checkout contains ignored build or preflight output but no modified or untracked research source.
- A prior successful preflight receipt exists after the source revision or sandbox image changes.
- The host Git or container client version differs from the maintainer's version while the required behavior tests still pass.
- The automated sandbox build succeeds while full local preflight fails because containment behavior regressed.
- A fixture completes but does not produce the required build, attempt, overlap, and evaluation artifacts.

## Puzzle & Observation Boundaries _(mandatory)_

**Puzzle Behavior**: The three-agent puzzle, staged private evidence, hidden partial re-key, aggregate checker, reviewer-selected evaluation, and scoring behavior remain unchanged.

**Agent Instructions & Tools**: Agent prompts, peer context, voluntary unmetered Git, scientific tools, and requested but unenforced collaboration behavior remain unchanged. Only the provenance of the host runner and agent sandbox is added to attempt artifacts.

**Environmental Constraints**: The agent-visible sandbox remains isolated and reproducible. Host development tools need only support and pass the repository behavior checks; exact host Git compilation is not an experimental control. Provider credentials, private evidence, prepared plaintext, keys, network policy, resource limits, and visibility schedules remain unchanged.

**Observable Outcomes**: Existing scores, traces, Git/checker behavior, frozen workspaces, overlap observations, resource termination, and reviewer interpretation remain unchanged. Research artifacts additionally retain the successful preflight's source revision and sandbox identity.

**Infrastructure Failures**: Dirty or changed source, stale or missing preflight evidence, sandbox identity mismatch, deterministic fixture failure, and containment or cleanup failure prevent a live run before any external model call. Advisory automated-check failures remain development feedback rather than experiment outcomes.

**Verification Boundary**: Proposed changes and primary-branch pushes receive fast advisory feedback. Only a successful clean-source preflight authorizes paid or findings-bearing live research, and its tested source revision plus sandbox identity remain with the attempt artifacts used to support later findings.

**Out-of-Scope Claims**: This feature does not make Palimpsest an enterprise release system, certify arbitrary host tool versions, add artifact signing or remote attestations, establish a benchmark methodology, or prove construct validity, security, reproducibility across all hosts, or publication correctness.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The repository MUST run a fast advisory check for proposed changes and pushes to the primary branch.
- **FR-002**: The fast check MUST install locked dependencies, detect missing tracked inputs, formatting or lint failures, TypeScript compile errors, and sandbox-definition build failures.
- **FR-003**: The fast check MUST NOT run unit suites, real-container behavior tests, the full end-to-end fixture, or compile an exact host Git release.
- **FR-004**: The fast check MUST NOT be required by primary-branch protection.
- **FR-005**: The repository MUST expose one explicit full preflight for operators to run before a paid or findings-bearing live experiment.
- **FR-006**: Preflight MUST require a clean source state, rebuild the current experimental sandbox, run the complete verification suite including real-container checks, and execute a fresh deterministic build-run-evaluate fixture without external model calls.
- **FR-007**: Preflight MUST create a successful machine-readable receipt only after every required check passes.
- **FR-008**: The receipt MUST identify the tested source revision, the clean source state, the sandbox image identity, and the sandbox source identity.
- **FR-009**: A live experiment MUST fail before its first external model call when no successful receipt matches the current source revision and sandbox identity.
- **FR-010**: Live experiment artifacts MUST retain the matching preflight provenance needed to identify the tested source revision and sandbox.
- **FR-011**: The agent-visible sandbox dependencies that can affect experimental behavior MUST be fixed by the sandbox definition or immutable sandbox identity.
- **FR-012**: Host Git MUST be checked for availability and supported behavior rather than compiled and rejected solely for differing from one exact patch release.
- **FR-013**: Existing puzzle behavior, agent instructions, operator commands, deterministic mechanics, containment policy, and scientific capabilities MUST remain unchanged.
- **FR-014**: The implementation MUST avoid approval environments, test matrices, remote attestation services, generalized release orchestration, or other enterprise deployment machinery.
- **FR-015**: Active documentation and governance MUST describe the advisory development check, experiment-time preflight, provenance receipt, and non-required branch policy consistently.

### Key Entities

- **Preflight Receipt**: Successful local evidence binding a source revision and clean source state to a tested sandbox identity and completed full verification.
- **Experiment Provenance**: The subset of the matching preflight receipt retained with a live attempt so its runner revision and sandbox can be inspected later.
- **Advisory Check**: Mechanical automated feedback that may build the sandbox image but excludes behavioral verification and does not authorize research claims.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Automated change feedback completes dependency, formatting, lint, compile, and sandbox-build smoke checks without compiling Git or running behavioral/full-fixture suites.
- **SC-002**: One operator command either completes the full preflight and writes exactly one successful receipt or exits unsuccessfully without a success receipt.
- **SC-003**: Zero external model calls occur when live-run provenance is missing, stale, dirty, or bound to a different sandbox.
- **SC-004**: Every live attempt records one tested source revision and the sandbox identity used for that attempt.
- **SC-005**: A fresh deterministic fixture completes through build, run, overlap observation, evaluation, and score during preflight.
- **SC-006**: The primary branch has zero required status checks after the feature is adopted.
- **SC-007**: Existing deterministic puzzle, agent-autonomy, containment, and scoring tests continue to pass without behavioral changes.

## Assumptions

- The project has one or a few trusted maintainers who may merge while advisory checks are failing and repair the primary branch directly.
- Paid experiments use the OpenAI model adapter; deterministic fixture runs do not require provider credentials or incur model spend.
- Publication review uses the provenance already retained with experiment artifacts; no separate publishing service is introduced.
- Ignored generated output does not make the source state dirty, while modified tracked files and untracked nonignored files do.
- A detached revision is acceptable when it is a valid commit and the source state is clean.
- Actual host tool versions may be recorded for diagnosis, but only the agent-visible sandbox identity is part of the experimental condition.
