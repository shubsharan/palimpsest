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
- [Fixture definitions](experiments/blocks.json): historical and variable-geometry puzzle declarations.
- [Example experiment](experiments/config.yaml): the historical five-fixture matrix expressed as explicit runs.

## Setup

Use the versions pinned in `.tool-versions` and start Docker Engine or Docker Desktop.

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
```

The first bootstrap may use the network. Model-authored commands and canonical solver execution run in Linux containers. Model calls happen on the host; provider credentials are named by environment variable and never mounted into agent or evaluator sandboxes.

## Prepare Fixtures

`experiments/blocks.json` contains `FixtureDefinition` values. Each declares source provenance, target-excluded references, seed, agent IDs, stage count, key variants, re-key boundaries, and scientifically meaningful allocation constraints.

Build one fixture or the complete example set without provider access:

```bash
pnpm puzzle:build --fixture calibration-theron-ware --output artifacts/fixtures/calibration-theron-ware
pnpm puzzle:build --all true --output artifacts/fixtures
```

Preparation publishes a deterministic `FixturePackage` containing agent-visible stages and variants plus trusted provenance, oracle data, manipulation checks, and scoring inputs. Trusted data stays outside agent workspaces. Adding a fixture changes declarations and corpus inputs, not runner source.

## Configure Experiments

`experiments/config.yaml` is an `ExperimentManifest` with provider bindings, model profiles, an experiment spending ceiling, and an explicit ordered `runs` list. Every run declares:

- a prepared fixture package and variant;
- the exact agent-to-model assignment;
- shared or isolated Git and optional shared team room;
- release offsets, wall cutoff, optional per-agent token limit, and spend ceiling; and
- secret-free labels for later analysis.

Runs execute sequentially in manifest order; agents within one run execute concurrently. Shared runs expose ordinary peer Git and, when enabled, one public room. Isolated runs expose usable private Git and no peer evidence or activity. Git remains model-chosen and unmetered, and only the assigned origin's pushed `main:solver.py` can receive aggregate checking or final grading.

The runner imposes no roles, turns, checkpoints, reports, consensus, branch workflow, commit cadence, or decoding method. It performs no automatic retry, replacement, merge, or recovery.

## Validate And Run

Validate the exact manifest, package digests and relationships, sandbox, and provider-free smoke path:

```bash
pnpm puzzle:validate --config experiments/config.yaml
```

Validation never resolves credentials, opens provider sessions, or creates a reusable receipt. Provider-backed execution repeats the same checks immediately before access and requires explicit spend authorization:

```bash
pnpm puzzle:experiment --config experiments/config.yaml \
  --output artifacts/experiments/example --allow-spend true
pnpm puzzle:experiment --config experiments/config.yaml \
  --output artifacts/experiments/example-one --run theron-ware-shared-stationary --allow-spend true
```

A failed run retains its available trace and explicit status, then stops the experiment. Repeating it requires a new run ID in the manifest.

## Inspect And Re-evaluate

Each run writes an append-only `trace.jsonl` and atomically publishes `run.json`. The `RunRecord` freezes the resolved secret-free configuration, fixture and sandbox identities, releases, requested and actual model identities, normalized usage, safe response summaries, tool and Git activity, frozen topology, infrastructure status, and evaluations.

The final evaluator captures literal pushed `main`, materializes a Git-free solver tree, runs `python3 solver.py` against the complete ciphertext in an isolated container, and scores the reconstruction. Shared runs evaluate the one team origin; isolated runs evaluate every agent origin. Missing publication and missing integration remain results, and no best solver is selected.

Re-evaluate a completed run without provider access:

```bash
pnpm puzzle:evaluate --run-root artifacts/experiments/example/theron-ware-shared-stationary
```

Re-evaluation appends results atomically without changing frozen inputs or earlier evidence. A directory with a trace but no `run.json` is interrupted, not complete.

## Development Check

```bash
pnpm check
```

Development checks are fast advisory feedback. Before paid or findings-bearing work, use `puzzle:validate` and let `puzzle:experiment` repeat exact config/package/sandbox validation before the explicit spend gate. No provider-free verification command needs credentials or a billable request.

Generated packages and runs belong under the ignored `artifacts/` directory.

## Scope

Palimpsest deterministically constructs and scores word-substitution fixtures while preserving observable model behavior. It does not certify collaboration or belief revision, provide automatic causal analysis, exclude source recognition, or establish a general capability benchmark. Findings must remain scoped to the declared fixtures, treatments, models, and retained run records.
