# Architecture

## Purpose

Palimpsest is one local path from a declared puzzle fixture to inspectable model behavior:

```text
ExperimentManifest -> FixturePackage -> RunRecord
```

Python constructs and scores deterministic word-substitution fixtures. TypeScript validates experiment declarations, runs concurrent model sessions, exposes tools and Git, freezes outcomes, and publishes records. Plain files, subprocesses, and Docker boundaries are preferred over services or orchestration frameworks.

## Fixture Preparation

`experiments/config.yaml` maps named runs directly to source, geometry, model, communication, schedule, re-keying, token, and spend inputs. The run key is its identifier. Agent IDs, credential environment variables, source windows, construction randomness, allocation, package identities, and artifact paths are derived. Unknown fields and invalid geometry fail before output publication.

`puzzle:build` invokes the deterministic Python builder and atomically publishes a `FixturePackage`. The package contains:

- resolved construction inputs and exact source provenance;
- ordered private stage files for every inferred agent;
- public ciphertext for one realized key regime;
- trusted plaintext, keys, allocation data, manipulation checks, and scoring inputs; and
- a content digest covering the canonical package manifest and declared files.

Agent-visible trees contain none of the trusted labels or oracle material. Packages contain no reference corpus or variant catalog. Package validation checks path containment, byte digests, complete agent/stage coverage, allocation requirements, and the realized stationary or re-key boundary. Identical run inputs and source bytes produce identical packages.

## Experiment Configuration

One YAML `ExperimentManifest` declares model profiles and a non-empty map of named runs. Every run selects one source, agent count, model, `shared` or `isolated` communication, release durations, cutoff, and spend ceiling. `rekeyAtStage` and `tokenLimitPerAgent` are optional. The selected model applies uniformly, communication derives Git and room capabilities, conventional credential variables are inferred, and total authorization is the sum of run ceilings.

Strict `ms`, `s`, `m`, and `h` durations resolve to milliseconds and are frozen in records. Resolution verifies the exact package bytes and content digest. Derived assignments match package agents exactly, schedule length matches its stages, the model exists, releases begin at zero and increase before the cutoff, and the re-key boundary fits the geometry. Credentials are resolved only at provider-call boundaries.

Runs execute sequentially in manifest order to avoid undeclared cross-run contention. Sessions within one run execute concurrently. There are no generated phases, balanced orders, reservations, replacement lineage, resume state, or automatic retries. Repetition requires a new declared run ID.

## Run Runtime

Provider-backed execution first rejects missing explicit operator spend authorization. The runner then validates the exact manifest and packages, probes the configured sandbox, and completes the provider-free smoke path before provider access. Invalid configuration, package drift, sandbox failure, smoke failure, or missing authorization creates no provider adapter or request.

For each run, TypeScript:

1. creates identical neutral Git scaffolds and agent workspaces;
2. exposes one shared origin and peer activity, or independent private origins with owner-only activity;
3. starts one persistent provider-neutral session per declared agent;
4. releases private stages on the resolved monotonic schedule;
5. exposes ordinary file, shell, Git, waiting, and published-solver checking tools, plus the optional shared room;
6. stops sessions at their final response, optional token limit, or common wall cutoff;
7. freezes every available origin and workspace before evaluation; and
8. evaluates every canonical origin and atomically publishes the run record.

The runner declares the environment and one graded `origin/main:solver.py` interface. It does not prescribe roles, rounds, checkpoints, branch strategy, messaging, commits, merging, or collaboration cadence. Failed sessions or containers remain explicit infrastructure outcomes. The command retains their trace and available frozen state, publishes an infrastructure-error record when possible, and stops before the next run.

## Communication And Git

Shared Git exposes one ordinary peer-visible origin and peer activity. When enabled, the team room is append-only, bounded, and visible to every shared agent. Isolated Git gives each agent a usable private origin and never constructs peer repositories, peer activity, or a room.

Private staged evidence remains outside Git. The runner neither automates publication nor rejects agent-authored repository content. Only the assigned origin's literal pushed `refs/heads/main` is checkable and gradeable; local files, unpushed commits, symbolic `HEAD`, and alternate refs cannot supplement it.

`check_published_solver` captures one immutable main commit, materializes its Git-free tree, runs it against ciphertext assembled from the caller's currently released evidence, and cleans the capture before returning aggregate coverage and accuracy. Repeated checking is retained behavior, not an invalid run.

## Sandbox And Secret Boundary

Model-authored commands run in agent sandboxes containing only the assigned workspace, currently released evidence, Git origin, and private temporary storage. Prepared plaintext, keys, unreleased or peer evidence, checker internals, credentials, host controls, and public networking remain outside.

Checker and evaluator executions use separate one-shot sandboxes with a Git-free solver tree, selected ciphertext, bounded temporary output, and no writable host output bind. The host validates the declared reconstruction file before scoring it. Sandbox and secret controls protect the operator and experiment boundary; they are not claims of adversarial security.

## Records And Evaluation

Each run owns an append-only `trace.jsonl` and one atomically published `run.json` `RunRecord`. The trace records secret-free chronological observations. One strict schema-v1 decoder rejects unknown fields, malformed nested values, inconsistent agents/origins, absolute paths, traversal, and escaped topology. The record freezes timestamps, the resolved run and digest, one shared validation snapshot, package digest, model bindings and usage, releases, trace identity, sandbox identity, relocatable frozen topology, session outcomes and infrastructure failures, run status, and ordered evaluation-batch and analysis history.

A shared run has one canonical origin. An isolated run has one canonical origin per fixture agent, ordered by the package agent list. Final evaluation captures and scores every origin, including missing or invalid publications; no best result is selected. `puzzle:evaluate` later reuses only the frozen package and origins and appends new results through atomic replacement without altering prior evidence.

`puzzle:analyze` validates the record, trace, fixture, contained topology, and frozen-tree seals before scanning every blob reachable from every frozen canonical origin for raw overlap. It defaults to a 32-word threshold and rejects values below 8. It does not warn agents, block Git, invalidate runs, or change scores. Re-evaluation and analysis strictly load the existing record, append one typed history entry, and atomically replace `run.json`; failures preserve the prior bytes and clean staging files. A trace without `run.json` is an interrupted directory, not a recoverable phase or an implicitly valid run.

`puzzle:grade` uses a read-only trace load to create a deterministic blinded evidence index and mechanical measures, then appends a `performance` analysis with immutable digested details. `puzzle:review` validates that exact basis, removes identity and outcome information, and—only after literal spend authorization—retains two distinct-provider reviews and appends a completed or incomplete `process-review`. Each completed scorecard has one entry per canonical origin and keeps outcome, epistemic, social, and instrumental ledgers separate. `puzzle:report` aggregates compatible scorecards under an explicit descriptive or matched design without mutating source runs. Python owns deterministic measures and aggregation; TypeScript owns evidence normalization, provider orchestration, citations, containment, and atomic publication.

Future `git.changed` observations may include the resolved object target for each changed ref. This is a neutral observation of an existing Git event and does not alter command output, activity feedback, metering, or publication rules. Historical traces remain valid and trajectory measures that need an event-time target remain unavailable.

## Operator Surface

```bash
pnpm puzzle:build --config <manifest.yaml> [--run <run-id>]
pnpm puzzle:validate --config <manifest.yaml>
pnpm puzzle:experiment --config <manifest.yaml> --output <experiment-dir> --allow-spend true
pnpm puzzle:experiment --config <manifest.yaml> --output <experiment-dir> --run <run-id> --allow-spend true
pnpm puzzle:evaluate --run-root <run-dir>
pnpm puzzle:analyze --run-root <run-dir> [--minimum-words <n>]
```

Commands emit one JSON result on success and non-zero diagnostics on failure. Validation is provider-free and creates no reusable receipt. Experiment execution rejects missing `--allow-spend true` before sandbox work, then repeats the same validation immediately before provider access; authorization applies only to the ceilings already declared in the manifest.

## Verification And Failure Semantics

Verification is layered by cost and evidence. `pnpm check` verifies tool versions, formatting, lint, and TypeScript types. `pnpm test` runs parallel unit and contract lanes, and `pnpm verify` composes those fast advisory development checks. `pnpm verify:full` additionally runs material fixture regression, provider-free experiment acceptance, the sandbox image build, and serial representative real-Docker tests. It remains provider-free.

Sandbox images use source-digest-derived local tags and retain the inspected runnable image ID in records. A valid cached image is reused; different Dockerfile digests and concurrent worktrees cannot retag one shared mutable name. Agent leases are terminal after timeout, output overflow, daemon interruption, OOM, or unexpected container exit: the host removes the container, reports infrastructure failure where applicable, and never replaces the container or replays the command.

The real-Docker tests create containers through the production sandbox path. Testcontainers contributes only a session label and resource reaper so abruptly terminated test workers cannot leave test containers behind; it does not replace the production containment configuration, enable container reuse, or introduce Compose. Explicit cleanup remains primary, and ownership labels keep fallback cleanup scoped away from unrelated experiment containers.

Hosted advisory CI installs the locked toolchains and dependencies once, then runs the same fast `pnpm verify` surface as the local pre-push hook. Sandbox image construction remains in the explicit local `pnpm verify:full` tier. Hosted CI never runs material or acceptance suites, sandbox builds, real-Docker tests, `puzzle:validate`, or provider-backed work.

Consequential validation remains separate and scoped to the selected experiment. `puzzle:validate` performs exact manifest and package decoding, fixture digest checks, one sandbox probe, and one provider-free smoke execution for the first declared run. After rejecting missing spend authorization, provider-backed execution repeats exact validation before opening sessions; `puzzle:experiment --run` smokes that selected run instead. The resolved inputs, validation result, and sandbox identity are retained in each run record.

Deterministic tests cover variable fixture geometry, construction and manipulation checks, treatment parity, fake-clock releases, shared visibility, isolated non-observability, secret exclusion, published-main checking, every-origin evaluation, scoring, and record publication. Invalid inputs fail before spend. Provider transport, sandbox, tracing, freezing, and evaluator failures are reported separately from model mistakes, no publication, conflicts, or missing integration.

No verification or validation command needs provider credentials or makes a billable request. Green mechanical tests are neither exact experiment validation nor empirical model evidence. The system makes no compatibility promise for historical study, phase, attempt, receipt, or reservation records; Git history is their archive.
