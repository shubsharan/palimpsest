# Palimpsest

Palimpsest is a local research runner for a collaborative word-substitution puzzle. Researchers declare deterministic fixtures and explicit experiment runs; concurrent model agents receive different private evidence over time and decide for themselves how to solve. The runner preserves their tools, Git activity, responses, published solvers, and scores without imposing a collaboration workflow.

This is a puzzle and an observational research artifact. It is not a hosted service, an enterprise application, or a hardened benchmark.

## Read First

- [Proposal](docs/proposal.md): puzzle, research questions, treatments, observation, and claim boundary.
- [Architecture](docs/architecture.md): fixture, experiment, runtime, sandbox, record, and failure boundaries.
- [Roadmap](docs/roadmap.md): the science-focused delivery sequence and definition of done.
- [Feature 021 specification](specs/021-lean-experiment-engine/spec.md): active requirements for the lean experiment engine.
- [Feature 021 quickstart](specs/021-lean-experiment-engine/quickstart.md): provider-free verification and operator commands.
- [Experiment schema](experiments/schema.json): strict manifest contract.
- [Experiment config](experiments/config.yaml): the experiment name, fixture text files, and explicit runs.

## Setup

Use the versions pinned in `.tool-versions` and start Docker Engine or Docker Desktop.

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
```

The first bootstrap may use the network. Model-authored commands and canonical solver execution run in Linux containers. Model calls happen on the host; provider credentials are named by environment variable and never mounted into agent or evaluator sandboxes.

## Prepare Fixtures

`experiments/config.yaml` is the only authored experiment file. It names models and named runs. Each run declares its source text, team size, model, communication mode, release schedule, cutoff, per-run spend ceiling, and only the optional controls that matter to the experiment.

Build every run's derived package, or only one named run, without provider access:

```bash
pnpm puzzle:build --config experiments/config.yaml
pnpm puzzle:build --config experiments/config.yaml --run shared
```

Preparation derives source windows, allocation, construction randomness, package identity, paths, and agent IDs. Each flat `FixturePackage` contains one realized stationary or re-keyed regime plus trusted provenance, oracle data, manipulation checks, and scoring inputs. It contains no references or variant catalog. Trusted data stays outside agent workspaces.

## Configure Experiments

`experiments/config.yaml` is an `ExperimentManifest` with model profiles and a map of named runs. The map key is the run ID used by `--run` and stored artifacts; there is no separate `id`. Provider credentials use conventional environment variables such as `OPENAI_API_KEY`, and the experiment authorization is derived by summing its per-run ceilings. Every run declares:

- a clean UTF-8 source and agent count;
- one model applied uniformly to every inferred agent;
- `shared` or `isolated` communication;
- duration strings for releases and cutoff; and
- one spend ceiling, with optional `rekeyAtStage` and `tokenLimitPerAgent`.

Runs execute sequentially in manifest order; agents within one run execute concurrently. Shared runs expose ordinary peer Git and, when enabled, one public room. Isolated runs expose usable private Git and no peer evidence or activity. Git remains model-chosen and unmetered, and only the assigned origin's pushed `main:solver.py` can receive aggregate checking or final grading.

The runner imposes no roles, turns, checkpoints, reports, consensus, branch workflow, commit cadence, or decoding method. It performs no automatic retry, replacement, merge, or recovery.

## Validate And Run

Validate the exact manifest, package digests and relationships, sandbox, and provider-free smoke path:

```bash
pnpm puzzle:validate --config experiments/config.yaml
```

Validation never resolves credentials, opens provider sessions, or creates a reusable receipt. Provider-backed execution rejects missing explicit spend authorization before sandbox work, then repeats the same checks immediately before access:

```bash
pnpm puzzle:experiment --config experiments/config.yaml \
  --output artifacts/experiments/example --allow-spend true
pnpm puzzle:experiment --config experiments/config.yaml \
  --output artifacts/experiments/example-one --run shared --allow-spend true
```

A failed run retains its available trace and explicit status, then stops the experiment. Repeating it requires a new run ID in the manifest.

## Inspect And Re-evaluate

Each run writes an append-only `trace.jsonl` and atomically publishes `run.json`. The `RunRecord` freezes the resolved secret-free configuration, fixture and sandbox identities, releases, requested and actual model identities, normalized usage, safe response summaries, tool and Git activity, frozen topology, infrastructure status, and evaluations.

The final evaluator captures literal pushed `main`, materializes a Git-free solver tree, runs `python3 solver.py` against the complete ciphertext in an isolated container, and scores the reconstruction. Shared runs evaluate the one team origin; isolated runs evaluate every agent origin. Missing publication and missing integration remain results, and no best solver is selected.

Re-evaluate a completed run without provider access:

```bash
pnpm puzzle:evaluate --run-root artifacts/experiments/example/shared
pnpm puzzle:analyze --run-root artifacts/experiments/example/shared
```

Replay a terminal run in the local read-only viewer:

```bash
pnpm puzzle:view --run-root artifacts/experiments/example/shared
```

The viewer binds to `127.0.0.1`, presents synchronized agent, tool, team-room, and timeline streams, and reconstructs published solver checkpoints in the run's recorded Docker sandbox. Existing records use visibly approximate Git commit timing; newly recorded Git updates retain exact ref targets. Replay never executes a solver on the host or changes canonical run artifacts.

Re-evaluation appends results atomically without changing frozen inputs or earlier evidence. Analysis scans reachable frozen Git history for overlap, defaults to 32-word spans, and remains separate from status and scoring. Both operations strictly reload and validate the relocatable record before atomically appending one history entry. A directory with a trace but no `run.json` is interrupted, not complete.

## Verification

```bash
pnpm check
pnpm test
pnpm verify
```

`check` verifies tool versions, formatting, lint, and TypeScript types. `test` runs the fast unit and contract lanes. `verify` composes both and is the ordinary advisory development gate used by hosted CI and the optional pre-push hook. It does not build or exercise Docker, rebuild the checked-in fixture corpus, or validate a particular experiment.

Before a findings-bearing run, exercise the slower provider-free lanes locally:

```bash
pnpm verify:full
pnpm puzzle:validate --config experiments/config.yaml
```

`verify:full` adds material fixture regression, provider-free experiment acceptance, a cached source-digest sandbox image build, and representative real-Docker tests. The Docker tests use the production sandbox path plus a test-only resource reaper; they neither reuse containers nor require Compose. `puzzle:validate` is a separate consequential gate: it validates the exact manifest and packages, probes the sandbox once, and smokes the first declared run. When `puzzle:experiment` receives `--run`, its repeated validation smokes that selected run instead. A green development or full verification suite is not exact experiment validation and is not empirical model evidence.

Provider-backed execution repeats exact validation immediately before access and requires `--allow-spend true`. No verification or validation command needs credentials or makes a billable request; only `puzzle:experiment` can open provider sessions.

Generated packages and runs belong under the ignored `artifacts/` directory.

## Scope

Palimpsest deterministically constructs and scores word-substitution fixtures while preserving observable model behavior. It does not certify collaboration or belief revision, provide automatic causal analysis, exclude source recognition, or establish a general capability benchmark. Findings must remain scoped to the declared fixtures, treatments, models, and retained run records.
