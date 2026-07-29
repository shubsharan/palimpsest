# Palimpsest

Palimpsest is a local research runner for a team word-substitution puzzle. One checked-in YAML manifest freezes five blocks, a three-model assignment, four conditions, schedules, budgets, order, and failure rules. Persistent model sessions receive different private evidence over time and decide for themselves how to solve. A canonical condition selects shared or isolated Git and the stationary or re-key puzzle twin.

This is a puzzle and a research artifact. It is not a hosted service, an enterprise application, or a prescribed multi-agent workflow.

## Read First

- [Proposal](docs/proposal.md): puzzle, agent experience, evaluation, and claim boundary.
- [Architecture](docs/architecture.md): configuration, runtime, artifacts, and failure semantics.
- [Roadmap](docs/roadmap.md): delivery sequence and definition of done.
- [Feature 010 specification](specs/010-agent-sandbox-lifecycle/spec.md): attempt-scoped agent sandbox and recovery behavior.
- [Feature 012 quickstart](specs/012-simple-research-ci/quickstart.md): current development check, research preflight, and provenance flow.
- [Feature 013 quickstart](specs/013-engineered-paired-blocks/quickstart.md): paired-block discovery, construction, and verification.
- [Feature 014 quickstart](specs/014-four-team-conditions/quickstart.md): four-condition runtime and provider-free acceptance.
- [Feature 015 quickstart](specs/015-frozen-five-block-protocol/quickstart.md): frozen calibration, validation, and explicit replacement flow.
- [Experiment schema](experiments/schema.json): strict version-2 study manifest.
- [Block catalog](experiments/blocks.json): five pinned paired study blocks.
- [Study manifest](experiments/config.yaml): frozen block matrix, assignment, budgets, providers, rubric, and failure policy.

Features 011 and 012 provide the configurable research runner and its verification boundary. Feature 013 adds engineered stationary/re-key block pairs. Feature 014 implements the four communication/key conditions. Feature 015 freezes the complete five-block protocol.

## Setup

Use the tool versions pinned in `.tool-versions` and start Docker Engine or Docker Desktop.

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
```

The first bootstrap may use the network. Once the uv cache is populated, local checks use the locked environment offline. The sandbox image contains the Git, POSIX shell, and Python runtime used by model-authored and reviewer-selected commands. Each agent receives one attempt-scoped sandbox lease over its host-backed workspace and private evidence, while evaluation uses a separate one-shot sandbox. Model calls happen on the host; provider credentials are never mounted into either sandbox.

## Configure The Study

Scientific block inputs live in `experiments/blocks.json`. The strict study manifest in `experiments/config.yaml` declares:

- `blocks`: one calibration and four validation block IDs in fixed order;
- `assignment`: one ordered three-agent model assignment used by every cell;
- `schedule` and `budgets`: the fixed reveal/cutoff values plus per-attempt and study-wide authorizations;
- `providers`: direct OpenAI, Anthropic, Google, or OpenAI-compatible connections whose credentials are named by environment variable;
- `models`: provider/model profiles and non-secret settings;
- `orders`: one calibration and four balanced validation condition sequences; and
- `scoring`, `rubric`, `adjustableFields`, and `failurePolicy`: the declared observation and replacement boundary.

The block catalog owns source, references, seed, fixed three-agent/six-stage geometry, and the committed first-feasible prose window. Schema version 1, unknown keys, aliases, order drift, secret-bearing values, and mismatched identities fail before an attempt. Palimpsest uses the AI SDK only as a narrow provider-neutral boundary and performs no automatic fallback or retry.

## Run

Build both variants of one pinned block without provider access:

```bash
pnpm puzzle:build -- \
  --block calibration-theron-ware \
  --output artifacts/build
```

The schema-version-3 build contains stationary and re-key variants with byte-identical stages one through three. Every run requires exactly one of `CS`, `CR`, `IS`, or `IR`; the condition selects the variant and native Git topology.

Run one standalone condition with the frozen assignment:

```bash
pnpm puzzle:run -- \
  --config experiments/config.yaml \
  --condition CR \
  --build artifacts/build \
  --attempt-root artifacts/attempt
```

Run calibration, then validation, under one local study root:

```bash
pnpm puzzle:experiment -- \
  --config experiments/config.yaml \
  --phase calibration \
  --study-root artifacts/study
pnpm puzzle:experiment -- \
  --config experiments/config.yaml \
  --phase validation \
  --study-root artifacts/study
```

Calibration constructs all five builds and publishes immutable `design.json` before the first model session. Each phase reserves and runs one cell at a time, then indexes only strict durable attempts in its `phase.json`. A frozen `session-infrastructure-error` stops the phase; one explicit `--replace <attempt-id>` command may append a cited replacement. Nothing retries automatically.

After inspecting a frozen attempt, the researcher explicitly chooses what to evaluate:

```bash
pnpm puzzle:evaluate -- \
  --attempt artifacts/study/validation/attempts/<attempt-id> \
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
