# Data Contracts

Public interface names are `FixtureDefinition`, `FixturePackage`, `ExperimentManifest`, and `RunRecord`. Serialized documents use numeric `schemaVersion: 1`.

## FixtureDefinition

`experiments/fixtures.json` contains a `fixtures` array. Each definition has:

```json
{
  "fixtureId": "example-fixture",
  "source": {
    "sourceId": "target",
    "window": { "paragraphStart": 1, "paragraphEnd": 100, "wordCount": 18000, "sha256": "..." }
  },
  "references": ["middlemarch", "moby-dick"],
  "seed": 130013,
  "agentIds": ["agent-1", "agent-2"],
  "stageCount": 3,
  "variants": [
    { "variantId": "stationary", "rekeyFromStage": null },
    { "variantId": "rekey", "rekeyFromStage": 2 }
  ],
  "allocationConstraints": {
    "minimumAnchors": 12,
    "minimumSentinels": 6,
    "minimumSpecialistsPerAgent": 3,
    "minimumChangedMass": 0.15,
    "tiers": [
      {
        "tier": "strict",
        "minimumSpecialistOwnerShare": 0.67,
        "minimumOwnerOccurrences": 3,
        "minimumSentinelOccurrences": 3,
        "maximumSoloCoverage": 0.6,
        "maximumRegionDeviation": 0.04,
        "maximumStageDeviation": 0.12,
        "maximumControlDistance": 0.15
      }
    ]
  }
}
```

Preparation publishes `fixture.json` with `fixtureId`, `contentDigest`, resolved source/references/window, seed, agent/stage geometry, allocation, oracle design, base-key path, manipulation check, and a variant map. Each variant contains its re-key boundary, build ID, public ciphertext, reference corpus, private stage roots, ordered stages, and key transitions. `contentDigest` covers the canonical manifest without that field plus the sorted relative path and SHA-256 of every regular package file except `fixture.json`. All declared paths are relative, contained, targeted-digest-checked for diagnostics, and split into trusted versus agent-visible surfaces.

## ExperimentManifest

```yaml
schemaVersion: 1
providers:
  openai: { driver: openai, apiKeyEnv: OPENAI_API_KEY }
models:
  sol: { provider: openai, model: gpt-5.6-sol }
totalSpendCeilingCents: 2000
runs:
  - id: shared-stationary
    fixture: { packagePath: artifacts/fixtures/example, variant: stationary }
    assignment: { agent-1: sol, agent-2: sol }
    capabilities: { git: shared, teamRoom: enabled }
    schedule: { releaseOffsetsMs: [0, 300000, 600000], cutoffMs: 900000 }
    limits: { tokenLimitPerAgent: null, spendCeilingCents: 1000 }
    labels: { treatment: shared, replicate: 1 }
```

Run IDs are unique within the manifest. Assignment keys exactly equal package agents; schedule length equals package stages; selected variants and model profiles exist; shared room requires shared Git; credential fields are environment names; labels are secret-free JSON; and summed run ceilings do not exceed `totalSpendCeilingCents`. The resolved manifest digest identifies the experiment.

## RunRecord and Trace

`run.json` is decoded by one strict schema-v1 decoder. It rejects unknown fields, malformed nested values, inconsistent agent/origin sets, absolute paths, traversal, and paths that escape the relocated run or fixture root. It freezes creation/publication timestamps, manifest and resolved-run digests, the complete resolved secret-free configuration, the current run's exact fixture validation, one shared validation snapshot with the representative smoke's explicit `sourceRunId`, staged releases, requested/actual model bindings, complete session outcomes and explicit session infrastructure failures, canonical relative trace paths `trace.jsonl` and `trace.meta.json`, sandbox identity, run-relative frozen Git/workspace topology and outputs, and ordered evaluation-batch and overlap-analysis history. The smoke fixture must match its recorded source run but may differ from a later current run in the same manifest. One shared origin or every isolated agent origin must appear in each automatic evaluation batch; none is selected as best. A directory without `run.json` is interrupted, not a partial record.

`trace.jsonl` is append-only and records lifecycle, releases, responses, safe returned summaries, tools, checker calls, Git/room activity, termination, freezing, evaluation, and infrastructure errors. Publication creates `run.json` once. Re-evaluation and overlap analysis strictly load it, validate JSONL structure, sequential event numbers, non-regressing timestamps, fixture digest, contained topology, and frozen-tree seals, then append exactly one typed history entry by atomic replacement. Frozen configuration, status, scores, topology, and trace bytes remain unchanged; failed operations leave the prior record intact and remove staging files. Neither surface may contain credentials, hidden reasoning, full provider payloads, keys, oracle content, or unreleased evidence.
