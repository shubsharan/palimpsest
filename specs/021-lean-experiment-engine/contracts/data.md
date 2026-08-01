# Data Contracts

Public interface names are `FixtureDefinition`, `FixturePackage`, `ExperimentManifest`, and `RunRecord`. Serialized documents use numeric `schemaVersion: 1`.

## FixtureDefinition

`experiments/blocks.json` contains a `fixtures` array. Each definition has:

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

`run.json` freezes the manifest digest, resolved run, package content digest, requested/actual model bindings, complete session results, canonical relative trace paths `trace.jsonl` and `trace.meta.json`, sandbox identity, frozen Git/workspace topology, explicit infrastructure status, and ordered evaluation/analysis history. One shared origin or every isolated agent origin must have an evaluation entry; none is selected as best. A directory without `run.json` is interrupted, not a partial record.

`trace.jsonl` is append-only and records lifecycle, releases, responses, safe returned summaries, tools, checker calls, Git/room activity, termination, freezing, evaluation, and infrastructure errors. Publication and re-evaluation reopen the canonical trace to validate JSONL structure, sequential event numbers, and non-regressing timestamps; they do not seal it with a hash, event count, or immutable prefix. Re-evaluation also requires the current package digest to match `run.fixture.digest` before solver execution. Neither surface may contain credentials, hidden reasoning, full provider payloads, keys, oracle content, or unreleased evidence.
