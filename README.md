# Palimpsest

Palimpsest is a local, behavior-neutral research runner for a three-agent word-substitution decipherment puzzle. Three persistent model sessions receive different private evidence over time, share ordinary Git, check candidate reconstructions against aggregate private feedback, and decide for themselves how to solve and coordinate.

The runner observes the resulting work. It does not assign roles, impose rounds, require Git use, or treat a particular collaboration pattern as valid.

## Read First

- [Proposal](docs/proposal.md): puzzle, agent experience, evaluation, and claim boundary.
- [Architecture](docs/architecture.md): active runtime, sandbox, trace, overlap, and failure semantics.
- [Roadmap](docs/roadmap.md): delivery sequence and definition of done.
- [Feature 012 quickstart](specs/012-simple-research-ci/quickstart.md): current development check, research preflight, and provenance flow.
- [Feature 009 quickstart](specs/009-refactor-puzzle-architecture/quickstart.md): implemented runner architecture and offline acceptance flow.
- [Operator CLI contract](specs/009-refactor-puzzle-architecture/contracts/operator-cli.md): required flags, defaults, and result compatibility.

Feature 009 defines the implemented runner architecture. Feature 012 is authoritative for current verification and experiment authorization. Superseded designs and generated experimental evidence remain recoverable from Git history rather than occupying the working tree.

## Setup

Use the tool versions pinned in `.tool-versions` and start Docker Engine or Docker Desktop.

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
```

The first bootstrap may use the network. Once the uv cache is populated, local checks use the locked environment offline.

The sandbox image contains the Git, POSIX shell, and Python runtime used by model-authored and reviewer-selected commands. Model API calls remain on the host; provider credentials are never mounted into command containers.

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

## Operator Flow

The individual commands require explicit paths and run limits:

```bash
build_root="artifacts/build-17"
attempt_root="artifacts/attempt-17"

pnpm preflight
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

OpenAI runs require the current clean checkout and sandbox to match `artifacts/preflight.json` before the provider adapter is created. The matching receipt is copied to `$attempt_root/preflight.json` before model sessions begin, while `attempt.json` retains the sandbox identity used by the attempt.

Every command is dispatched by `src/cli.ts`. Runtime behavior lives in small owner modules under `src/`, with the Docker boundary alone nested under `src/sandbox/`; deterministic construction and evaluation live under `python/palimpsest/`.

Run completion publishes `attempt.json` atomically after sessions, trace, Git, and workspaces are frozen and before optional overlap observation begins. If overlap observation fails, the command fails without fabricating `overlap.json`, while the published attempt remains available to `puzzle:evaluate`.

## Scope

Palimpsest deterministically constructs and scores one compound puzzle. Live model decisions, Git interleavings, reviewer judgment, and collaboration outcomes are not reproducible claims. The runner is not a secure multi-tenant service or a general certificate of reasoning, collaboration, or belief revision.
