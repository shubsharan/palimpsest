# Scientific Behavior Baseline

The implementation captures these scientific values and minimum operator results before moving source. Dynamic host, representation, and concurrency data is excluded as described below.

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
- agent count: `3`
- stage count: `6`
- transition stage: `4`

The build identity, puzzle bytes, stage order, changed-symbol order, and declared puzzle geometry remain identical. File count, tree digest, and exact manifest field set are representation details rather than greenfield golden requirements.

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

## Minimum CLI Results

Golden assertions preserve the command names, flag defaults, required relationships, absolute-path behavior, one-object stdout, nonzero standard-error failure behavior, and minimum result fields documented in [operator-cli.md](operator-cli.md). Additional success fields do not fail the contract.

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

These values are operational, representational, or stochastic and are not part of the deterministic scientific claim.

Records from earlier implementations and exact CLI key sets are deliberately not golden values.
