# Data Model: Engineered Paired Puzzle Blocks

## Block Definition

| Field | Meaning | Validation |
| --- | --- | --- |
| `blockId` | Canonical calibration or validation identity | Unique lowercase identifier |
| `phase` | Study role | `calibration` or `validation` |
| `sourceId` | Provenance registry key | Registered and target-excluded from references |
| `seed` | Scientific seed | Safe integer |
| `references` | Target-excluded registered reference IDs | Nonempty, unique, excludes source |
| `window` | Discovery state or committed paragraph start/end, word count, and digest | All zero/empty during discovery; otherwise ordered, source-valid, 16,000-20,000 words |
| `boundaryStage` | First post-boundary stage | Exactly `4` |

The strict, balanced, and fallback tiers are global frozen builder constants, not block-authored fields.

## Paragraph Unit

| Field | Meaning | Validation |
| --- | --- | --- |
| `ordinal` | Source-order identity | Positive, unique, contiguous within extracted body |
| `text` | Canonical extracted natural prose | Non-empty NFC UTF-8 with collapsed internal whitespace |
| `wordCount` | Normalized word-token mass | Positive |
| `sha256` | Paragraph byte identity | Lowercase SHA-256 |
| `wordCounts` | Trusted normalized type counts | Derived, never agent-visible |

## Allocation

| Field | Meaning | Validation |
| --- | --- | --- |
| `allocationId` | Digest of window and assignments | Deterministic |
| `assignments` | Paragraph ordinal to agent and stage | Complete, unique, three agents, six stages |
| `tier` | First feasible tier | One declared tier |
| `metrics` | Region/stage balance, solo changed-set coverage, asymmetry, candidate counts | Satisfy selected tier |
| `rejectedTiers` | Earlier tier and failure reasons | Complete and ordered |

Paragraphs retain increasing source ordinal within every stage. The union of assignments equals the selected window exactly. A stage or complete text serializes paragraphs with exactly two LF bytes and ends with one LF.

## Oracle Set Design

| Field | Meaning | Validation |
| --- | --- | --- |
| `anchors` | Stable types shared across agents | At least 12; at least one occurrence per agent and region |
| `sentinels` | Re-keyed types seen by every agent before and after boundary | At least six; tier-required occurrences per agent and region |
| `specialists` | Re-keyed owner-weighted types | Disjoint set per agent; at least three per owner and tier-specific owner share |
| `controls` | Stable types paired to changed types | One-to-one, disjoint, deterministic closest match |
| `matches` | Frequency, exposure, and context distances | Finite declared metrics |

All fields are trusted oracle data and remain outside agent-visible directories.

## Paired Build

| Field | Meaning | Validation |
| --- | --- | --- |
| `pairedBuildId` | Identity shared by both variants | Covers source, window, allocation, base key, design |
| `stationary` | Six-stage base-key variant | Key version remains zero |
| `rekey` | Six-stage stage-four revision variant | Changes only selected mappings |
| `baseKeyPath` | Trusted base key | Oracle-only |
| `manipulationCheck` | Twin identity and old-key-loss metrics | Zero stationary mismatch and at least 15% re-key mismatch |

## Variant

| Field | Meaning | Validation |
| --- | --- | --- |
| `variantId` | Canonical identity | `stationary` or `rekey` |
| `buildId` | Variant-specific stage identity | Deterministic |
| `publicCiphertextPath` | Complete variant ciphertext | Agent-safe path |
| `privateStageRoots` | Three private roots | Canonical agent IDs |
| `stages` | Ordered stage records | Exactly 18, no release timing |
| `keyTransitions` | Trusted key metadata | Empty for stationary; one stage-four transition for rekey |

## State Transitions

```text
registered source
  -> parsed paragraphs
  -> candidate window
  -> tier search
  -> selected allocation
  -> oracle set design
  -> paired encryption
  -> manipulation validation
  -> atomic paired build publication
```

Any failed transition leaves no success-shaped final build.
