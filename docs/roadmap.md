# Palimpsest Roadmap

## Purpose

This roadmap turns the [proposal](./proposal.md) and [architecture](./architecture.md) into an executable delivery sequence for the Palimpsest research artifact. The proposal remains authoritative for puzzle intent, feasibility questions, scoring interpretation, and research claims. The architecture remains authoritative for system boundaries, contracts, failure semantics, and verification requirements.

The roadmap is evidence-ordered rather than date-based. Gate A and the bounded Gate B product decision justify construction of the complete offline harness. That harness must pass deterministic build-to-report integration before any new live model evaluation. Gates C and D then validate the integrated artifact and gate calibration and release claims. Calibrated numeric thresholds must be recorded before each judged experiment; they are not architectural constants and are not invented here.

The target outcome is a validated, calibrated, red-teamed, single-host research artifact with a reproducible public report bundle. A hosted evaluation service, multi-region deployment, and benchmark-scale claims are out of scope.

## Current status

The proposal, architecture, Milestone 1 foundation, Gate A channel separation, and the bounded Gate B product decision are complete. The pinned TypeScript/Python workspace, cross-runtime contracts, artifact-promotion boundary, evidence protocol, exact Git accounting frame, and adversarial capacity sweep pass their frozen verification on the supported Darwin ARM64 development profile. Gate A freezes `GitAccountingFrameV1` and a 19-38 KiB cumulative interval for the retained 27,000-token, 8,000-type geometry. Gate B records a qualified product-feasibility pass based on the unrecognized-literary Amber observation. The reusable offline Gate C instance, reveal, scoring, and replay slice is implemented, but its live solver attempt is explicitly deferred. The current milestone is the production instance and end-to-end harness path; no further OpenAI calls occur until deterministic build-to-report integration passes.

| ID | Milestone | Status | Depends on | Responsible workstream | Primary output | Exit decision |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Documentation baseline | Complete | None | Research and architecture | Approved proposal and architecture | Begin implementation |
| 1 | Foundation and evidence protocol | Complete | 0 | Cross-runtime foundation | Reproducible TypeScript/Python workspace and evidence format | Proceed to feasibility work |
| 2 | Channel separation (Gate A) | Complete | 1 | Git accounting and compression | Gate A evidence report | Freeze the production accounting frame |
| 3 | Decipherment headroom (Gate B) | Qualified pass | 1 | Generation and baselines | Bounded feasibility decision | Begin complete offline harness construction |
| 4 | Production instance pipeline | In progress | 1–3 | Python research plane | Replayable, hash-bound instance bundles | Integrate with the collaboration runtime |
| 5 | Asynchronous collaboration harness | Not started | 2, 4 | TypeScript control plane | Isolated, metered, freeze-capable run system | Integrate with grader and replay |
| 6 | Grader, replay, and end-to-end integration | Not started | 4, 5 | Grading and replay | Deterministic build-to-report path | Authorize live model validation |
| 7 | Revision dynamics (Gate C) | Deferred | 6 and API capacity | Integrated puzzle validation | Gate C evidence report | Pass, rework the owning mechanic, or stop empirical progression |
| 8 | Communication value (Gate D) | Not started | 6, 7 | Integrated collaboration validation | Matched Gate D evidence bundles and report | Authorize or reject matched calibration |
| 9 | Matched calibration | Not started | 7, 8 passed | Experimental operations | Frozen calibrated run profile and comparison report | Begin release red team |
| 10 | Red team and validated release | Not started | 9 | Security, research, and release | Reproducible `PublicReportBundle` | Release or return to owning milestone |

Milestones 2 and 3 provide the evidence needed to choose the information geometry and retained puzzle profile. Milestones 4–6 then build and verify the full offline lifecycle with deterministic fixtures and fake model adapters. No live solver, multi-agent model, or calibration call is permitted during those milestones. Gate C follows Milestone 6 on the integrated reveal and scoring path; Gate D follows Gate C on the same integrated collaboration path. A Gate C or D failure may require rebuilding an owning Milestone 4–6 component and rerunning the deterministic end-to-end suite before another judged attempt.

## Milestone 1: Foundation and evidence protocol

Milestone 1 passes its binary exit criteria. The canonical [gate report](../artifacts/milestone-1/gate-report.json) binds the predeclared inputs and thresholds to cross-runtime fixture verdicts, promotion-failure evidence, and an offline frozen clean-snapshot verification. The [milestone report](../artifacts/milestone-1/milestone-report.json) authorizes only Gate A and Gate B feasibility work; it does not authorize the full harness or claim a Gate A-D result.

### Deliverables

- Create the intended pnpm workspace for TypeScript/Node components and the uv workspace for Python research components, with independent lockfiles and pinned supported runtimes.
- Establish the target directory boundaries from the architecture without installing trusted generation or grading code in agent-facing packages or images.
- Make JSON Schema the cross-language contract authority. Add `schemaVersion`, canonical JSON and archive rules, derived or validated TypeScript/Python bindings, and golden fixtures.
- Implement artifact manifests with SHA-256 digest, byte length, producer version, immutable inputs, and an exact declared output set.
- Provide a single root `pnpm verify` command that invokes both ecosystems without merging their dependency graphs.
- Define a versioned gate-report format containing the hypothesis, frozen inputs, declared thresholds, environment and producer versions, raw artifact references, analysis, result, and follow-up decision.

### Required evidence

- TypeScript and Python accept the same valid fixtures and reject the same invalid fixtures, including large seeds, Unicode, paths, numeric boundaries, hashes, unknown fields, and schema-version changes.
- Repeating a frozen request in the supported environment produces the same artifact bytes and hashes.
- Timeout, process failure, malformed progress, partial output, undeclared output, or hash mismatch promotes no success-shaped artifact.
- The root verification command succeeds from a clean checkout using only pinned dependencies and inputs.

### Exit decision

Proceed when the cross-language boundary and evidence protocol are reproducible enough to support the offline harness and later Gates A-D. Contract disagreement or unpinned evidence is a blocking foundation defect, not a gate result.

## Milestone 2: Channel separation (Gate A)

Gate A passes its predeclared decision rule. The retained 27,000-token, 8,000-type geometry carries all four faithful useful-state checkpoints at a cumulative charge of 18,503 bytes, while the strongest tested exact full-shard relay costs 39,534 bytes. The separately bounded 120-bit publication-presence channel contributes 15 bytes. The resulting passing interval contains 20 adjacent 1 KiB sweep points from 19,456 through 38,912 bytes. The [gate report](../artifacts/gate-a/gate-report.json), [milestone report](../artifacts/gate-a/milestone-report.json), [raw sweep summary](../artifacts/gate-a/raw/sweep-summary.json), and [frontier plot](../artifacts/gate-a/raw/frontiers.svg) bind the decision and its limitations. The result authorizes Gate B only.

### Question

Does a usable cumulative outbound budget interval exist in which agents can share an evolving belief state but cannot relay a complete shard?

### Deliverables

- Implement the exact prefix-free `GitAccountingFrameV1` encoder over real ref operations and newly peer-visible commits, trees, and blobs.
- Build the adversarial Git and shard-compression harness using real repositories, shared objects, compressed blobs, publication-slot capacity, and production frame overhead.
- Test complete-shard and useful-belief encodings, including token-ID coding, sparse and complete dictionaries, reference-corpus-conditioned coding, custom codebooks, metadata-heavy Git histories, and cumulative updates across a run.
- Give the strongest attacker every declared common input, including the agent reference corpus, `GitGenesis`, schemas, scaffold, client behavior, and custom side information.
- Produce a budget sweep showing complete frame charges, useful-state costs, strongest complete-shard relay costs, and sensitivity to text and vocabulary geometry.

### Required evidence

- The same logical transaction has the same charge regardless of pack compression, delta bases, object order, or supported Git client version.
- Ref, filename, commit, tree, blob, topology, timestamp, and object-selection capacity is either charged or rejected according to the architecture.
- The strongest tested complete-shard encoding remains above at least one practical useful-belief budget under the exact production accounting rules.

### Exit decision

- **Pass:** freeze the tested accounting version and defensible budget interval for use by later gates.
- **Rework:** if no interval exists, increase text length first, then adjust vocabulary restraint, shard geometry, or the minimum useful shared state. Rerun Gate A after any change.
- **Stop:** do not tune the cap or weaken accounting to manufacture a pass. Harness construction remains blocked while separation is absent.

## Milestone 3: Decipherment headroom (Gate B)

Gate B records a qualified product-feasibility pass for the retained unrecognized-literary stationary profile. In the accepted Amber observation, a frontier model developed semantic mappings beyond the tested mechanical attempt without identifying the source. This answers the product question needed before testing partial re-keying.

The [qualified feasibility decision](../artifacts/gate-b/qualified-feasibility-decision.json) is intentionally not a completed gate report. The original judged Amber outputs were cleared during a later corpus reset, so immutable replay is unavailable. Non-literary generalization, human comparison, three-role replication, complete identification coverage, and publication-grade replay are deferred rather than silently claimed.

### Question

Does the puzzle retain progressive, interpretable headroom above strong mechanical attacks without being dominated by source recognition?

### Deliverables

- Retain one reproducible stationary, single-key unrecognized-literary profile with public and oracle separation.
- Compare a mechanical attempt with a capable semantic solver observation.
- Separate semantic progress from source-recognition assistance.
- Record the bounded conclusion and its evidence limitation before building the integrated puzzle profile.

### Required evidence

- The tested mechanical attempt leaves room for additional coherent semantic mappings.
- A capable solver exploits that room on unrecognized literary material.
- The accepted progress does not depend on identifying or copying the source.

### Exit decision

- **Qualified pass:** retain the unrecognized-literary profile and proceed to the production instance and offline harness milestones.
- **Defer:** require a new predeclared run before making non-literary, human-comparative, multi-instance, or publication-grade claims.
- **Stop:** do not construct or empirically validate this puzzle profile.

## Milestone 4: Production instance pipeline

### Deliverables

- Complete corpus adapters for the retained source tiers, metadata filtering, boilerplate stripping, chapter parsing, MinHash/LSH and structural deduplication, and a manifest-bound agent reference corpus.
- Complete versioned normalization, tokenization, consistent proper-noun regeneration, seeded initial and rotated keys, matched controls, sharding, boundary-near and interior switch placement, and reveal-plan generation.
- Emit public, reference-corpus, private-shard, reveal, difficulty, and sealed oracle artifacts using the shared contract and packaging rules.
- Preserve explicit encryption and recovered-mapping directions and prevent secret seeds, source fingerprints, keys, switch truth, or future chapter hashes from entering public artifacts.

### Required evidence and exit

Pass the architecture's Python property suite and cross-language round trips, including determinism, bijection and derangement, active thresholds, matched controls, contiguous chapter-aligned sharding, rendering preservation, deduplication, and visibility projections. Exit with replayable, hash-bound instances accepted by the TypeScript preflight without conversion-specific domain logic.

Live model execution is prohibited in this milestone. Synthetic solver checkpoints and deterministic fixture agents exercise all public projections and submission contracts.

## Milestone 5: Asynchronous collaboration harness

### Deliverables

- Implement the operator CLI, run coordinator, reveal daemon, compute quota monitor, host model bridge, isolated agent containers, Git Gateway, event append service, and private submission store.
- Implement the lifecycle from `PREPARED` through `SUBMITTED`, including the common launch barrier, immutable publication snapshots, push closure, bounded drain, freeze, pull-only finalization, and output sealing.
- Enforce authenticated ref policy, quarantine, snapshot-gated fetch, logical state accounting, transactional reservations, cumulative budgets, rate limits, visibility journaling, and canonical server-generated fetch packs.
- Record hash-chained, idempotent lifecycle, reveal, quota, Git, freeze, pull, submission, and infrastructure events with crash recovery or explicit run invalidation.

### Required evidence and exit

Pass the TypeScript state-machine, timing, quota, crash-consistency, Git accounting, concurrency, native workflow, isolation, and freeze-race suites. Exit when an isolated run can reach a consistent frozen repository and sealed private outputs without trusted components repairing agent mistakes.

The host model bridge uses a deterministic fake adapter during this milestone. It must exercise the same launch, compute-accounting, file, Git, deadline, and submission boundaries as the later live adapter without making external model calls.

## Milestone 6: Grader, replay, and end-to-end integration

### Deliverables

- Implement hostile solver-bundle validation, filtered input staging, clean network-disabled execution, and byte-for-byte comparison with the withheld reconstruction.
- Implement reconstruction, entity, dictionary, changed/stable, switch, latency, collaboration, and optional confidence scoring under a versioned `ScoringPolicy`.
- Reconstruct repository, visibility, ledger, event, hypothesis, and scoring states from a sealed `TrustedReplayBundle`.
- Produce time-series plots, a complete `ScoreReport`, and a redacted `PublicReportBundle` without claiming to replay agent decisions or operating system scheduling.

### Required evidence and exit

Pass cross-language artifact tests, hostile-bundle tests, non-Python solver execution, score-formula fixtures, replay digest checks, and the pinned build-to-launch-to-score scenario. Exit when replay reproduces every accepted ref/object state, ledger total, freeze digest, solver result, and report from immutable inputs.

### Live-model authorization

Milestone 6 is complete only when one pinned offline command performs:

`build -> launch -> reveal -> collaborate -> freeze -> submit -> clean execute -> score -> replay -> redact`

The command must use a production-shaped three-agent fixture, native Git repositories, the frozen accounting frame, deterministic fake model adapters, and exact immutable evidence identities. Its passing report authorizes Gate C and Gate D model evaluation; it does not itself make an empirical model claim.

## Milestone 7: Revision dynamics (Gate C)

The reusable two-regime instance, monotonic reveal runner, streamed solver adapter, deterministic scoring, decision rule, and explicit-attempt replay are implemented. The live attempt is deferred until Milestone 6 completes. The historical `insufficient_quota` admission record remains an execution diagnostic, not a Gate C result.

### Question

Does clock-driven partial re-keying produce selective belief revision rather than indiscriminate failure or restart in the integrated harness?

### Deliverables

- Run one declaration-bound solver against the integrated instance, reveal, execution, scoring, and replay path.
- Capture versioned mapping hypotheses, confidence, provenance, switch hypotheses, observable work, and trusted timing.
- Score active-type accuracy, changed and unchanged trajectories, false retractions, switch events, detection latency, and adaptation latency.

### Required evidence

- Early mappings become accurate before contradictory evidence is released.
- Changed mappings deteriorate after the switch while matched stable mappings remain useful.
- A competent solver detects the localized failure and selectively recovers changed entries without discarding the stable dictionary.
- Measurements use the monotonic reveal clock and oracle-defined contradiction threshold, never model turns, token milestones, or inspection order.

### Exit decision

- **Pass:** freeze the integrated regime and reveal profile for Gate D.
- **Rework:** change the owning puzzle or harness dial, rerun Milestone 6, issue a new declaration, and repeat.
- **Stop:** do not proceed to communication-value or calibration claims if the mechanic causes general collapse or no observable revision signal.

## Milestone 8: Communication value (Gate D)

### Question

Does constrained asynchronous Git communication change outcomes or produce a materially richer, attributable solving trace in the integrated harness?

### Deliverables

- Run paired three-agent communication-enabled and communication-disabled arms through the same production instance, runtime, grading, and replay path.
- Keep instances, shard assignments, compute, reveal schedule, deadlines, Git-client overhead, and trial-order policy matched.
- Preserve each agent's own Git workflow in the disabled arm while hiding teammate state and applying the exact counterfactual `GitAccountingFrameV1` debit.
- Capture accepted and rejected pushes, publication snapshots, pulls, conflicts, duplicate work, hypotheses, resource use, final reconstructions, scores, and replay evidence.

### Required evidence

- Both arms use asynchronous agents, ordinary Git behavior, production publication timing, and identical accounting semantics.
- Communication changes reconstruction outcomes or produces a materially richer trace of cross-shard discrepancy attribution and belief revision.
- The effect is supported by matched evidence and is not inferred from a single lucky run.
- No private shard, unreleased chapter, oracle, or private submission crosses a visibility boundary.

### Exit decision

- **Pass:** authorize matched calibration.
- **Rework:** change only the owning puzzle, channel, reveal, or comparison design; rerun Milestone 6 and every invalidated empirical gate.
- **Stop:** retain the completed puzzle artifact but do not make communication-value, calibration, or validated-release claims.

## Milestone 9: Matched calibration

### Deliverables

- Run paired stationary and changing-key conditions.
- Run paired communication-enabled and communication-disabled teams.
- Run hidden and oracle segmentation conditions.
- Run one centralized all-shard agent as the pooling upper bound.
- Pair books, seeds, reveal plans, shard assignments, hardware topology, and compute policies; rotate agent-to-shard and hardware-slot assignments across recorded repetitions.
- Review raw results, matched differences, trajectories, source-recognition evidence, failures, and run validity before freezing the reference profile.

### Exit decision

Freeze versioned difficulty, scoring, reveal, publication, communication, compute, finalization, and rate-limit parameters only after the evidence review. Treat matched differences as calibration evidence rather than publication-grade causal estimates. Invalid paired runs are rerun from their frozen matched configuration; puzzle changes return to the earliest invalidated feasibility gate.

## Milestone 10: Red team and validated release

### Deliverables

- Re-run the strongest conditional compression attacks using the exact released accounting implementation and shared side information.
- Audit Git logical, transport, object-selection, timing, push-presence, rejection-pattern, and resource-exhaustion surfaces.
- Test source identification, corpus and image leakage, mount and credential isolation, hostile solver archives, grader gaming, output copying, and degenerate solver strategies.
- Resolve material findings or record an explicit owner, rationale, impact, and accepted residual risk.
- Assemble pinned manifests, the sealed replay bundle, score reports, plots, sanitized trace, calibration evidence, red-team report, and reproducible `PublicReportBundle`.

### Exit decision

Release only when all required verification suites pass, all empirical gates remain valid under the release implementation, and every material red-team finding is resolved or explicitly accepted. Any finding that invalidates channel separation, decipherment headroom, revision dynamics, communication value, isolation, or score integrity returns the project to the owning gate or milestone.

## Contract readiness

The contracts and field semantics in the architecture are authoritative. The roadmap schedules their implementation without redefining their wire shapes.

| Milestone | Contracts first required |
| --- | --- |
| 1 | Shared schema/version envelope, canonical JSON, canonical archive, artifact response manifest, gate report |
| 2 | `GitAccountingFrameV1`, `GitGenesis`, accounting fixtures |
| 3 | Stationary profile, qualified decision, and reusable reveal/hypothesis fixtures |
| 4 | `InstanceBuildRequest`, `PublicInstanceManifest`, `OracleManifest`, `DifficultyConfig`, `ScoringPolicy`, `AgentReferenceCorpusManifest`, `ShardManifest`, `ReleasedShardManifest`, and `RevealSchedule` |
| 5 | `RunManifest`, `PublishedSnapshot`, `PushLedgerEntry`, `RunEvent`, `FreezeSnapshot`, and private deliverable fixtures |
| 6 | `PrivateDeliverableManifest`, `TrustedReplayBundle`, `ScoreReport`, `PublicReportBundle`, and offline-harness completion report |
| 7 | Solver checkpoints, revision trajectory, and Gate C decision |
| 8 | Matched-arm manifests, counterfactual ledger evidence, and Gate D decision |

Contract changes require a new version or explicit migration. Replay must never silently interpret an older artifact using newer semantics.

## Verification map

| Milestone | Required verification categories |
| --- | --- |
| 1 | Cross-language contracts, canonicalization, deterministic artifact promotion |
| 2 | Git accounting, adversarial compression, metadata and timing capacity |
| 3 | Python unit/property tests, baseline reproducibility, source-recognition and entity audits |
| 4 | Python generation properties, cross-language instance round trips, visibility projections |
| 5 | TypeScript lifecycle, Git accounting/concurrency, crash recovery, native workflow, isolation |
| 6 | Cross-language build-to-report integration, replay, hostile solver, score formulas, fake-adapter equivalence |
| 7 | Integrated single-agent reveal, revision scoring, attempt isolation, empirical decision replay |
| 8 | Matched-arm equivalence, counterfactual accounting, multi-agent isolation, empirical decision replay |
| 9 | Matched-run validity, artifact completeness, parameter and assignment provenance |
| 10 | Full verification suite, security tests, red-team reruns, release reproduction |

Architecture verification proves implementation invariants. Gate reports provide the empirical evidence that the puzzle is worth building and that its mechanics remain load-bearing.

## Project controls

- A milestone is complete only when its deliverables, required evidence, and exit decision are recorded in versioned artifacts.
- Gate thresholds and calibrated parameters are declared before the run whose result they judge. Post-hoc threshold changes require a new report and rerun.
- No new live model call is permitted before Milestone 6 records a passing offline-harness completion report.
- A failed Gate C or D blocks downstream empirical work and returns the project to the owning puzzle or harness milestone. After the repair, Milestone 6 and every invalidated empirical result are rerun.
- Agent errors remain scoreable outcomes. Infrastructure integrity or validity failures invalidate the affected run and its matched pair according to the architecture.
- The reference deployment remains on one dedicated host with one authoritative run clock and one serialized Git admission sequence.
- Public reporting distinguishes implemented facts, empirical results, calibrated choices, accepted residual risks, and claims that remain out of scope.

## Definition of done

Palimpsest is delivered when:

- the complete single-host run lifecycle succeeds from pinned instance inputs through frozen Git state, private submission, clean solver execution, replay, scoring, and redacted export;
- Gates A-D have passing reports against that released implementation and recorded predeclared thresholds;
- the required Python, TypeScript, cross-language, Git/concurrency, end-to-end, isolation, and security suites pass;
- matched calibration fixes a reference run profile with complete provenance;
- the release red team has no unresolved material finding without an explicit accepted-risk record; and
- an independent clean environment can reproduce the sealed reports and `PublicReportBundle` from the declared immutable inputs.
