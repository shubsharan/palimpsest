# CLI Contract

All commands emit one JSON result on success, diagnostics on stderr, and a non-zero exit status on failure. Output roots must not already contain a published result.

## Build Fixtures

```bash
pnpm puzzle:build --fixture <fixture-id> --output <package-dir>
pnpm puzzle:build --all true --output <packages-dir>
```

- Reads fixture definitions from `experiments/blocks.json`; `--root` may select another repository root.
- Publishes `<package-dir>/fixture.json` atomically only after construction and manipulation checks pass.

## Validate an Experiment

```bash
pnpm puzzle:validate --config <manifest.yaml>
```

- Decodes the manifest and every referenced package, verifies package bytes/digests and run relationships, probes the configured sandbox, and completes the provider-free smoke path.
- Never resolves credentials or opens provider sessions and does not create a reusable receipt.

## Execute an Experiment

```bash
pnpm puzzle:experiment --config <manifest.yaml> --output <experiment-dir> --allow-spend true
pnpm puzzle:experiment --config <manifest.yaml> --output <experiment-dir> --run <run-id> --allow-spend true
```

- Without `--run`, executes every declared run sequentially in manifest order; with it, executes exactly the named run.
- Repeats validation immediately before execution. With `--run`, the provider-free smoke path exercises that selected run; full-manifest execution exercises one smoke path. `--allow-spend` is required before any provider session, but does not raise manifest ceilings.
- Runs agents concurrently and independently. A session infrastructure result allows peers to quiesce, then freezes and evaluates available state and publishes an infrastructure-error `run.json` before stopping.
- A thrown setup, lifecycle, freeze, or evaluation failure appends an `infrastructure.error` event when `trace.jsonl` exists, publishes no `run.json`, and stops before later runs. No failure triggers retry, replacement, peer cancellation, or resume.

## Re-evaluate a Run

```bash
pnpm puzzle:evaluate --run-root <run-dir>
```

- Requires canonical `trace.jsonl` and `trace.meta.json`, structurally validates the current appendable trace, and requires the loaded package digest to match the recorded fixture digest before using the frozen origins; no provider or live workspace is consulted.
- Appends a timestamped evaluation batch beside `run.json`; prior results and frozen fields are unchanged.

Optional post-publication overlap observation remains available through the provider-free Python analysis module and never affects run status or scores.
