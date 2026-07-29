# Quickstart: Engineered Paired Puzzle Blocks

## Bootstrap

```bash
asdf install
pnpm install --frozen-lockfile
uv sync --frozen --project python
```

No provider credential is required.

## Feature Boundary

Feature 013 constructs and verifies both stationary and re-key variants. The current run, experiment, and offline paths select the re-key variant and retain the existing shared-Git runtime. Canonical `CS`, `CR`, `IS`, and `IR` selection belongs to Feature 014; the frozen five-block phase protocol belongs to Feature 015.

## Discover And Commit Windows

The implementation provides a provider-free discovery mode that writes the first feasible window values for review:

```bash
pnpm puzzle:build -- \
  --block calibration-theron-ware \
  --discover true \
  --output artifacts/discovery
```

Discovery writes `discovery.json` only. Run it once for each checked-in block, review the selected tier and manipulation checks, then commit the exact paragraph range, word count, and digest into the matching `experiments/blocks.json` entry. Normal builds repeat the search and reject any pin that is not the first feasible result.

## Build A Paired Block

```bash
pnpm puzzle:build -- \
  --block calibration-theron-ware \
  --output artifacts/calibration-theron-ware
```

Inspect trusted design evidence:

```bash
jq '{blockId, pairedBuildId, window, allocation, variants}' \
  artifacts/calibration-theron-ware/puzzle-build.json
jq . artifacts/calibration-theron-ware/oracle/manipulation-check.json
```

Confirm no oracle data is agent-visible:

```bash
rg -n 'anchor|sentinel|specialist|control|rekey|stationary|key-' \
  artifacts/calibration-theron-ware/variants/*/private && exit 1 || true
```

## Verify

```bash
pnpm test:py -- \
  python/tests/puzzle/test_corpus.py \
  python/tests/puzzle/test_block.py \
  python/tests/puzzle/test_build.py \
  python/tests/puzzle/test_manifest.py
pnpm test:ts -- src/build.test.ts src/artifacts.test.ts src/config.test.ts
pnpm verify
git diff --check
```

The existing `pnpm preflight` remains the authorization boundary only for later provider-backed research. Feature 013 acceptance performs no model call.
