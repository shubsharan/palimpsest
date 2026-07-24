# Palimpsest Roadmap

## Purpose

This roadmap turns the [proposal](./proposal.md) and [architecture](./architecture.md) into an executable delivery sequence for the Palimpsest research artifact. The proposal remains authoritative for puzzle intent, feasibility questions, scoring interpretation, and research claims. The architecture remains authoritative for system boundaries, contracts, failure semantics, and verification requirements.

The roadmap is gate-based rather than date-based. Full-harness construction is authorized only after all four empirical feasibility gates pass. Calibrated numeric thresholds must be recorded before each experiment; they are not architectural constants and are not invented here.

The target outcome is a validated, calibrated, red-teamed, single-host research artifact with a reproducible public report bundle. A hosted evaluation service, multi-region deployment, and benchmark-scale claims are out of scope.

## Current status

The proposal and architecture are complete. The repository contains no implementation workspace yet, so all implementation milestones are not started.


| ID | Milestone | Status | Depends on | Responsible workstream | Primary output | Exit decision |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Documentation baseline | Complete | None | Research and architecture | Approved proposal and architecture | Begin implementation |
| 1 | Foundation and evidence protocol | Not started | 0 | Cross-runtime foundation | Reproducible TypeScript/Python workspace and evidence format | Proceed to feasibility work |
| 2 | Channel separation (Gate A) | Not started | 1 | Git accounting and compression | Gate A evidence report | Pass, rework geometry, or stop |
| 3 | Decipherment headroom (Gate B) | Not started | 1 | Generation and baselines | Gate B evidence report and corpus-tier decision | Pass, rework puzzle, or stop |
| 4 | Revision dynamics (Gate C) | Not started | 3 | Generation, reveal, and grading | Gate C evidence report | Pass, rework regime/reveal design, or stop |
| 5 | Communication value (Gate D) | Not started | 2, 3, 4 | Minimal control plane and experiments | Matched Gate D evidence bundles and report | Authorize or reject full harness |
| 6 | Production instance pipeline | Not started | 2–5 passed | Python research plane | Replayable, hash-bound instance bundles | Integrate with live harness |
| 7 | Asynchronous collaboration harness | Not started | 2–5 passed | TypeScript control plane | Isolated, metered, freeze-capable run system | Integrate with grader |
| 8 | Grader, replay, and end-to-end integration | Not started | 6, 7 | Grading and replay | Deterministic build-to-score path | Begin matched calibration |
| 9 | Matched calibration | Not started | 8 | Experimental operations | Frozen calibrated run profile and comparison report | Begin release red team |
| 10 | Red team and validated release | Not started | 9 | Security, research, and release | Reproducible `PublicReportBundle` | Release or return to owning milestone |


Milestones 2 and 3 (Gates A and B) may run concurrently after Milestone 1. Milestone 4 (Gate C) follows Milestone 3 so that revision dynamics are tested on a puzzle with demonstrated decipherment headroom. Milestone 5 (Gate D) follows Milestones 2–4 so it uses a defensible channel budget, solvable instances, and a revision mechanic that produces the intended signal. Only the minimum infrastructure required by a gate may be built before the full-harness authorization decision.

## Milestone 1: Foundation and evidence protocol



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

Proceed when the cross-language boundary and evidence protocol are reproducible enough to support Gates A-D. Contract disagreement or unpinned evidence is a blocking foundation defect, not a gate result.

## Milestone 2: Channel separation (Gate A)



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
- **Stop:** do not tune the cap or weaken accounting to manufacture a pass. Full-harness construction remains unauthorized while separation is absent.



## Milestone 3: Decipherment headroom (Gate B)



### Question

Does the puzzle retain progressive, interpretable headroom above strong mechanical attacks without being dominated by source recognition?

### Deliverables

- Implement the smallest stationary, single-key instance builder needed for several 10-30k-token texts, including stripping, normalization, tokenization, entity regeneration, derangement, rendering, and oracle outputs.
- Implement all five baseline rungs: frequency and syntactic typing, n-gram pseudo-likelihood optimization, context or embedding alignment, frozen contextual-model scoring, and the strongest prior decoder with oracle segmentation.
- Run one frontier agent with tools and one human-plus-tools solver using frozen instances and resource records.
- Audit entity regeneration for missed entities, over-capture, and cross-mention inconsistency.
- Run the cipher-view identification canary, raw-passage generation canary, direct target-identification and retrieval attacks, and at least one non-Gutenberg source.
- Report reconstruction by frequency, function/content class, entity class, and ambiguity rather than only an aggregate score.



### Required evidence

- Strong mechanical methods do not saturate the reconstruction task.
- Capable solvers make progressive gains rather than remaining near zero.
- Residual difficulty concentrates in the designed categories, including rare content words, narrative entities, and ambiguous roles.
- Identification or retrieval does not dominate the solving strategy for the retained default corpus tier.



### Exit decision

- **Pass:** record the retained corpus tier and freeze a puzzle profile suitable for Gate C.
- **Rework:** adjust source tier, entity regeneration, text selection, substitution scope, POS policy, or other documented difficulty dials, then repeat the full baseline and identification suite.
- **Stop:** do not proceed to full infrastructure if mechanical attacks saturate the task or capable solvers cannot make meaningful progress.



## Milestone 4: Revision dynamics (Gate C)



### Question

Does clock-driven partial re-keying produce selective belief revision rather than indiscriminate failure or restart?

### Deliverables

- Extend the validated instance slice with one chapter-aligned partial re-key, active-on-both-sides entry selection, frequency-stratified changed mappings, matched unchanged controls, and oracle contradiction thresholds.
- Add a production-style monotonic reveal clock with precomputed, chapter-atomic releases targeting equal cumulative shard fractions.
- Run a single agent against progressively revealed evidence and capture versioned mapping hypotheses, confidence, provenance, switch hypotheses, and trusted reveal/publication timing.
- Implement the minimum grader slice for active-type accuracy, changed and unchanged mapping trajectories, false retractions, switch events, detection latency, and adaptation latency.



### Required evidence

- Early mappings become accurate before contradictory evidence is released.
- Changed mappings deteriorate after the switch while matched stable mappings remain useful.
- A competent solver detects the localized failure and selectively recovers changed entries without discarding the stable dictionary.
- Measurements use the monotonic reveal clock and oracle-defined contradiction threshold, never model turns, token milestones, or inspection order.



### Exit decision

- **Pass:** freeze a regime and reveal profile suitable for the matched communication fixture.
- **Rework:** adjust rotation fraction, active threshold, changed token mass, minimum segment length, switch placement, or reveal cadence, then repeat.
- **Stop:** full-harness construction remains unauthorized if the mechanic only causes general collapse or produces no observable revision signal.



## Milestone 5: Communication value (Gate D)



### Question

Does constrained asynchronous Git communication change outcomes or produce a materially richer, attributable solving trace?

### Deliverables

- Build the smallest three-agent, contiguous-shard fixture with isolated sandboxes, native Git workflows, production publication slots, monotonic reveal, per-agent accounting, deadlines, freeze, and private deliverables.
- Run paired communication-enabled and communication-disabled arms with the same instances, shard assignments, compute, reveal schedule, deadlines, Git-client overhead, and trial order policy.
- In the disabled arm, preserve each agent's own Git workflow while hiding teammate state and applying the exact counterfactual `GitAccountingFrameV1` debit.
- Capture accepted and rejected pushes, publication snapshots, pulls, conflicts, duplicate work, hypotheses, resource use, and final reconstructions.



### Required evidence

- Both arms use asynchronous agents, ordinary Git behavior, production publication timing, and identical accounting semantics.
- Communication changes reconstruction outcomes or produces a materially richer trace of cross-shard discrepancy attribution and belief revision.
- The effect is supported by matched evidence and is not inferred from a single lucky run.
- No private shard, unreleased chapter, oracle, or private submission crosses a visibility boundary.



### Exit decision

- **Pass:** issue the full-harness authorization record only after Gate A, Gate B, Gate C, and Gate D reports all record passing results.
- **Rework:** change only the owning puzzle, channel, reveal, or comparison design and rerun every invalidated upstream gate.
- **Stop:** do not build the production harness if communication has no meaningful effect under a valid matched comparison.



## Milestone 6: Production instance pipeline



### Deliverables

- Complete corpus adapters for the retained source tiers, metadata filtering, boilerplate stripping, chapter parsing, MinHash/LSH and structural deduplication, and a manifest-bound agent reference corpus.
- Complete versioned normalization, tokenization, consistent proper-noun regeneration, seeded initial and rotated keys, matched controls, sharding, boundary-near and interior switch placement, and reveal-plan generation.
- Emit public, reference-corpus, private-shard, reveal, difficulty, and sealed oracle artifacts using the shared contract and packaging rules.
- Preserve explicit encryption and recovered-mapping directions and prevent secret seeds, source fingerprints, keys, switch truth, or future chapter hashes from entering public artifacts.



### Required evidence and exit

Pass the architecture's Python property suite and cross-language round trips, including determinism, bijection and derangement, active thresholds, matched controls, contiguous chapter-aligned sharding, rendering preservation, deduplication, and visibility projections. Exit with replayable, hash-bound instances accepted by the TypeScript preflight without conversion-specific domain logic.

## Milestone 7: Asynchronous collaboration harness



### Deliverables

- Implement the operator CLI, run coordinator, reveal daemon, compute quota monitor, host model bridge, isolated agent containers, Git Gateway, event append service, and private submission store.
- Implement the lifecycle from `PREPARED` through `SUBMITTED`, including the common launch barrier, immutable publication snapshots, push closure, bounded drain, freeze, pull-only finalization, and output sealing.
- Enforce authenticated ref policy, quarantine, snapshot-gated fetch, logical state accounting, transactional reservations, cumulative budgets, rate limits, visibility journaling, and canonical server-generated fetch packs.
- Record hash-chained, idempotent lifecycle, reveal, quota, Git, freeze, pull, submission, and infrastructure events with crash recovery or explicit run invalidation.



### Required evidence and exit

Pass the TypeScript state-machine, timing, quota, crash-consistency, Git accounting, concurrency, native workflow, isolation, and freeze-race suites. Exit when an isolated run can reach a consistent frozen repository and sealed private outputs without trusted components repairing agent mistakes.

## Milestone 8: Grader, replay, and end-to-end integration



### Deliverables

- Implement hostile solver-bundle validation, filtered input staging, clean network-disabled execution, and byte-for-byte comparison with the withheld reconstruction.
- Implement reconstruction, entity, dictionary, changed/stable, switch, latency, collaboration, and optional confidence scoring under a versioned `ScoringPolicy`.
- Reconstruct repository, visibility, ledger, event, hypothesis, and scoring states from a sealed `TrustedReplayBundle`.
- Produce time-series plots, a complete `ScoreReport`, and a redacted `PublicReportBundle` without claiming to replay agent decisions or operating system scheduling.



### Required evidence and exit

Pass cross-language artifact tests, hostile-bundle tests, non-Python solver execution, score-formula fixtures, replay digest checks, and the pinned build-to-launch-to-score scenario. Exit when replay reproduces every accepted ref/object state, ledger total, freeze digest, solver result, and report from immutable inputs.

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
| 3–4 | `InstanceBuildRequest`, `PublicInstanceManifest`, `OracleManifest`, `DifficultyConfig`, `ScoringPolicy`, reveal and hypothesis fixtures |
| 5 | Minimal `RunManifest`, `PublishedSnapshot`, ledger, event, freeze, and private deliverable fixtures |
| 6 | `AgentReferenceCorpusManifest`, `ShardManifest`, `ReleasedShardManifest`, `RevealSchedule`, complete generation manifests |
| 7 | `PushLedgerEntry`, `RunEvent`, `FreezeSnapshot`, complete run-control contracts |
| 8 | `PrivateDeliverableManifest`, `TrustedReplayBundle`, `ScoreReport`, `PublicReportBundle` |


Contract changes require a new version or explicit migration. Replay must never silently interpret an older artifact using newer semantics.

## Verification map


| Milestone | Required verification categories |
| --- | --- |
| 1 | Cross-language contracts, canonicalization, deterministic artifact promotion |
| 2 | Git accounting, adversarial compression, metadata and timing capacity |
| 3 | Python unit/property tests, baseline reproducibility, source-recognition and entity audits |
| 4 | Python generation properties, reveal-clock behavior, scoring fixtures, single-agent end to end |
| 5 | Git concurrency, matched-arm equivalence, counterfactual accounting, isolation |
| 6 | Python unit/property tests and cross-language instance round trips |
| 7 | TypeScript unit tests, Git accounting/concurrency, lifecycle, crash recovery, isolation |
| 8 | Cross-language, end-to-end, replay, hostile solver, and score-formula tests |
| 9 | Matched-run validity, artifact completeness, parameter and assignment provenance |
| 10 | Full verification suite, security tests, red-team reruns, release reproduction |


Architecture verification proves implementation invariants. Gate reports provide the empirical evidence that the puzzle is worth building and that its mechanics remain load-bearing.

## Project controls

- A milestone is complete only when its deliverables, required evidence, and exit decision are recorded in versioned artifacts.
- Gate thresholds and calibrated parameters are declared before the run whose result they judge. Post-hoc threshold changes require a new report and rerun.
- A failed gate blocks downstream work. A design change reruns that gate and every downstream result it invalidates.
- Agent errors remain scoreable outcomes. Infrastructure integrity or validity failures invalidate the affected run and its matched pair according to the architecture.
- The reference deployment remains on one dedicated host with one authoritative run clock and one serialized Git admission sequence.
- Public reporting distinguishes implemented facts, empirical results, calibrated choices, accepted residual risks, and claims that remain out of scope.



## Definition of done

Palimpsest is delivered when:

- Gates A-D have passing reports against the released implementation and recorded predeclared thresholds;
- the complete single-host run lifecycle succeeds from pinned instance inputs through frozen Git state, private submission, clean solver execution, replay, scoring, and redacted export;
- the required Python, TypeScript, cross-language, Git/concurrency, end-to-end, isolation, and security suites pass;
- matched calibration fixes a reference run profile with complete provenance;
- the release red team has no unresolved material finding without an explicit accepted-risk record; and
- an independent clean environment can reproduce the sealed reports and `PublicReportBundle` from the declared immutable inputs.

