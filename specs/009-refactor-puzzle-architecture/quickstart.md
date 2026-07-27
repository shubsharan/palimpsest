# Quickstart: Puzzle Architecture Refactor

This is the post-implementation acceptance flow for Feature 009.

## Prerequisites

- Use the versions pinned in `.tool-versions`.
- Start Docker Engine or Docker Desktop.
- Install the independent JavaScript and Python environments.

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
```

The Python sync must refresh the editable package path after the move from `python/src/palimpsest` to `python/palimpsest`.

## Build the Current Sandbox

```bash
pnpm puzzle:sandbox:build
```

Confirm the command emits one JSON object with `imageTag`, `imageId`, `sourceDigest`, and `profileVersion`. Rebuild before Docker-backed verification so the checked-in source label and inspected image match.

## Verify the Repository

```bash
pnpm verify
git diff --check
```

Expected:

- all 44 TypeScript cases pass;
- all 37 retained Python cases, plus new focused cases, pass;
- ignored caches and empty directories do not affect repository-boundary verification;
- version verification, formatting, linting, type checking, and both test runtimes are green.

Run focused behavior checks when diagnosing:

```bash
pnpm exec vitest run src/artifacts.test.ts src/fixture.test.ts src/reveal.test.ts
pnpm exec vitest run tests/puzzle/attempt-durability.test.ts
pnpm exec vitest run tests/puzzle/sandbox.integration.test.ts
uv run --offline --frozen --project python pytest -c python/pyproject.toml \
  python/tests/puzzle/test_manifest.py \
  python/tests/puzzle/test_shards.py \
  python/tests/evaluation
```

## Run a Fresh Offline Attempt

```bash
output="$(mktemp -d)/palimpsest-offline"
pnpm puzzle:offline -- --output "$output"
```

Inspect:

- `$output/build/puzzle-build.json`
- `$output/attempt/trace.meta.json`
- `$output/attempt/trace.jsonl`
- `$output/attempt/attempt.json`
- `$output/attempt/overlap.json`
- `$output/attempt/evaluation/selection.json`
- `$output/attempt/evaluation/result.json`

Expected:

- build, three-agent run, overlap, evaluation, and scoring complete without an external model call;
- the normalized values match [contracts/behavior-baseline.md](contracts/behavior-baseline.md);
- trace sequence is contiguous and elapsed time is nondecreasing;
- `attempt.frozen` precedes `overlap.observed`, reviewer selection, and evaluation;
- evaluation status is `scored`.

## Validate Intentional Failure Paths

Unknown fixture scenarios must fail before attempt side effects:

```bash
build_root="$(mktemp -d)/build"
attempt_root="$(mktemp -d)/attempt"
pnpm puzzle:build -- --output "$build_root" --seed 0 --stage-interval-ms 20
pnpm puzzle:run -- \
  --build "$build_root" \
  --output "$attempt_root" \
  --adapter fixture \
  --fixture-scenario unknown \
  --token-budget 100 \
  --wall-time-ms 10000
```

The final command must exit nonzero, emit no success JSON, and leave `$attempt_root` absent.

The focused durability test injects overlap failure after freeze and proves:

- the run rejects explicitly;
- `attempt.json`, trace, frozen Git, and workspaces remain;
- no success-shaped `overlap.json` is fabricated;
- `puzzle:evaluate` can evaluate the saved attempt without rerunning agents.

Malformed build, attempt, overlap, and evaluation fixtures must fail through their named decoders without casts, missing-field defaults, or partial success.

## Audit the Compact Layout

Confirm active source contains:

- one root `src/` application;
- one `python/palimpsest` distribution;
- `tools/verify-versions.ts` as the only retained development utility in `tools/`;
- no `packages/puzzle-runner`, package barrel, TypeScript alias, `pnpm-workspace.yaml`, `tools/puzzle`, or `python/src`.

Search active code and configuration, excluding historical specifications 006 and 008, for deleted paths and names. The audit must find no active `@palimpsest/puzzle-runner`, `AgentAdapter`, `Supervisor`, `parseAttemptConfig`, `tools/puzzle`, or `python/src/palimpsest` reference.

## Preserve Historical and User-Owned Material

- Specifications 006 and 008 remain byte-for-byte unchanged.
- `docs/proposal.md` remains semantically unchanged.
- `.artifacts-tmp/gate-b-contract-cases.json` retains its pre-refactor byte hash and remains unmodified and unarchived.
- Cache deletion is reported separately and occurs only after tracked-path verification proves the directories contain no active source.
