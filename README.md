# Palimpsest

Palimpsest is a local, behavior-neutral research runner for a three-agent word-substitution decipherment puzzle. Three persistent model sessions receive different private evidence over time, share ordinary Git, check candidate reconstructions against aggregate private feedback, and decide for themselves how to solve and coordinate.

The runner observes the resulting work. It does not assign roles, impose rounds, require Git use, or treat a particular collaboration pattern as valid.

## Read First

- [Proposal](docs/proposal.md): puzzle, agent experience, evaluation, and claim boundary.
- [Architecture](docs/architecture.md): active runtime, sandbox, trace, overlap, and failure semantics.
- [Roadmap](docs/roadmap.md): delivery sequence and definition of done.
- [Feature 009 quickstart](specs/009-refactor-puzzle-architecture/quickstart.md): current setup, verification, and offline acceptance flow.
- [Operator CLI contract](specs/009-refactor-puzzle-architecture/contracts/operator-cli.md): required flags, defaults, and result compatibility.

Specification 006 remains the completed behavior-neutral design record. Feature 009 keeps that behavior while reducing the active implementation to one root TypeScript application and one Python distribution.

## Setup

Use the tool versions pinned in `.tool-versions` and start Docker Engine or Docker Desktop.

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
pnpm puzzle:sandbox:build
```

The first bootstrap and sandbox image build may use the network. Once the uv cache is populated, verification uses the locked environment offline.

The sandbox image contains the Git, POSIX shell, and Python runtime used by model-authored and reviewer-selected commands. Model API calls remain on the host; provider credentials are never mounted into command containers.

## Verify

```bash
pnpm verify
git diff --check
```

The suite includes real Docker containment and cleanup checks. A deterministic end-to-end fixture, which makes no external model call, is available with:

```bash
output="$(mktemp -d)/palimpsest-offline"
pnpm puzzle:offline -- --output "$output"
```

Inspect `$output/attempt/attempt.json`, `trace.meta.json`, `trace.jsonl`, `overlap.json`, and `evaluation/result.json`.

## Operator Flow

The individual commands require explicit paths and run limits:

```bash
build_root="artifacts/build-17"
attempt_root="artifacts/attempt-17"

pnpm puzzle:build -- --output "$build_root" --seed 17
pnpm puzzle:run -- \
  --build "$build_root" \
  --output "$attempt_root" \
  --adapter openai \
  --model "<model>" \
  --token-budget 200000 \
  --wall-time-ms 3600000
pnpm puzzle:evaluate -- --attempt "$attempt_root"
```

Generated attempts belong under the ignored `artifacts/` directory. Build, run, and evaluation commands emit one JSON object on standard output and fail nonzero when their declared infrastructure cannot be provided. A build output must be absent or empty, a run output must be absent, and evaluation is one-shot because it creates the attempt's `evaluation/` directory exclusively.

Every command is dispatched by `src/cli.ts`. Runtime behavior lives in small owner modules under `src/`, with the Docker boundary alone nested under `src/sandbox/`; deterministic construction and evaluation live under `python/palimpsest/`.

Run completion publishes `attempt.json` atomically after sessions, trace, Git, and workspaces are frozen and before optional overlap observation begins. If overlap observation fails, the command fails without fabricating `overlap.json`, while the published attempt remains available to `puzzle:evaluate`.

## Scope

Palimpsest deterministically constructs and scores one compound puzzle. Live model decisions, Git interleavings, reviewer judgment, and collaboration outcomes are not reproducible claims. The runner is not a secure multi-tenant service or a general certificate of reasoning, collaboration, or belief revision.
