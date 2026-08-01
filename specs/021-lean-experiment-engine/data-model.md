# Data Model: Lean Experiment Engine

## Authored ExperimentManifest (schema v2)

- `name`: human-readable experiment name.
- `models`: named provider/model profiles with optional reasoning effort.
- `runs`: insertion-ordered map. Each key is the run ID; each value declares `source`, `agents`, `model`, `communication`, `releases`, `cutoff`, `spendCeilingCents`, and optional `rekeyAtStage`, `tokenLimitPerAgent`, or boolean `checker`.

Omitted `checker` means enabled. Disabling it changes the feedback condition, manifest digest, and frozen run configuration but not construction randomness, fixture identity, package contents, or final scoring.

No other fields are accepted. In particular, authors do not provide providers, credential variables, fixture IDs or paths, source bounds or hashes, references, seeds, variants, assignments, capability objects, model output tokens, labels, allocation thresholds, millisecond values, or an experiment spending ceiling.

## Derived FixturePackage (schema v2)

- `fixtureId`, `constructionId`, `buildId`, and `contentDigest`.
- Exact source provenance and resolved source window.
- Inferred `agentIds`, `stageCount`, and one `realization` with `rekeyAtStage`.
- Public complete ciphertext and ordered per-agent private stage paths and digests.
- Trusted oracle, allocation, manipulation-check, and scoring data.

The package has no reference material or variant map. `constructionId` groups realizations derived from the same source bytes and agent/stage geometry; `fixtureId` and `buildId` identify the flat stationary or re-keyed realization. Re-keying does not alter construction randomness, allocation, or the base key. The realization is stationary when `rekeyAtStage` is null. Its digest covers the canonical manifest without `contentDigest` and every other regular package file.

## ResolvedExperiment and ResolvedRun

Resolution derives conventional provider credential environment names, agent IDs, uniform assignments, communication capabilities, package paths and identities, resolved milliseconds, unlimited-token nulls, default-enabled checker access, and aggregate authorization. The experiment maximum is the safe-integer sum of its run ceilings.

A resolved run freezes:

- map-key `id`, source, construction/fixture/build/content identities, and re-key boundary;
- exact agent-to-model map and provider-neutral model binding;
- shared Git plus room, or isolated Git without room;
- explicit checker availability;
- release offsets and cutoff in milliseconds;
- token limit or null and the run spend ceiling.

## RunRecord

One atomically published record freezes the resolved run, including checker availability, exact package and validation identities, releases, requested and actual model data, normalized usage, session outcomes, canonical trace paths, sandbox identity, frozen Git/workspace topology, infrastructure status, evaluation batches, and later analysis history. Schema-v1 records published before this field existed are interpreted as checker-enabled without changing their frozen configuration bytes or digest.

Shared runs have one canonical origin. Isolated runs have one per agent. Every canonical origin is evaluated; none is selected as best. Re-evaluation and analysis validate the current append-only trace, package digest, contained topology, and frozen trees before atomically appending history.

## State

```text
authored -> built -> validated -> running -> frozen -> evaluated -> published
                                  |
                                  +-> interrupted trace (no partial record)
```

Runs execute sequentially; sessions within a run execute concurrently. A session infrastructure failure does not cancel peers. The experiment stops before later runs and never retries, repairs, replaces, merges, or resumes automatically.
