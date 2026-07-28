# Palimpsest

Palimpsest is a local research runner for a collaborative word-substitution puzzle. A checked-in YAML file declares the corpus, puzzle geometry, resource limits, model profiles, and run conditions. Persistent model sessions receive different private evidence over time, share ordinary Git, and decide for themselves how to solve and coordinate.

This is a puzzle and a research artifact. It is not a hosted service, an enterprise application, or a prescribed multi-agent workflow.

## Read First

- [Proposal](docs/proposal.md): puzzle, agent experience, evaluation, and claim boundary.
- [Architecture](docs/architecture.md): configuration, runtime, artifacts, and failure semantics.
- [Roadmap](docs/roadmap.md): delivery sequence and definition of done.
- [Feature 010 specification](specs/010-agent-sandbox-lifecycle/spec.md): attempt-scoped agent sandbox and recovery behavior.
- [Feature 011 quickstart](specs/011-configurable-research-runs/quickstart.md): current setup and acceptance flow.
- [Experiment schema](experiments/schema.json): strict version-1 manifest format.
- [Baseline experiment](experiments/config.yaml): the current three-agent research condition.

Feature 011 is the active specification. Feature 009 remains the behavior-neutral foundation, while Feature 010 defines the active attempt-scoped sandbox lifecycle that Feature 011 uses.

## Setup

Use the tool versions pinned in `.tool-versions` and start Docker Engine or Docker Desktop.

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
pnpm puzzle:sandbox:build
```

The sandbox image contains the Git, POSIX shell, and Python runtime used by model-authored and reviewer-selected commands. Each agent receives one attempt-scoped sandbox lease over its host-backed workspace and private evidence, while evaluation uses a separate one-shot sandbox. Model calls happen on the host; provider credentials are never mounted into either sandbox.

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

## Verify

```bash
pnpm verify
git diff --check
```

Verification makes no live provider request. The deterministic end-to-end path is:

```bash
output="$(mktemp -d)/palimpsest-offline"
pnpm puzzle:offline -- --output "$output"
```

Generated runs belong under the ignored `artifacts/` directory.

## Scope

Palimpsest deterministically constructs and scores configured puzzle conditions. Live model decisions, provider serving behavior, Git interleavings, reviewer judgment, and collaboration outcomes are not reproducible claims. The runner does not isolate the value of collaboration, certify belief revision, or provide a hardened public benchmark.
