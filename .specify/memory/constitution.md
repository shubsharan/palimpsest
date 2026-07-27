<!--
Sync Impact Report
- Version change: 1.0.0 -> 2.0.0
- Modified principles:
  - I. Evidence Before Scale -> I. End-to-End Before Model Evaluation (NON-NEGOTIABLE)
- Added sections: none
- Removed sections: none
- Templates:
  - ✅ updated: .specify/templates/plan-template.md
  - ✅ updated: .specify/templates/spec-template.md
  - ✅ updated: .specify/templates/tasks-template.md
  - ✅ reviewed, no change: .specify/templates/checklist-template.md
  - ✅ reviewed, no change: .specify/templates/constitution-template.md
  - ✅ reviewed, none present: .specify/templates/commands/*.md
- Runtime guidance:
  - ✅ updated: AGENTS.md
  - ✅ updated: CLAUDE.md
  - ✅ aligned: docs/proposal.md
  - ✅ aligned: docs/architecture.md
  - ✅ aligned: docs/roadmap.md
  - ✅ aligned: specs/004-revision-dynamics/
- Follow-up TODOs: none
-->
# Palimpsest Constitution

## Core Principles

### I. End-to-End Before Model Evaluation (NON-NEGOTIABLE)

Every feature MUST identify its owning roadmap milestone and the part of the complete puzzle lifecycle it makes executable. Live model evaluation for revision dynamics, communication value, or matched calibration MUST NOT begin until the offline end-to-end harness completes generation, launch, reveal, native Git collaboration, freeze, private submission, clean execution, scoring, replay, and redacted reporting with deterministic fixtures and fake model adapters. Gate A and the qualified Gate B decision inform construction; Gates C and D evaluate the completed harness and gate calibration and release claims rather than harness implementation. Thresholds, inputs, environments, and pass, rework, or stop decisions MUST still be frozen before every judged model run. A failed empirical gate MUST invalidate the affected calibration or release claim and return the project to the owning puzzle or harness milestone; thresholds and controls MUST NOT be weakened to manufacture a pass.

Rationale: Palimpsest must first exist as one inspectable system before model behavior is interpreted. Testing isolated fragments early spends model budget on a puzzle different from the integrated artifact and obscures whether failures come from the mechanic or incomplete infrastructure.

### II. Trust Boundaries Are Product Behavior

Trusted generation, control, Git admission, staging, and grading responsibilities MUST remain separated according to `docs/architecture.md`. Agent and clean-solver environments MUST NOT contain oracle data, unreleased or peer-private shards, trusted generation or grading packages, credentials, unsupported network access, or host control surfaces. Privileged components MUST receive only the access required by their declared responsibility. Infrastructure MUST never repair, merge, reinterpret, or conceal an agent mistake. Failures MUST be classified as agent outcomes, retryable trusted failures, or infrastructure integrity/validity failures and handled by the architecture's declared state transition.

Rationale: Isolation and failure semantics determine whether a run is valid, not merely whether the implementation is secure in the conventional sense.

### III. Versioned Contracts and Immutable Provenance

JSON Schema MUST be the TypeScript/Python contract authority. Every cross-runtime contract MUST carry a schema version and have canonical bytes, golden fixtures, and matching acceptance and rejection behavior in both languages. Promoted artifacts MUST bind their immutable inputs, producer and environment versions, exact output set, byte lengths, and SHA-256 digests. Partial, undeclared, malformed, timed-out, or hash-mismatched output MUST NOT become a success-shaped artifact. Contract changes require a new version or an explicit migration; replay MUST NOT silently apply new semantics to an older artifact.

Rationale: A seed or source revision alone cannot reproduce model-, tokenizer-, runtime-, and native-library-sensitive artifacts.

### IV. Deterministic Verification, Honest Claims

Every behavior or contract change MUST include the applicable unit, property, cross-language, Git/concurrency, end-to-end, isolation, security, and replay tests defined by the architecture and roadmap. Scoring and artifact replay MUST be deterministic for sealed inputs and pinned supported environments. Reports MUST distinguish implemented facts, empirical results, calibrated choices, accepted residual risks, and out-of-scope claims. Replay MUST NOT be described as reproducing agent reasoning, model stochasticity, operating-system scheduling, or exact process interleaving.

Rationale: Deterministic grading does not make agent behavior or treatment effects deterministic, and overstated reproducibility would invalidate the artifact's scientific interpretation.

### V. Native, Bounded, Asynchronous Collaboration

Agents MUST collaborate through ordinary authenticated Git workflows exposed by the Git Gateway. Peer-visible logical state MUST be charged cumulatively per authenticated agent under the frozen accounting frame; hidden Git features, unsafe objects, unmetered peer channels, and cross-agent namespaces MUST be rejected. Publication MUST use immutable fixed-slot snapshots and preserve fast-forward, race, and conflict semantics without server-authored merges or rebases. The scheduler MUST NOT impose turns, roles, a predetermined agent order, or coordination logic. Communication-disabled comparisons MUST preserve native Git and compute overhead while applying the exact counterfactual accounting rule.

Rationale: The puzzle studies agent-created coordination under a measurable channel, so replacing Git behavior or asynchronous contention changes the object of study.

## Research and Security Constraints

- The proposal is authoritative for puzzle intent, feasibility questions, scoring interpretation, and research claims. The architecture is authoritative for system boundaries, contracts, failure semantics, and verification. The roadmap schedules delivery without redefining either.
- Python owns corpus preparation, instance generation, baselines, scoring, and replay analysis. TypeScript/Node owns live orchestration, reveal timing, quotas, Git admission, freeze, and the operator surface. Cross-runtime interaction MUST use the versioned subprocess and artifact boundary; in-process FFI and duplicated domain logic are prohibited in the reference architecture.
- Node, Python, package managers, Git, images, model weights, corpus snapshots, schemas, and calibrated policies MUST be pinned for evidence-producing runs. The pnpm and uv dependency graphs and lockfiles MUST remain independent.
- The reference deployment MUST retain one authoritative monotonic run clock, one serialized Git admission sequence, least-privilege service identities, isolated mounts, and network-disabled untrusted solver execution.
- Secrets and source-recognition oracles MUST remain sealed. Public artifacts MUST be redacted and MUST NOT expose master seeds, oracle mappings, prepared plaintext or source hashes, future shard metadata, exact private telemetry, or credentials.
- External factual or novelty claims MUST cite verifiable primary sources. Palimpsest MUST be described as a compound puzzle and research artifact, not as a construct-validated benchmark or a certified measure of reasoning, collaboration, or belief revision.

## Development Workflow and Quality Gates

1. Reconcile a feature with `docs/proposal.md`, `docs/architecture.md`, and `docs/roadmap.md`; record contradictions rather than silently choosing one.
2. The specification MUST name the owning milestone, end-to-end contribution, model-execution policy, completion evidence, trust/visibility effects, failure classification, and invalidated downstream evidence.
3. The plan MUST pass the Constitution Check before research and again after design. Any deviation requires a documented rationale, the simpler or safer alternative rejected, an owner, and the evidence needed to remove it.
4. Contracts, schemas, golden fixtures, and failing verification tests MUST precede implementation of the behavior they govern. Tasks MUST include every applicable verification and evidence artifact; tests are not optional for behavior, contract, trust-boundary, accounting, scoring, or replay changes.
5. A milestone or gate is complete only when its deliverables, required evidence, environment and producer versions, exit decision, and follow-up are recorded as versioned artifacts. The offline end-to-end milestone additionally requires a deterministic build-to-report replay before any new live model evaluation.
6. `pnpm verify` MUST pass from a clean checkout with pinned dependencies before implementation or evidence is declared complete. Release additionally requires the roadmap's full verification suite, valid empirical gates, and no unresolved material red-team finding without an explicit accepted-risk record.

## Governance

This constitution governs all Palimpsest specifications, plans, tasks, reviews, and release decisions. When an artifact conflicts with this constitution, the constitution prevails; within their declared domains, the proposal, architecture, and roadmap remain authoritative as described above.

Amendments require an explicit rationale, affected principles and artifacts, compatibility or migration impact, and maintainer approval. The amendment MUST update dependent Spec Kit templates and runtime guidance in the same change. Versions follow semantic versioning: MAJOR for incompatible principle or governance removals or redefinitions, MINOR for a new principle/section or materially expanded obligation, and PATCH for non-semantic clarification.

Every feature plan and pull request MUST record constitution compliance. Gate and release reviews MUST recheck compliance against produced evidence, not intended design. A temporary exception requires an owner, scope, expiry or removal condition, affected evidence, and explicit maintainer approval; an exception cannot waive gate truthfulness, trust isolation, artifact integrity, or honest reporting.

**Version**: 2.0.0 | **Ratified**: 2026-07-24 | **Last Amended**: 2026-07-26
