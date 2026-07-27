# Behavior Compatibility Baseline

The implementation captures these values before moving source. Dynamic host and concurrency data is normalized as described below.

## Verification Baseline

- Stable expected TypeScript baseline: 43 of 44 passing, with only the raw-directory repository-boundary assertion failing.
- Python baseline: 37 of 37 passing.
- A live full-suite run also observed one Docker cleanup deadline; the same Docker file passed all 3 tests on immediate isolated rerun. The refactor must retain and verify cleanup semantics without treating that transient timing result as a golden failure.

## Fixed Seed 17 Build

Inputs:

- seed `17`
- stage interval `25` ms
- default transition stage `4`
- default changed token mass `0.2`

Expected:

- build ID: `build-3288b873a2da8ee75f4289f86ccf82c699292d975e263a3a07039cca62e20301`
- file count: `48`
- tree SHA-256: `07500012e6875f444affd0605be0ba818ecd8b35a3560ef12852bdbede8de627`
- agent count: `3`
- stage count: `6`
- transition stage: `4`

Every emitted byte, path, stage order, changed-symbol order, and build-manifest field remains identical.

## Fixed Offline Fixture

Inputs:

- seed `0`
- stage interval `20` ms
- transition stage `4`
- changed token mass `0.2`
- scenario `collaborative-revision`
- token budget `100`
- wall time `10000` ms

Expected stable values:

- build ID: `build-ae72df272e36e174166945c67429f6ecfaf510a07f9be8821d044a26dc171dd1`
- exact agent-1 stage-1 checker result: `matchedWords=1528`, `totalWords=1528`, `coverage=1`, `accuracy=1`
- fixture evaluation score: `matchedWords=0`, `totalWords=27504`, `coverage=1`, `accuracy=0`
- all three sessions finish without `infrastructure-error`
- current deterministic token totals: agent-1 `5/4`, agent-2 `13/11`, agent-3 `4/3` input/output
- current fixture overlap scan: 9 reachable objects, 3 blob references, 3 unique blobs, 3 unique text blobs, 0 repeated tree references, 0 skipped nontext blobs, and no findings

If a Git version changes only nondeterministic object metadata, the overlap contract is evaluated through semantic counts and the dedicated committed-then-deleted fixture rather than blindly accepting drift.

## CLI Shapes

Golden assertions compare exact top-level key sets documented in [operator-cli.md](operator-cli.md), flag defaults, required relationships, absolute-path behavior, one-object stdout, and nonzero failure behavior.

Dynamic absolute path values are normalized to logical build/attempt roots before comparison.

## Trace Invariants

Golden assertions require:

- `attempt.configured` is first.
- Exactly 18 `stage.released` events exist.
- Each release has `atMs >= (ordinal - 1) * 20`.
- Each agent's first evidence exists before its first model request.
- `attempt.sessions-ended` precedes `attempt.frozen`.
- `attempt.frozen` precedes `overlap.observed` on success.
- `overlap.observed` precedes `reviewer.selection`.
- `reviewer.selection` precedes `evaluation.started`, completion, and `evaluation.scored`.
- Sequence numbers are contiguous from one.
- Elapsed times are finite, nonnegative, and nondecreasing.
- The initial fixture rule precedes stage-four evidence, and the revised rule follows it.

## Deliberately Non-Golden Values

Do not snapshot:

- wall-clock timestamps or exact elapsed durations
- temporary or absolute host paths
- Docker image IDs or container names
- Git commit/object IDs
- exact `git.changed` count or placement
- interleaving among concurrent agent events when no contract orders them
- provider/model behavior

These values are operational or stochastic and are not part of the deterministic compatibility claim.
