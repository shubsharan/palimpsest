# Architecture

## Purpose

Palimpsest is one local path from a declared puzzle fixture to inspectable model behavior:

```text
FixtureDefinition -> FixturePackage -> ExperimentManifest -> RunRecord
```

Python constructs and scores deterministic word-substitution fixtures. TypeScript validates experiment declarations, runs concurrent model sessions, exposes tools and Git, freezes outcomes, and publishes records. Plain files, subprocesses, and Docker boundaries are preferred over services or orchestration frameworks.

## Fixture Preparation

`experiments/blocks.json` contains `FixtureDefinition` values. A definition declares source provenance and window, target-excluded references, seed, agent IDs, stage count, available variants, re-key boundaries, and scientifically meaningful allocation constraints. Unknown fields and invalid geometry fail before output publication.

`puzzle:build` invokes the deterministic Python builder and atomically publishes a `FixturePackage`. The package contains:

- normalized construction inputs and exact source/reference provenance;
- ordered private stage files for every declared agent and variant;
- public ciphertext and target-excluded reference material;
- trusted plaintext, keys, allocation data, manipulation checks, and scoring inputs; and
- a content digest covering the canonical package manifest and declared files.

Agent-visible trees contain none of the trusted labels or oracle material. Package validation checks path containment, byte digests, complete agent/stage coverage, variant boundaries, allocation requirements, and declared stationary or re-key relationships. Identical definitions and corpus bytes produce identical packages.

## Experiment Configuration

One YAML `ExperimentManifest` declares provider bindings, model profiles, an experiment spending ceiling, and a non-empty ordered `runs` list. Each run names a prepared package and variant, maps every fixture agent to a model profile, declares shared or isolated Git, optionally enables the team room for shared Git, and supplies release offsets, cutoff, optional token limit, run spending ceiling, and secret-free analysis labels.

Resolution verifies the exact package bytes and content digest. Assignments must match the package agents exactly; schedule length must match its stages; variants and models must exist; release offsets begin at zero and increase before the cutoff; run IDs are unique; and run ceilings fit the experiment authorization. Credentials are environment-variable names in configuration and are resolved only at provider-call boundaries.

Runs execute sequentially in manifest order to avoid undeclared cross-run contention. Sessions within one run execute concurrently. There are no generated phases, balanced orders, reservations, replacement lineage, resume state, or automatic retries. Repetition requires a new declared run ID.

## Run Runtime

Immediately before execution, the runner validates the exact manifest and packages, probes the configured sandbox, completes the provider-free smoke path, and requires explicit operator spend authorization. Invalid configuration, package drift, sandbox failure, or missing authorization stops before provider access.

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

Model-authored commands run in agent sandboxes containing only the assigned workspace, currently released evidence, target-excluded references, Git origin, and private temporary storage. Prepared plaintext, keys, unreleased or peer evidence, checker internals, credentials, host controls, and public networking remain outside.

Checker and evaluator executions use separate one-shot sandboxes with a Git-free solver tree, selected ciphertext, bounded temporary output, and no writable host output bind. The host validates the declared reconstruction file before scoring it. Sandbox and secret controls protect the operator and experiment boundary; they are not claims of adversarial security.

## Records And Evaluation

Each run owns an append-only `trace.jsonl` and one atomically published `run.json` `RunRecord`. The trace records secret-free chronological observations. The record freezes the resolved run and package digest, model bindings and usage, releases, trace identity, sandbox identity, frozen topology, session outcomes, infrastructure status, and ordered evaluation and analysis history.

A shared run has one canonical origin. An isolated run has one canonical origin per fixture agent, ordered by the package agent list. Final evaluation captures and scores every origin, including missing or invalid publications; no best result is selected. `puzzle:evaluate` later reuses only the frozen package and origins and appends new results through atomic replacement without altering prior evidence.

Optional raw-overlap analysis may report obvious copied spans after publication. It does not warn agents, block Git, invalidate runs, or change scores. A trace without `run.json` is an interrupted directory, not a recoverable phase or an implicitly valid run.

## Operator Surface

```bash
pnpm puzzle:build --fixture <fixture-id> --output <package-dir>
pnpm puzzle:build --all true --output <packages-dir>
pnpm puzzle:validate --config <manifest.yaml>
pnpm puzzle:experiment --config <manifest.yaml> --output <experiment-dir> --allow-spend true
pnpm puzzle:experiment --config <manifest.yaml> --output <experiment-dir> --run <run-id> --allow-spend true
pnpm puzzle:evaluate --run-root <run-dir>
```

Commands emit one JSON result on success and non-zero diagnostics on failure. Validation is provider-free and creates no reusable receipt. Experiment execution repeats the same validation immediately before provider access; `--allow-spend` authorizes only the ceilings already declared in the manifest.

## Verification And Failure Semantics

Ordinary `pnpm check` remains fast advisory development feedback. Consequential validation is scoped to the selected experiment: exact manifest and package decoding, fixture digest checks, sandbox probe, provider-free smoke execution, and explicit spend authorization occur immediately before provider sessions. The resolved inputs, validation result, and sandbox identity are retained in each run record.

Deterministic tests cover variable fixture geometry, construction and manipulation checks, treatment parity, fake-clock releases, shared visibility, isolated non-observability, secret exclusion, published-main checking, every-origin evaluation, scoring, and record publication. Invalid inputs fail before spend. Provider transport, sandbox, tracing, freezing, and evaluator failures are reported separately from model mistakes, no publication, conflicts, or missing integration.

No verification command needs provider credentials or a billable request. The system makes no compatibility promise for historical study, phase, attempt, receipt, or reservation records; Git history is their archive.
