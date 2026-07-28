<!--
Sync Impact Report
- Version change: 3.0.0 -> 4.0.0
- Modified principles:
  - Development Workflow and Quality Gates: merge-time full verification -> advisory
    development checks plus experiment-time preflight
- Added sections: none
- Removed sections: none
- Templates:
  - updated: .specify/templates/plan-template.md
  - updated: .specify/templates/spec-template.md
  - updated: .specify/templates/tasks-template.md
  - reviewed, no change: .specify/templates/checklist-template.md
  - reviewed, no change: .specify/templates/constitution-template.md
- Runtime guidance:
  - updated: AGENTS.md
  - updated: CLAUDE.md
  - reviewed, no change: docs/proposal.md
  - updated: README.md
  - updated: docs/architecture.md
  - updated: docs/roadmap.md
- Follow-up TODOs: none
-->

# Palimpsest Constitution

## Core Principles

### I. Puzzle Behavior Before Process

Palimpsest MUST remain a puzzle for observing frontier-model behavior. Agent-facing instructions MUST state the shared objective, available evidence, available tools, peer presence, resource cutoffs, and requested output without recommending a decoding algorithm, assigning roles, imposing turns, or requiring intermediate reasoning artifacts. Infrastructure MUST NOT repair, merge, reinterpret, or conceal model work.

Rationale: The object of study is how capable models approach the puzzle, including how they collaborate, fail, improvise, or exploit the environment. A runner that dictates the process changes that object.

### II. Environmental Constraints, Not Workflow

The runner MAY constrain what evidence is visible, when new evidence appears, which communication and checking tools exist, and how much wall time or model-token usage is available. Those constraints MUST be independent of model behavior and identical for peers in the same condition. The runner MUST NOT require a particular number of model turns, Git operations, checkpoints, hypotheses, mappings, file names, branches, or coordination sequence.

Rationale: Stable environmental conditions make observations interpretable without converting an open-ended puzzle into a scripted benchmark workflow.

### III. Minimal Reproducible Mechanics

Puzzle generation, staged reveal, partial re-keying, checker results, and final scoring MUST be deterministic for fixed scientific inputs. Public interfaces and stored records MUST be only as structured as required to run, inspect, and score an attempt. New schemas, manifests, hashes, replay systems, isolation layers, or services MUST solve a current experimental need rather than anticipate a hypothetical release or adversary.

Rationale: Reproducible puzzle mechanics matter; exhaustive infrastructure provenance does not improve the model behavior being observed.

### IV. Observe Outcomes Honestly

Incorrect solutions, early stopping, no collaboration, duplicated work, raw-text sharing, unconventional encoding, repeated checker use, source recognition, and attempts to bend the process MUST be retained as model outcomes rather than converted into invalid runs. Reports MUST separate reconstruction scores, observed behavior, infrastructure failures, and reviewer interpretation. Claims MUST NOT exceed what the puzzle output and trace directly support.

Rationale: Workarounds and coordination failures are evidence about model behavior. Suppressing them creates a cleaner artifact at the cost of a less truthful experiment.

### V. Voluntary Native Collaboration

Agents MUST be told that they are members of one concurrent team, that peers hold different private evidence, and that an ordinary shared Git repository is their communication channel. Git use MUST remain voluntary and unmetered by the experimental runner. Agents MAY work independently, exchange code or notes, relay raw evidence, centralize work, or ignore peers; the runner MUST NOT reject those choices. Private puzzle inputs MUST live outside the Git checkout, and instructions SHOULD ask agents to share code and compact findings rather than raw ciphertext or reconstructed prose.

Rationale: Collaboration should be useful and explicitly invited, while its form and success remain model-created behavior rather than scheduler-created behavior.

## Research and Security Constraints

- The proposal is authoritative for puzzle intent and research claims. The architecture is authoritative for the minimal runner and visibility boundaries. The roadmap schedules delivery without redefining either.
- Python owns corpus preparation, cipher generation, partial re-keying, and scoring. TypeScript/Node owns model sessions, staged delivery, tool exposure, Git setup, resource cutoffs, trace capture, and the operator surface. Prefer plain files and subprocesses over new cross-runtime infrastructure.
- Trusted generation and grading MUST keep prepared plaintext and cipher keys unavailable to model workspaces. The aggregate checker MAY use the oracle but MUST return only aggregate matched-word count, total-word count, coverage, accuracy, and execution errors for currently visible private evidence.
- Private staged shards MUST remain outside the shared Git checkout. Post-run raw-overlap measurement MAY identify obvious exact or normalized long spans, but it MUST NOT block Git operations, alter scores, invalidate runs, or expand into adversarial encoding detection.
- Standard sandbox and secret-handling protections MAY protect the host and provider credentials. They MUST NOT be represented as a red-teamed security claim or used to invalidate otherwise observable model behavior.
- External factual or novelty claims MUST cite verifiable primary sources. Palimpsest MUST be described as a compound puzzle and research artifact, not as a construct-validated benchmark or certified measure of reasoning, collaboration, or belief revision.

## Development Workflow and Quality Gates

1. Reconcile each feature with `docs/proposal.md`, `docs/architecture.md`, and `docs/roadmap.md`; expose contradictions before implementation.
2. Follow the Spec Kit sequence constitution, specify, clarify, plan, tasks, analyze, and implement for material feature work.
3. Each specification MUST state the puzzle behavior being enabled, agent-visible instructions and tools, environmental constraints, observable outcomes, infrastructure failures, and claims that remain out of scope.
4. Each plan MUST pass the Constitution Check before research and after design. Any new process requirement or safeguard requires a concrete current experimental need and an explanation of why a simpler observation is insufficient.
5. Tests MUST cover deterministic mechanics, agent independence, optional collaboration, resource cutoffs, checker disclosure, scoring, and the absence of prescribed workflow. Verification MUST be proportional to the claim; red-team and replay suites are not default completion requirements.
6. Automated development checks MUST provide fast advisory feedback on proposed changes and the primary branch. They MAY build the sandbox definition as a smoke check, but MUST NOT be required branch-protection gates or run the real-container behavior suite or deterministic end-to-end fixture.
7. A clean-checkout `pnpm preflight` MUST pass immediately before any live-model experiment that spends money or may support published findings. It MUST rebuild and verify the agent sandbox, exercise the fresh deterministic build-run-evaluate path without external model calls, and bind the successful receipt to the tested source revision and sandbox identity.
8. Paid attempt artifacts MUST retain the matching preflight provenance. Publication claims MUST identify the tested runner revision and experimental sandbox from those artifacts. Exact host tool patch versions MUST NOT substitute for behavior checks or agent-visible environment identity.

## Governance

This constitution governs all Palimpsest specifications, plans, tasks, reviews, and research claims. When another artifact conflicts with it, the constitution prevails; proposal, architecture, and roadmap authority remains scoped as described above.

Amendments require explicit rationale, affected principles and artifacts, compatibility impact, and maintainer approval. The amendment MUST update dependent Spec Kit templates and runtime guidance in the same feature. Versions follow semantic versioning: MAJOR for incompatible principle or governance removals or redefinitions, MINOR for a new principle or materially expanded obligation, and PATCH for non-semantic clarification.

Feature plans and pull requests MUST record constitution compliance. Reviewers MUST check the actual agent prompt, tool surface, runner behavior, and produced trace rather than relying on intended neutrality. Exceptions require an owner, scope, and removal condition; no exception may justify overstating empirical evidence.

**Version**: 4.0.0 | **Ratified**: 2026-07-24 | **Last Amended**: 2026-07-28
