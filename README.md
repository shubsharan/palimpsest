# Palimpsest

Palimpsest is a local research runner for a team word-substitution puzzle. A checked-in YAML file declares one block, a token budget, model profiles, and model assignments. Persistent model sessions receive different private evidence over time and decide for themselves how to solve. A canonical condition selects shared or isolated Git and the stationary or re-key puzzle twin.

This is a puzzle and a research artifact. It is not a hosted service, an enterprise application, or a prescribed multi-agent workflow.

## Read First

- [Proposal](docs/proposal.md): puzzle, agent experience, evaluation, and claim boundary.
- [Architecture](docs/architecture.md): configuration, runtime, artifacts, and failure semantics.
- [Roadmap](docs/roadmap.md): delivery sequence and definition of done.
- [Feature 010 specification](specs/010-agent-sandbox-lifecycle/spec.md): attempt-scoped agent sandbox and recovery behavior.
- [Feature 012 quickstart](specs/012-simple-research-ci/quickstart.md): current development check, research preflight, and provenance flow.
- [Feature 013 quickstart](specs/013-engineered-paired-blocks/quickstart.md): paired-block discovery, construction, and verification.
- [Feature 014 quickstart](specs/014-four-team-conditions/quickstart.md): four-condition runtime and provider-free acceptance.
- [Feature 011 quickstart](specs/011-configurable-research-runs/quickstart.md): current setup and acceptance flow.
- [Experiment schema](experiments/schema.json): strict version-1 manifest format.
- [Block catalog](experiments/blocks.json): five pinned paired study blocks.
- [Baseline experiment](experiments/config.yaml): transitional model assignments used until Feature 015 freezes the study manifest.

Features 011 and 012 provide the configurable research runner and its verification boundary. Feature 013 adds engineered stationary/re-key block pairs. Feature 014 implements the four communication/key conditions. Feature 015 remains planned and will freeze the five-block study protocol.

## Setup

Use the tool versions pinned in `.tool-versions` and start Docker Engine or Docker Desktop.

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
```

The first bootstrap may use the network. Once the uv cache is populated, local checks use the locked environment offline. The sandbox image contains the Git, POSIX shell, and Python runtime used by model-authored and reviewer-selected commands. Each agent receives one attempt-scoped sandbox lease over its host-backed workspace and private evidence, while evaluation uses a separate one-shot sandbox. Model calls happen on the host; provider credentials are never mounted into either sandbox.

## Configure A Run

Scientific block inputs live in `experiments/blocks.json`. The run configuration in `experiments/config.yaml` selects one block and declares operational settings:

- `puzzle`: one block ID;
- `limits`: one per-agent token budget;
- `providers`: direct OpenAI, Anthropic, Google, or OpenAI-compatible connections whose credentials are named by environment variable;
- `models`: reusable provider/model profiles and non-secret settings; and
- `runs`: homogeneous or ordered mixed-model assignments plus repetitions.

The block catalog owns source, references, seed, fixed three-agent/six-stage geometry, and the committed first-feasible prose window. Unknown keys and mismatched block identities fail before an attempt. Palimpsest uses the AI SDK only as a narrow provider-neutral boundary and performs no automatic fallback or retry.

## Run

Build both variants of one pinned block without provider access:

```bash
pnpm puzzle:build -- \
  --block calibration-theron-ware \
  --output artifacts/build
```

The schema-version-3 build contains stationary and re-key variants with byte-identical stages one through three. Every run requires exactly one of `CS`, `CR`, `IS`, or `IR`; the condition selects the variant and native Git topology.

Run one named model assignment:

```bash
pnpm puzzle:run -- \
  --config experiments/config.yaml \
  --run gpt-only \
  --condition CR \
  --build artifacts/build \
  --output artifacts/attempt
```

Or build once and run all declared model assignments and repetitions sequentially under one condition:

```bash
pnpm puzzle:experiment -- \
  --config experiments/config.yaml \
  --condition CR \
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

Palimpsest deterministically constructs paired puzzle blocks and scores selected runs. Feature 013 establishes controlled information geometry, not a behavioral result. Live model decisions, provider serving behavior, Git interleavings, reviewer judgment, and collaboration outcomes are not reproducible claims. The runner does not certify collaboration or belief revision or provide a hardened public benchmark.
