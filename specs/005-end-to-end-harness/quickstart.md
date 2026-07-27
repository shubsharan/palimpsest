# Quickstart: Offline End-to-End Puzzle Harness

This workflow makes no external model call and requires no provider credential.

## 1. Verify pinned dependencies

```bash
corepack pnpm install --frozen-lockfile
uv sync --offline --frozen --project python
pnpm verify
```

## 2. Verify retained inputs

```bash
pnpm harness:inputs
```

This checks Gate A accounting evidence, the bounded Gate B decision, retained source and entity review, fixture-agent policy, supported runtime, Git, container/image policy, and absence of provider configuration from the offline declaration.

## 3. Build and preflight the instance

```bash
pnpm harness:build
pnpm harness:predeclare
pnpm harness:predeclare:check
```

Build twice during verification. The second build must produce identical canonical bytes and digests. TypeScript preflight must validate the Python bundle without conversion-specific puzzle logic.

## 4. Run three deterministic fixture agents

```bash
pnpm harness:run:offline
```

The command prints the explicit attempt path before starting workers. Follow its append-only observable stream:

```bash
tail -f artifacts/harness/attempts/<declaration-digest>/<run-id>/live.jsonl
```

Workers use native Git and the production lifecycle, accounting, publication, freeze, finalization, and private-output contracts. They do not use a model provider.

## 5. Grade and replay the exact attempt

```bash
pnpm harness:grade -- --declaration-digest <digest> --run-id <run-id>
pnpm harness:replay -- --declaration-digest <digest> --run-id <run-id>
pnpm harness:complete -- --declaration-digest <digest> --run-id <run-id>
```

The completion command verifies the exact terminal output set and writes the immutable offline-harness report.

## 6. Execute the composed path

```bash
pnpm harness:offline
```

The composed command runs build, preflight, one fresh fixture attempt, clean solve, grade, replay, redaction, and completion. It never discovers evidence through `current.json`.

## 7. Verify retry isolation and repository quality

```bash
pnpm harness:offline
pnpm verify
git diff --check
```

The second attempt must leave the first byte-identical and independently replayable. A passing completion report authorizes later Gate C/D model evaluation only; it does not claim empirical solver, revision, or communication performance.
