# Data Model: Lean Experiment Engine

Public code interfaces use the unversioned names below. Each serialized top-level document contains numeric `schemaVersion: 1`.

## FixtureDefinition

Research-authored inputs for deterministic preparation.

- `fixtureId`: unique stable identifier.
- `source`: provenance registry ID plus the declared window or committed window selection.
- `references`: ordered provenance registry IDs; the target source is forbidden.
- `seed`: safe integer scientific seed.
- `agentIds`: ordered, unique identifiers; at least two.
- `stageCount`: positive safe integer.
- `variants`: non-empty ordered declarations. Each has a unique `variantId`, key regime, and for re-key variants one boundary ordinal and manipulation requirements.
- `allocation`: scientifically interpretable requirements for coverage, balance, specialist evidence, stable controls, and manipulation strength. Builder search limits are not serialized here.

### Validation

- Referenced corpus bytes and provenance digests must exist and match.
- Agent IDs and variant IDs are unique; stage and re-key ordinals fit the declared geometry.
- Reference sources exclude the target.
- All declared allocation/manipulation requirements must be satisfied before publication.

## FixturePackage

Trusted, prepared, immutable input to one or more runs.

- `fixtureId`, `schemaVersion`, and `contentDigest`.
- `definition`: normalized resolved definition.
- `provenance`: exact source/reference identities, windows, and byte digests.
- `agentIds` and `stageCount`.
- `variants`: each variant's ID, key schedule, ordered per-agent stage paths and digests, complete ciphertext path/digest, and variant digest.
- `references`: target-excluded agent-visible paths and digests.
- `oracle`: trusted plaintext, key, allocation, and scoring paths/digests.
- `manipulationChecks`: trusted deterministic assertions and metrics.
- `scoring`: declared reconstruction interface and aggregate score contract.

### Validation

- The content digest covers the canonical package manifest without `contentDigest` plus a sorted `{ path, sha256 }` projection of every regular package file except `fixture.json`.
- Every agent has exactly one stage for every ordinal in every variant.
- Paths are relative, unique, contained by the package, and match their bytes.
- Variants share the declared allocation and pre-boundary evidence; changes satisfy only their declared boundaries and checks.
- Agent-visible trees and references contain no oracle, key, label, expectation, or manipulation-check data.

## ExperimentManifest

One complete declaration of provider bindings and ordered runs.

- `providers`: named provider connections with driver, endpoint/options where supported, and credential environment-variable name.
- `models`: named model profiles referencing providers and request settings.
- `totalSpendCeilingCents`: non-negative safe integer bounding all declared run ceilings.
- `runs`: non-empty ordered list of `RunDeclaration` values.

### RunDeclaration

- `id`: unique immutable run identifier.
- `fixture`: package path plus selected variant.
- `variantId`: an available package variant.
- `agents`: exact map from fixture agent ID to model profile.
- `capabilities.git`: `shared` or `isolated`.
- `capabilities.teamRoom`: `enabled` or `disabled`; enabled is valid only with shared Git.
- `releaseOffsetsMs`: one safe integer per fixture stage, beginning at zero and strictly increasing.
- `cutoffMs`: safe positive integer greater than the last release.
- `limits.tokenLimitPerAgent`: positive safe integer or `null` for clock-only execution.
- `limits.spendCeilingCents`: non-negative safe integer.
- `labels`: secret-free JSON object used only for analysis grouping.

### Validation

- Run IDs, provider IDs, and model profile IDs are unique in their namespaces.
- Agent keys equal package agent IDs exactly, and all model references resolve.
- The package decodes successfully, its content digest matches its bytes, and the selected variant exists.
- Sum of run ceilings does not exceed the experiment ceiling.
- Credential fields name environment variables and never contain credential values.
- Labels cannot alter runtime behavior and must pass secret-bearing-key rejection.

## ResolvedRun

Internal immutable projection created immediately before execution.

- `manifestDigest`, run `id`, and source manifest path.
- Verified `FixturePackage` identity and selected variant.
- Fully resolved secret-free model bindings and agent assignments.
- Communication topology, schedule, resource limits, spending authorization, labels, and sandbox identity.
- Exact package validation for the current run plus a shared validation snapshot identifying the declared run used for the representative provider-free smoke path.

Credentials are resolved only at provider-call boundaries and are never part of this value.

### ExperimentValidationSnapshot

- Exact manifest path and digest, configured sandbox identity, validation timestamp, and explicit spend authorization.
- `fixture`: the current run's exact package path, fixture ID, and content digest.
- `smoke`: one representative provider-free run with an explicit `sourceRunId`, validation-run ID, fixture ID/digest, variant, agent IDs, and stage count.
- Full-manifest execution uses the first declared run as `sourceRunId`; selected execution uses the selected run. The smoke fixture need not equal a later run's exact fixture, but the snapshot is shared only after every run/package relationship validates and the sandbox probe succeeds.

## RunRecord

Durable normalized record for one run.

- `schemaVersion`, `manifestDigest`, run `id`, and `status`: `completed` or `infrastructure-error`.
- `startedAt`, `frozenAt`, and `publishedAt` timestamps.
- `configuration`: the complete `ResolvedRun` secret-free projection and its digest.
- `trace`: canonical relative paths `trace.jsonl` and `trace.meta.json`.
- `releases`: ordered release observations tied to agent, stage, variant, and visible file digest.
- `sessions`: requested/actual model identity, normalized usage, final response when present, safe returned summaries when available, termination, and infrastructure error when applicable.
- `topology`: frozen shared or isolated repositories and agent workspaces with exact captured origin IDs, `main` commits when present, and tree seals.
- `evaluations`: append-only logical history of ordered `EvaluationBatch` values.
- `analyses`: append-only logical history of optional post-publication analysis results.
- `infrastructureFailure`: explicit failure category and message when run-level infrastructure failed.

### State Transitions

```text
declared -> validated -> running -> frozen -> evaluated -> published
                         |                        |
                         +-> session infrastructure error -- freeze/evaluate/publish

setup/lifecycle/freeze/evaluation throw --> interrupted directory (trace may exist; no RunRecord)
published -- re-evaluate/analyze --> atomically replaced RunRecord with appended history
```

- Missing spend authorization is rejected before sandbox or smoke work. Provider access and adapter construction are forbidden until every run/package relationship validates, the sandbox probe succeeds, and the representative smoke completes.
- Final publication occurs only after sessions stop and available repositories/workspaces are frozen.
- A session infrastructure result does not cancel peers; after every session quiesces, complete session results and available topology are frozen, evaluated, and published with `status: infrastructure-error`, then the experiment stops.
- A thrown setup, lifecycle, freeze, or evaluation failure appends and flushes one `infrastructure.error` event when the trace exists, propagates, and publishes no partial `RunRecord`.
- Publication and re-evaluation require the canonical relative trace paths and validate the current appendable trace structurally through `JsonlObservationLog.open`; no trace hash, event-count seal, or immutable prefix is recorded.
- Re-evaluation additionally requires the currently loaded package digest to equal the recorded fixture digest before solver execution.
- Re-evaluation and analysis cannot alter configuration, trace, topology, earlier results, or status.

## EvaluationBatch and EvaluationResult

An evaluation batch records one complete pass over every canonical origin. It has one `evaluationId`, `evaluatedAt` timestamp, `kind` (`automatic` or `review`), and ordered `results`. The first batch is automatic; every later batch is a review.

Each `EvaluationResult` is one outcome for one canonical origin at one frozen commit.

- `originId` and the ordered `agentIds` served by that origin.
- Captured literal `main` commit or explicit missing-publication status.
- Solver interface, isolated execution result, bounded output identity, aggregate reconstruction score when available, and explicit error status otherwise.

### Canonical-Origin Rule

- Shared topology yields one automatic result for the shared origin.
- Isolated topology yields one automatic result for every agent origin.
- Results remain ordered by fixture agent order, and no best result or workspace candidate is selected.

## TraceEvent

Append-only chronological observation with sequence, relative time, event type, agent when applicable, and secret-free payload. Event families cover lifecycle, evidence release, model response metadata, safe returned summaries, tool/checker calls and results, Git/room activity, termination, freezing, evaluation, and infrastructure errors. Complete provider bodies, hidden reasoning, credentials, keys, oracle material, and unreleased evidence are invalid payloads.
