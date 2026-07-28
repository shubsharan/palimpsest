# Palimpsest

Palimpsest is a local research runner for a collaborative word-substitution puzzle. A checked-in YAML file declares the corpus, puzzle geometry, resource limits, model profiles, and run conditions. Persistent model sessions receive different private evidence over time, share ordinary Git, and decide for themselves how to solve and coordinate.

This is a puzzle and a research artifact. It is not a hosted service, an enterprise application, or a prescribed multi-agent workflow.

## Read First

- [Proposal](docs/proposal.md): puzzle, agent experience, evaluation, and claim boundary.
- [Architecture](docs/architecture.md): configuration, runtime, artifacts, and failure semantics.
- [Roadmap](docs/roadmap.md): delivery sequence and definition of done.
- [Feature 010 specification](specs/010-agent-sandbox-lifecycle/spec.md): attempt-scoped agent sandbox and recovery behavior.
- [Feature 012 quickstart](specs/012-simple-research-ci/quickstart.md): current development check, research preflight, and provenance flow.
- [Feature 011 quickstart](specs/011-configurable-research-runs/quickstart.md): current setup and acceptance flow.
- [Experiment schema](experiments/schema.json): strict version-1 manifest format.
- [Baseline experiment](experiments/config.yaml): the current three-agent research condition.

Feature 011 defines the configurable research runner, including the attempt-scoped sandbox lifecycle introduced by Feature 010. Feature 012 is authoritative for verification and experiment authorization. Feature 009 remains the implemented behavior-neutral foundation.

## Setup

Use the tool versions pinned in `.tool-versions` and start Docker Engine or Docker Desktop.

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
```

The first bootstrap may use the network. Once the uv cache is populated, local checks use the locked environment offline. The sandbox image contains the Git, POSIX shell, and Python runtime used by model-authored and reviewer-selected commands. Each agent receives one attempt-scoped sandbox lease over its host-backed workspace and private evidence, while evaluation uses a separate one-shot sandbox. Model calls happen on the host; provider credentials are never mounted into either sandbox.

## Configure A Run

Copy `experiments/config.yaml` and edit that one file. Its main sections are:

- `puzzle`: registered target and reference corpora, one-based chapter range, seed, agent and stage counts, release interval, and zero or more re-keys;
- `limits`: per-agent token budget and attempt wall time;
- `providers`: direct OpenAI, Anthropic, Google, or OpenAI-compatible connections whose credentials are named by environment variable;
- `models`: reusable provider/model profiles and non-secret settings; and
- `runs`: homogeneous or ordered mixed-model assignments plus repetitions.

Unknown keys and invalid relationships fail before a build or attempt is created. Palimpsest uses the AI SDK only as a narrow provider-neutral boundary; the experiment does not require provider SDK code in the runner and performs no automatic fallback or retry.

## Run

Build one declared puzzle:

```bash
pnpm puzzle:build -- \
  --config experiments/config.yaml \
  --output artifacts/build
```

Run one named condition:

```bash
pnpm puzzle:run -- \
  --config experiments/config.yaml \
  --run gpt-only \
  --build artifacts/build \
  --output artifacts/attempt
```

Or build once and run all declared conditions and repetitions sequentially:

```bash
pnpm puzzle:experiment -- \
  --config experiments/config.yaml \
  --output artifacts/experiment
```

Each durable attempt is indexed in `experiment.json`. Attempts remain separate under `attempts/<run-name>/<NNN>/`; a later failure does not erase completed work.

After inspecting a frozen attempt, the researcher explicitly chooses what to evaluate:

```bash
pnpm puzzle:evaluate -- \
  --attempt artifacts/experiment/attempts/gpt-only/001 \
  --workspace agent-1 \
  --command "sh solve.sh" \
  --output-path reconstruction.txt
```

The runner does not prescribe a solver file, command, workspace, role, or collaboration pattern.

## Development Check

```bash
pnpm check
```

The advisory Linux workflow runs this command for pull requests and pushes to `main`, then builds the sandbox image. It catches locked-dependency, formatting, lint, compile, and Dockerfile build failures without running unit suites, real-container behavior tests, or the offline fixture. It is intentionally not a required branch-protection check.

## Research Preflight

Before spending money on a live experiment or producing findings for publication, commit the exact source, leave the worktree clean, start Docker, and run:

```bash
pnpm preflight
```

Preflight rebuilds the agent sandbox, runs the complete verification suite including real-container tests, and executes a fresh deterministic build-run-evaluate fixture without an external model call. Only then does it write `artifacts/preflight.json`, binding the tested commit to the immutable sandbox identity. Any failed rerun removes the old receipt.

Generated runs belong under the ignored `artifacts/` directory. Provider-backed runs require the current clean checkout and sandbox to match `artifacts/preflight.json` before any model session begins. The matching receipt is copied into each attempt before its sessions start, while `attempt.json` independently records the sandbox actually used.

## Scope

Palimpsest deterministically constructs and scores configured puzzle conditions. Live model decisions, provider serving behavior, Git interleavings, reviewer judgment, and collaboration outcomes are not reproducible claims. The runner does not isolate the value of collaboration, certify belief revision, or provide a hardened public benchmark.
