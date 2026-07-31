# Quickstart: Blind Calibration and Team-Level Evaluation

## 1. Verify The Catalog Offline

Build all five active blocks into fresh ignored outputs:

```bash
pnpm puzzle:build -- --block calibration-odd-women --output artifacts/build-calibration-odd-women
pnpm puzzle:build -- --block validation-pointed-firs --output artifacts/build-validation-pointed-firs
pnpm puzzle:build -- --block validation-custom-country --output artifacts/build-validation-custom-country
pnpm puzzle:build -- --block validation-woodlanders --output artifacts/build-validation-woodlanders
pnpm puzzle:build -- --block validation-silas-lapham --output artifacts/build-validation-silas-lapham
```

Calibration must have evidence tier at least balanced and complete controls. Every validation build must have both tiers at least balanced. Any failure stops the workflow; do not substitute another window or fallback tier.

## 2. Exercise Blind Checking

```bash
pnpm test:ts -- src/tools.test.ts src/published-solver.test.ts src/prompt.test.ts
pnpm test:py -- python/tests/evaluation/test_checker.py
```

Acceptance requires identical feedback for correct and incorrect same-length outputs and a guard proving the checker path never opens oracle plaintext or checker truth.

## 3. Exercise All-Origin Evaluation and Diagnostics

```bash
pnpm test:ts -- src/evaluate.test.ts src/artifacts.test.ts
pnpm test:py -- python/tests/evaluation/test_score.py python/tests/evaluation/test_diagnostics.py
```

Shared fixtures must emit one origin result. Isolated fixtures must emit three. Workspace, notes, command, and output overrides must be rejected.

## 4. Run The Complete Provider-Free Matrix

```bash
pnpm puzzle:offline -- --condition CS --output artifacts/offline-cs
pnpm puzzle:offline -- --condition CR --output artifacts/offline-cr
pnpm puzzle:offline -- --condition IR --output artifacts/offline-ir
pnpm puzzle:offline -- --condition IS --output artifacts/offline-is
pnpm ci:local
pnpm verify
```

The fixture must retain terminal results for every canonical origin, exact diagnostics, team-product semantics, behavior records, checker trace, and no provider calls.

## 5. Commit And Preflight

Commit the exact implementation and sealed catalog, verify the worktree is clean, start Docker, then run:

```bash
pnpm preflight
```

Do not run paid work if `artifacts/preflight.json` does not bind the current commit and precise runnable sandbox identity.

## 6. Run Calibration Only

Use a fresh ignored study root and the receipt-bound manifest:

```bash
pnpm puzzle:experiment -- \
  --config experiments/config.yaml \
  --phase calibration \
  --study-root artifacts/calibration-020
```

The manifest expands `CS`, `CR`, `IR`, and `IS` sequentially with three GPT-5.6-sol medium-reasoning agents, releases at 0, 5, 10, 20, 30, and 40 minutes, a 60-minute cutoff, null token ceilings, $10 per attempt, and $40 total authorization. After `IS`, stop. Do not invoke validation.
