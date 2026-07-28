# Contract: Operator CLI

All commands emit exactly one JSON object on success and reject nonzero through standard error without success-shaped stdout.

## Build

```bash
pnpm puzzle:build -- \
  --config experiments/config.yaml \
  --output artifacts/build
```

- Validates the full manifest but only requires credentials when a live model is constructed.
- Creates an absent build root atomically.
- Returns at least `buildId` and absolute `buildPath`.

## Run one condition

```bash
pnpm puzzle:run -- \
  --config experiments/config.yaml \
  --run gpt-only \
  --build artifacts/build \
  --output artifacts/attempt
```

- Selects one named condition and runs it once.
- Rejects unknown conditions or build/config mismatch before creating the attempt root.
- Returns at least `attemptId` and absolute `attemptRoot`.
- The prior `--adapter openai --model ...` path is removed; fixture injection remains internal to offline verification.

## Run an experiment

```bash
pnpm puzzle:experiment -- \
  --config experiments/config.yaml \
  --output artifacts/experiment
```

- Requires an absent output root.
- Builds once into `build/`.
- Executes conditions and repetitions sequentially into `attempts/<run-name>/<NNN>/`.
- Atomically rewrites `experiment.json` after every durable attempt.
- Records and freezes an attempt containing a provider infrastructure-error session, then stops nonzero before starting another attempt.
- Stops on command-level failure without retries, rollback, or fabricated attempt entries.
- Returns at least the absolute experiment root, build ID, and completed-attempt count.

## Evaluate

```bash
pnpm puzzle:evaluate -- \
  --attempt artifacts/experiment/attempts/gpt-only/001 \
  --workspace agent-1 \
  --command "sh solve.sh" \
  --output-path reconstruction.txt
```

Reviewer selection remains explicit and unchanged in meaning. Evaluation accepts every agent ID declared by the attempt rather than a fixed enumeration.

## Offline

```bash
pnpm puzzle:offline -- --output artifacts/offline
```

Uses the checked-in baseline puzzle and deterministic fixture model bindings. It makes no external model request and remains the end-to-end acceptance path.
