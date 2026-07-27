# Quickstart: Gate C Revision Dynamics

Gate C is intentionally split into a reusable offline implementation and one declaration-bound judged run. Under Constitution v2.0.0, sections 5–7 are deferred until the Milestone 6 offline end-to-end harness records a passing completion report.

## 1. Verify the repository

```bash
corepack pnpm install --frozen-lockfile
uv sync --offline --frozen --project python
pnpm verify
```

## 2. Verify retained inputs

```bash
pnpm gate-c:inputs
```

Both commands verify the retained local source, entity review, qualified Gate B decision, and solver policy without creating judged evidence. The `:offline` spelling makes the no-network operator intent explicit.

## 3. Build disposable calibration

```bash
pnpm gate-c:calibrate
```

Calibration must prove:

- one eligible chapter boundary leaves at least 10,000 tokens per side;
- changed entries satisfy occurrence and bijection invariants;
- matched controls exist across all four strata;
- six atomic reveals expose the declared contradiction threshold;
- a stationary no-switch control does not create a synthetic localized drop.

Calibration writes only to `artifacts/gate-c/calibration` and cannot be imported into a judged attempt.

## 4. Freeze the judged declaration

```bash
pnpm gate-c:build
pnpm gate-c:predeclare
pnpm gate-c:predeclare:check
```

`gate-c:build` regenerates the declared input from the frozen source and entity review; it does not copy disposable calibration outputs. Review the declaration digest, public solver packet, private oracle manifest, environment pins, decision thresholds, and invalidation graph before running the solver.

## 5. Confirm API capacity

Do not run this section merely because API quota is available. First verify the exact Milestone 6 harness completion evidence required by the Gate C declaration.

The judged condition uses `gpt-5.6-sol`. Confirm that `.env.local` contains the selected OpenAI API key and that the project has enough quota. A failed capacity check does not authorize a different model.

```bash
pnpm gate-c:admit
```

## 6. Run and observe one attempt

```bash
pnpm gate-c:run
```

Before the first external call, the command prints the exact attempt directory. Follow its durable public stream in another terminal:

```bash
tail -f artifacts/gate-c/attempts/<declaration-digest>/<run-id>/live.jsonl
```

The runner creates a fresh explicit Code Interpreter container, uploads only released chapters, and appends timestamped observable response, tool, file, reveal, and checkpoint events as they arrive. Each response must finish within 110 seconds so the absolute two-minute reveal clock cannot become solver-paced.

## 7. Score, decide, and replay

```bash
pnpm gate-c:score -- --declaration-digest <digest> --run-id <run-id>
pnpm gate-c:complete -- --declaration-digest <digest> --run-id <run-id>
pnpm gate-c:replay -- --declaration-digest <digest> --run-id <run-id>
pnpm verify
```

Scoring atomically seals `terminal.json` with the exact output set; terminal attempts cannot be rescored or reused. Do not use `current.json` as an evidence input. A pass authorizes Gate D against the same integrated harness; harness construction has already completed offline by this point.
