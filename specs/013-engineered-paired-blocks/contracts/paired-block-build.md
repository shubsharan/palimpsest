# Contract: Paired Block Build

## Operator Interface

```bash
pnpm puzzle:build -- \
  --block calibration-theron-ware \
  --output artifacts/calibration-theron-ware
```

Feature 013 accepts a committed block definition and writes one paired build. The command performs no network or provider request and emits one JSON object on success:

```json
{
  "pairedBuildId": "paired-<sha256>",
  "buildPath": "/absolute/output",
  "blockId": "calibration-theron-ware",
  "agentIds": ["agent-1", "agent-2", "agent-3"],
  "stageCount": 6,
  "variants": {
    "stationary": "build-<sha256>",
    "rekey": "build-<sha256>"
  }
}
```

## Block Definition

The five-entry checked-in catalog at `experiments/blocks.json` uses strict canonical JSON. Each entry has this shape:

```json
{
  "schemaVersion": 1,
  "blocks": [
    {
      "blockId": "calibration-theron-ware",
      "phase": "calibration",
      "sourceId": "theron-ware",
      "seed": 130013,
      "references": ["middlemarch", "moby-dick", "jane-eyre"],
      "window": {
        "paragraphStart": 0,
        "paragraphEnd": 0,
        "wordCount": 0,
        "sha256": ""
      },
      "boundaryStage": 4
    }
  ]
}
```

Zero window values and an empty digest are valid only during `--discover true`, which writes `discovery.json` without publishing variants. Committed acceptance definitions contain the first feasible positive inclusive paragraph range, exact word count, and digest. Normal builds repeat discovery from the beginning and reject a pin that is not the first feasible result. Tier definitions are frozen builder constants and are not catalog fields. Unknown fields fail.

## Paired Manifest

`puzzle-build.json` uses schema version 3 and contains:

- `pairedBuildId`, `blockId`, `source`, `seed`, fixed agent/stage geometry;
- committed window paragraph range, word count, and digest;
- allocation identity, selected tier, metrics, and ordered rejected-tier reasons;
- oracle path and digests for anchor, sentinel, specialist, control, allocation, and manipulation records;
- one `stationary` and one `rekey` variant record;
- variant-specific build IDs, complete ciphertext, private roots, stage digests, and key transitions.

No release interval or release offset appears in the paired manifest or contributes to either build identity.

## Agent-Visible Tree

```text
variants/<variant>/
├── complete/ciphertext.txt
├── private/agent-1/stages/stage-01.txt ... stage-06.txt
├── private/agent-2/stages/stage-01.txt ... stage-06.txt
├── private/agent-3/stages/stage-01.txt ... stage-06.txt
└── references/
```

Until Feature 014 derives variant selection from the canonical condition, `puzzle:run`, `puzzle:experiment`, and `puzzle:offline` always select the `rekey` record through `selectBuildVariant`. The selected variant's private stage and reference paths preserve the current baseline. Oracle labels and records never enter this tree.

## Oracle Tree

```text
oracle/
├── allocation.json
├── design.json
├── manipulation-check.json
├── checker/<agent>/stage-*.txt
└── keys/
    ├── base.json
    └── rekey-stage-04.json
```

## Tier Contract

| Tier | Owner share | Owner occurrences/region | Sentinel occurrences/agent/region | Solo changed-set coverage | Region deviation | Stage deviation | Control distance |
| --- | --: | --: | --: | --: | --: | --: | --: |
| `strict` | >= 0.67 | >= 3 | >= 3 | <= 0.60 | <= 0.04 | <= 0.12 | <= 0.15 |
| `balanced` | >= 0.60 | >= 2 | >= 2 | <= 0.67 | <= 0.07 | <= 0.18 | <= 0.25 |
| `fallback` | >= 0.55 | >= 2 | >= 1 | <= 0.75 | <= 0.10 | <= 0.25 | <= 0.40 |

Hard constraints across every tier are complete paragraph union, source order inside each nonempty stage, at least 12 stable anchors with one occurrence per agent and region, at least six sentinels, at least three specialists per owner, unique controls disjoint from changed types, at least 15% post-boundary changed-token mass for every agent, and at least 15 percentage points of global old-key loss. Stage mass spread may not exceed the largest indivisible paragraph. Old-key accuracy uses all normalized word-token occurrences in stages four through six as its denominator; stationary mismatch under the base key is zero and re-key mismatch is at least 0.15.

## Deterministic Search Contract

Canonical paragraphs are NFC text with collapsed internal whitespace and at least 20 word tokens. Plain-text blank-line blocks and HTML `<p>` elements use the same normalization. A stage joins canonical paragraphs with `\n\n` and ends with `\n`.

Window starts are tried in source order, capped at 512. For a start, the end is the first paragraph reaching 18,000 cumulative words, or the preceding paragraph if the first exceeds 20,000 and the preceding mass is at least 16,000. The boundary is the first paragraph boundary reaching half the window mass with at least nine paragraphs on either side.

For every window, tiers reset in strict, balanced, fallback order. Each region's initial paragraph order is `(-wordCount, SHA256("palimpsest-block:v1:<seed>:<blockId>:<tier>:<region>:<paragraphSha256>"), ordinal)`. A paragraph goes to the cell minimizing `(currentTokens, SHA256("<paragraphRank>:<cell>"), cellIndex)`.

Each tier receives one fresh deterministic allocation. The builder evaluates the complete geometry, records stable rejection reason codes when that allocation fails, and proceeds to the next tier. No paragraph-move optimizer is part of the treatment builder.

For types `a` and `b`, frequency distance is `abs(log1p(countA)-log1p(countB))/log1p(maxPostCount)`. Exposure distance is the mean absolute difference of normalized six-component agent-by-region exposure vectors. Context distance is Jaccard distance between immediate normalized-word neighbor sets. Their arithmetic mean is control distance. Changed types are ordered by `(-postCount, word)` and matched by deterministic augmenting paths over controls ordered by `(distance, word)`, using only edges within the tier threshold.

## Authority Contract

`experiments/blocks.json` alone owns source, references, seed, window, geometry, and key design. The schema-v1 experiment config selects only `puzzle.block` and `puzzle.stageIntervalMs`; it cannot restate scientific fields. Runtime rejects a paired manifest whose `blockId` differs from the configured block. Build identity excludes timing.

## Failure Contract

The build exits nonzero and does not publish `puzzle-build.json` when:

- source provenance or committed window does not match;
- paragraph parsing, union coverage, or source order fails;
- all three tiers are infeasible within declared search caps;
- oracle sets overlap or do not meet exposure constraints;
- a stable control cannot be matched for every changed type;
- twins differ before stage four;
- any changed mapping remains unchanged or any control changes;
- achieved old-key loss is below 15 percentage points; or
- final atomic publication fails.
