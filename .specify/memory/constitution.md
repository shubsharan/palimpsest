<!--
Sync Impact Report
- Version change: 6.0.0 -> 7.0.0
- Modified principles:
  - Minimal Reproducible Mechanics: names fixture packages and run records as the lean durable boundary
- Modified governance:
  - Development Workflow and Quality Gates: replaces revision-bound preflight receipts with exact experiment validation and explicit spend authorization
- Added sections: none
- Removed sections: none
- Templates:
  - pending in Feature 021: .specify/templates/plan-template.md
  - pending in Feature 021: .specify/templates/spec-template.md
  - pending in Feature 021: .specify/templates/tasks-template.md
  - reviewed, no change: .specify/templates/checklist-template.md
  - reviewed, no change: .specify/templates/constitution-template.md
  - command templates absent; installed extension commands reviewed, no change
- Runtime guidance:
  - updated: AGENTS.md
  - updated: CLAUDE.md
  - updated: README.md
  - updated: docs/proposal.md
  - updated: docs/architecture.md
  - updated: docs/roadmap.md
- Follow-up TODOs: none
-->

# Palimpsest Constitution

## Core Principles

### I. Puzzle Behavior Before Process

Palimpsest MUST remain a puzzle for observing frontier-model behavior. Agent-facing instructions MUST state the shared objective, available evidence, available tools, peer presence, resource cutoffs, and requested output without recommending a decoding algorithm, assigning roles, imposing turns, or requiring intermediate reasoning artifacts. Infrastructure MUST NOT repair, merge, reinterpret, or conceal model work.

Agent-facing instructions MAY declare the cipher family and one final solver interface when those facts define the task rather than its solution.

Rationale: The object of study is how capable models solve and collaborate, not whether they infer an unstated task family or packaging contract. A runner that dictates the solving process still changes that object.

### II. Environmental Constraints, Not Workflow

The runner MAY constrain what evidence is visible, when new evidence appears, which communication and checking tools exist, how much wall time or model-token usage is available, and one canonical published solver entrypoint used by both checking and grading. Those constraints MUST be independent of model behavior and identical for peers in the same condition. The runner MUST NOT require a particular number of model turns, Git operations, checkpoints, hypotheses, mappings, intermediate files, branches other than the published ref, or coordination sequence.

Rationale: A single shared deliverable aligns feedback with evaluation. Leaving every other organizational choice open preserves the model-created workflow.

### III. Minimal Reproducible Mechanics

Puzzle generation, staged reveal, partial re-keying, checker results, and final scoring MUST be deterministic for fixed scientific inputs. Public interfaces and stored records MUST be only as structured as required to prepare a fixture, run an experiment, inspect model behavior, and score every canonical origin. One validated fixture package, one explicit experiment manifest, one append-only trace, and one run record are the default durable boundary. New schemas, hashes, replay systems, isolation layers, or services MUST solve a current experimental need rather than anticipate a hypothetical release or adversary.

Rationale: Reproducible puzzle mechanics matter; exhaustive infrastructure provenance does not improve the model behavior being observed.

### IV. Observe Outcomes Honestly

Incorrect solutions, early stopping, no collaboration, duplicated work, raw-text sharing, unconventional encoding, repeated checker use, source recognition, and attempts to bend the process MUST be retained as model outcomes rather than converted into invalid runs. Reports MUST separate reconstruction scores, observed behavior, infrastructure failures, and reviewer interpretation. Claims MUST NOT exceed what the puzzle output and trace directly support.

Rationale: Workarounds and coordination failures are evidence about model behavior. Suppressing them creates a cleaner artifact at the cost of a less truthful experiment.

### V. Condition-Defined Native Collaboration

Agents MUST be told that they are members of one concurrent team and that peers hold different private evidence in every communication condition. The communication component of the declared condition MUST determine whether peer communication is available. Shared conditions MUST expose one ordinary shared Git repository and peer activity. Isolated conditions MUST give each agent an independent usable Git repository and MUST NOT expose peer evidence, repositories, scores, or activity. Team identity, objective, private evidence allocation and release schedule, tools other than peer communication, resource limits, and evaluation boundary MUST remain identical across communication-paired conditions.

Every assigned origin MUST begin from the same neutral solver scaffold. Only the declared pushed main solver MAY receive oracle-backed aggregate checking or final grading. Git operations MUST remain unmetered, and the runner MUST NOT automate publication, merging, conflict resolution, or collaboration. Independent work, no publication, raw sharing when available, centralization, conflicts, and ignored peer work MUST remain recorded model outcomes rather than infrastructure failures.

Rationale: Communication availability remains the treatment, while a common published artifact makes peer contributions useful and keeps private scratch work from receiving feedback unavailable to the graded solver.

## Research and Security Constraints

- The proposal is authoritative for puzzle intent and research claims. The architecture is authoritative for the minimal runner and visibility boundaries. The roadmap schedules delivery without redefining either.
- Python owns corpus preparation, cipher generation, partial re-keying, and scoring. TypeScript/Node owns model sessions, staged delivery, tool exposure, Git setup, resource cutoffs, trace capture, and the operator surface. Prefer plain files and subprocesses over new cross-runtime infrastructure.
- Trusted generation and grading MUST keep prepared plaintext and cipher keys unavailable to model workspaces. The aggregate checker MUST execute the exact solver at the assigned origin's captured `main` commit against only the caller's currently visible private evidence. It MAY use the oracle but MUST return only that commit identity, aggregate matched-word count, total-word count, coverage, accuracy, and execution errors.
- Private staged shards MUST remain outside agent-visible Git checkouts. Post-run raw-overlap measurement MAY identify obvious exact or normalized long spans, but it MUST NOT block Git operations, alter scores, invalidate runs, or expand into adversarial encoding detection.
- Standard sandbox and secret-handling protections MAY protect the host and provider credentials. They MUST NOT be represented as a red-teamed security claim or used to invalidate otherwise observable model behavior.
- External factual or novelty claims MUST cite verifiable primary sources. Palimpsest MUST be described as a compound puzzle and research artifact, not as a construct-validated benchmark or certified measure of reasoning, collaboration, or belief revision.

## Development Workflow and Quality Gates

1. Reconcile each feature with `docs/proposal.md`, `docs/architecture.md`, and `docs/roadmap.md`; expose contradictions before implementation.
2. Follow the Spec Kit sequence constitution, specify, clarify, plan, tasks, analyze, and implement for material feature work.
3. Each specification MUST state the puzzle behavior being enabled, agent-visible instructions and tools, environmental constraints, observable outcomes, infrastructure failures, and claims that remain out of scope.
4. Each plan MUST pass the Constitution Check before research and after design. Any new process requirement or safeguard requires a concrete current experimental need and an explanation of why a simpler observation is insufficient.
5. Tests MUST cover deterministic mechanics, agent independence, condition-defined communication visibility, identical scaffolded origins, published-solver checking, identical non-treatment inputs, resource cutoffs, checker disclosure, scoring, and the absence of prescribed coordination workflow. Verification MUST be proportional to the claim; red-team and replay suites are not default completion requirements.
6. Automated development checks MUST provide fast advisory feedback on proposed changes and the primary branch. They MAY build the sandbox definition as a smoke check, but MUST NOT be required branch-protection gates or run the real-container behavior suite or deterministic end-to-end fixture.
7. Immediately before any live-model experiment that spends money or may support published findings, the runner MUST validate the exact experiment manifest and every referenced fixture package, verify their digests and relationships, probe the configured sandbox, and complete a provider-free smoke path. The operator MUST explicitly authorize spend before any provider session opens; a reusable repository or clean-checkout receipt MUST NOT substitute for these checks.
8. Each paid run record MUST retain the resolved secret-free configuration, fixture-package identity, sandbox identity, and validation outcome used at execution. Publication claims MUST identify those experimental inputs and the runner used to execute them. Exact host tool patch versions MUST NOT substitute for behavior checks or agent-visible environment identity.

## Governance

This constitution governs all Palimpsest specifications, plans, tasks, reviews, and research claims. When another artifact conflicts with it, the constitution prevails; proposal, architecture, and roadmap authority remains scoped as described above.

Amendments require explicit rationale, affected principles and artifacts, compatibility impact, and maintainer approval. The amendment MUST update dependent Spec Kit templates and runtime guidance in the same feature. Versions follow semantic versioning: MAJOR for incompatible principle or governance removals or redefinitions, MINOR for a new principle or materially expanded obligation, and PATCH for non-semantic clarification.

Feature plans and pull requests MUST record constitution compliance. Reviewers MUST check the actual agent prompt, tool surface, runner behavior, and produced trace rather than relying on intended neutrality. Exceptions require an owner, scope, and removal condition; no exception may justify overstating empirical evidence.

**Version**: 7.0.0 | **Ratified**: 2026-07-24 | **Last Amended**: 2026-07-31
