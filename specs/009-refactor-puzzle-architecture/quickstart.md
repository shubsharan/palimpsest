# Quickstart: Puzzle Architecture Refactor

This is the post-implementation acceptance flow for Feature 009.

Feature 012 now governs advisory CI, experiment-time preflight, and provenance. Use `specs/012-simple-research-ci/quickstart.md` for current research authorization; the commands below remain the completed Feature 009 architecture acceptance record.

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

Confirm the command emits one JSON object containing `imageTag`, `imageId`, `sourceDigest`, and `profileVersion`. Additional fields are allowed. Rebuild before Docker-backed verification so the checked-in source label and inspected image match.

## Verify the Repository

```bash
pnpm verify
git diff --check
```

Expected:

- the complete TypeScript and Python suites pass;
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
- the scientific values, minimum command results, and required trace relationships match [contracts/behavior-baseline.md](contracts/behavior-baseline.md);
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

Malformed current-version build, attempt, overlap, and evaluation fixtures must fail through their named decoders without casts, missing-field defaults, or partial success.

## Audit the Compact Layout

Confirm active source contains:

- one root `src/` application;
- one `python/palimpsest` distribution;
- `tools/verify-versions.ts` as the only retained development utility in `tools/`;
- no `packages/puzzle-runner`, package barrel, TypeScript alias, `pnpm-workspace.yaml`, `tools/puzzle`, or `python/src`.

Search active code and configuration for deleted paths and names. The audit must find no active `@palimpsest/puzzle-runner`, `AgentAdapter`, `Supervisor`, `parseAttemptConfig`, `tools/puzzle`, or `python/src/palimpsest` reference.

## Confirm the Greenfield Boundary

- The five commands retain their names, flags, defaults, required relationships, one-object success boundary, and documented minimum result fields.
- Additional JSON result fields are allowed and are not compared as exact key sets.
- Only records produced by the refactored runner are required to decode through the active commands.
- No compatibility alias, stored-record migration, historical artifact fixture matrix, replay path, or temporary dual command path exists.
- `attempt.json` is published with a same-directory temporary write and atomic rename inside the exclusively created attempt root; concurrent writers are unsupported.
- Overlap failure reports through nonzero exit and standard error, preserves an evaluatable attempt, and creates no failure sidecar.

## Confirm the Clean Working Tree

- `docs/proposal.md` remains semantically unchanged.
- Superseded specifications, `.artifacts-tmp`, Gate/harness/replay outputs, obsolete package roots, and redundant tool state are absent.
- Generated attempts, temporary output, Python caches, virtual environments, and test caches are ignored explicitly.
- Git history remains the archive for deleted specifications and evidence.
