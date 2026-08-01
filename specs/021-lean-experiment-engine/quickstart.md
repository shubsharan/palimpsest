# Quickstart: Lean Experiment Engine

## Bootstrap

Use the pinned toolchain and install locked dependencies once:

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
```

## Fast Development Verification

```bash
pnpm check
pnpm test
pnpm verify
```

`check` verifies versions, formatting, lint, and TypeScript types. `test` runs the parallel TypeScript and Python unit and contract lanes. `verify` composes both and is safe for hosted advisory CI: it makes no Docker or provider calls and performs no full checked-in fixture rebuild.

Use narrower lanes while iterating:

```bash
pnpm test:unit:ts
pnpm test:unit:py
pnpm test:contract:ts
pnpm test:contract:py
```

The optional pre-push hook runs `pnpm ci:local`, which invokes the same fast `verify` surface without reinstalling dependencies. Install it with `pnpm hooks:install`; bypass it intentionally with `git push --no-verify`.

## Full Provider-Free Verification

With Docker Engine or Docker Desktop running:

```bash
pnpm verify:full
```

This adds full-corpus material regression, deterministic checked-in fixture rebuilding, compact provider-free experiment acceptance, the sandbox image build, and serial representative real-Docker tests. It does not validate one exact manifest and cannot open a provider session.

Individual slower lanes remain available as `pnpm test:material`, `pnpm test:acceptance`, and `pnpm test:docker`.

## Prepare And Validate

```bash
pnpm puzzle:build --fixture calibration-theron-ware --output artifacts/fixtures/calibration-theron-ware
pnpm puzzle:build --all true --output artifacts/fixtures
pnpm puzzle:validate --config experiments/config.yaml
```

`puzzle:validate` is the exact experiment gate, not another name for the test suite. It structurally validates every declared run and unique package, probes the sandbox once, and smoke-executes the first declared run. When `puzzle:experiment --run <run-id>` repeats validation before execution, it smokes exactly that selected run instead. Validation is provider-free, never resolves credentials or opens sessions, and creates no reusable receipt.

A green `verify` or `verify:full` result is advisory mechanical evidence. A green `puzzle:validate` result applies only to the exact manifest and package bytes it checked. Neither is empirical model evidence.

## Execute Or Re-evaluate

After exact validation succeeds and the configured credential environment variables are available:

```bash
pnpm puzzle:experiment --config experiments/config.yaml --output artifacts/experiments/example --allow-spend true
pnpm puzzle:experiment --config experiments/config.yaml --output artifacts/experiments/example-one --run theron-ware-shared-stationary --allow-spend true
pnpm puzzle:evaluate --run-root artifacts/experiments/example/theron-ware-shared-stationary
pnpm puzzle:analyze --run-root artifacts/experiments/example/theron-ware-shared-stationary
```

Only `puzzle:experiment` can open provider sessions. It rejects missing `--allow-spend true` before sandbox probing or smoke execution, then repeats exact validation before provider access. Invalid configuration, package drift, sandbox failure, smoke failure, or missing authorization results in zero provider requests.

Inspect each run's `run.json` and `trace.jsonl`; a directory with no `run.json` is interrupted rather than complete. The analysis command is provider-free. It defaults to 32-word spans; `--minimum-words` may lower the threshold no further than 8. Re-evaluation and analysis validate the relocated artifact tree and append one typed history entry without changing frozen evidence or trace bytes.
