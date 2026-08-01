# Data Contracts

## ExperimentManifest

`experiments/config.yaml` is the only authored experiment contract. Schema v2 rejects legacy fields and duplicate YAML run keys.

```yaml
schemaVersion: 2
name: theron-ware-unlimited-1h
models:
  sol:
    provider: openai
    model: gpt-5.6-sol
    reasoningEffort: medium
runs:
  shared:
    source: fixtures/corpus/fortunes-fool.txt
    agents: 3
    model: sol
    communication: shared
    releases: [0m, 5m, 10m, 20m, 30m, 40m]
    cutoff: 1h
    spendCeilingCents: 1000
```

The run map key is the required human-readable run identifier used by `--run` and artifact records. It is not a scientific input and is not repeated as an `id` field. Run order is YAML map order.

Every run requires `source`, `agents`, `model`, `communication`, `releases`, `cutoff`, and `spendCeilingCents`. `rekeyAtStage` and `tokenLimitPerAgent` are optional; omission means stationary and unlimited respectively. Durations are strict non-negative integers followed by `ms`, `s`, `m`, or `h`. Releases begin at zero, increase strictly, and finish before the positive cutoff.

The engine infers ordered agent IDs, applies one model uniformly, maps communication to Git and room capabilities, infers conventional credential variables, and sums run ceilings for aggregate authorization. It rejects unknown models, unsafe source paths, invalid team sizes or re-key boundaries, malformed durations, and every removed legacy field.

## FixturePackage

`puzzle:build` derives one flat package for each selected run. Construction identity and randomness depend on source bytes and agent/stage geometry, not re-keying. The realized fixture and build identities additionally distinguish the stationary or re-keyed package. `fixture.json` uses `schemaVersion: 2` and records:

- package and construction identities, content digest, source provenance, resolved source window, agent IDs, and stage count;
- one realized stationary or re-keyed regime with `rekeyAtStage`, public ciphertext, and ordered private stage paths and digests;
- trusted oracle, allocation, manipulation checks, and scoring inputs.

There is no authored fixture ID, package path, source window, word count, hash, format, reference material, seed, variant catalog, or allocation threshold. Reference material is absent from the serialized package and every agent-visible surface. The content digest covers the canonical manifest without `contentDigest` plus every regular package file except `fixture.json`.

## ResolvedRun

Before execution the engine freezes the selected construction, fixture, build, and content identities, source and re-key boundary, inferred agents and uniform model assignments, inferred credential environment name, communication capabilities, resolved release and cutoff milliseconds, optional token limit, run spend ceiling, aggregate authorization, and sandbox identity. Credential values are never stored.

## RunRecord and Trace

`run.json` remains a strict, relocatable record. It freezes the resolved secret-free run configuration, exact fixture validation, representative smoke identity, releases, model identities and usage, session outcomes, canonical trace paths, sandbox identity, frozen topology, evaluations, and analyses. A shared run records one canonical origin; an isolated run records every agent origin without selecting a best result.

`trace.jsonl` remains append-only. Re-evaluation and analysis validate the trace, package digest, contained topology, and frozen trees before atomically appending history. They cannot alter frozen configuration, status, earlier results, or trace bytes. Neither surface may contain credentials, hidden reasoning, provider payloads, keys, oracle content, references, or unreleased evidence.
