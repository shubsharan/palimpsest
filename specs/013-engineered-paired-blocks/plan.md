# Implementation Plan: Engineered Paired Puzzle Blocks

**Branch**: `feature/013-engineered-paired-blocks` | **Date**: 2026-07-28 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `specs/013-engineered-paired-blocks/spec.md`

## Summary

Replace accidental contiguous slicing with one trusted Python block designer that parses pinned prose into ordered paragraphs, chooses the first feasible deterministic window, and searches a bounded set of balanced three-agent/six-stage allocations. From one allocation and base key it selects oracle-only shared anchors, universal re-key sentinels, owner-weighted specialists, and matched stable controls, then emits stationary and re-key twins whose first three stages are byte-identical. TypeScript remains a thin process and artifact-validation boundary. Release timing moves out of build identity so Feature 014 can apply the fixed non-uniform schedule to the same immutable stage bytes.

## Technical Context

**Language/Version**: Python 3.12.4; TypeScript 7.0.2 on Node.js 26.5.0 **Primary Dependencies**: Python and Node standard libraries, existing RFC 8785 canonical JSON, current cipher/revision primitives, pnpm 10.14.0, uv 0.11.14 **Storage**: Five checked-in provenance-pinned corpus files, one five-entry immutable block catalog, schema-version-3 build directories under ignored `artifacts/` **Testing**: pytest 9.1.1 property and fixture tests; Vitest 4.1.10 artifact/process tests; Ruff, Oxlint, Oxfmt **Target Platform**: Local macOS or Linux; no network or model provider required after source pinning **Project Type**: Local dual-runtime research CLI **Performance Goals**: Bound discovery to 512 window starts and three seeded tier probes per window **Constraints**: Exactly three agents, six stages, stage-four boundary, paragraph preservation, complete union coverage, deterministic first-feasible selection, no provider call, no new runtime subsystem **Scale/Scope**: One Python design module, one paragraph extractor, one extended build/artifact contract, five sources and block definitions, focused tests **Puzzle Contribution**: Deliberate paired evidence geometry that creates shared anchors, asymmetric specialist evidence, universal change sentinels, bounded solo coverage, and stable matched controls **Agent Instructions & Tools**: Unchanged; no design label, key regime, set membership, optimizer expectation, or scoring hint enters agent-visible artifacts **Environmental Constraints**: Existing private-evidence, oracle, sandbox, network, checker, token, wall-time, and evaluation boundaries remain unchanged **Observable Outcomes**: Trusted build records retain source window, allocation tier and metrics, rejected-tier reasons, oracle word sets, pairing identity, and manipulation checks **Determinism Claim**: Registered bytes, block definition, and builder version reproduce the exact window, allocation, keys, stages, metrics, and build identities; no model behavior is exercised

## Constitution Check

_GATE: Passed before Phase 0 research and re-checked after Phase 1 design._

- **Puzzle behavior before process - PASS**: Information geometry changes in the prepared puzzle; prompts, roles, tools, turns, files, and collaboration behavior do not.
- **Environmental constraints, not workflow - PASS**: Paragraph allocation and hidden key manipulation are fixed before sessions and independent of model behavior.
- **Minimal reproducible mechanics - PASS**: One Python-owned designer and one build contract replace the current splitter; no optimizer service, database, job system, or plugin layer is introduced.
- **Observe outcomes honestly - PASS**: Build checks establish treatment opportunity only and make no claim that agents notice, share, or use it.
- **Condition-defined native collaboration - PASS**: Feature 013 does not change Git topology or communication; its paired stage bytes are reusable across later communication-paired conditions.
- **Risk-aligned verification - PASS**: Provider-free deterministic tests and `pnpm verify` cover implementation; the existing clean preflight remains the later live-research boundary.

## Project Structure

### Documentation

```text
specs/013-engineered-paired-blocks/
├── checklists/requirements.md
├── contracts/paired-block-build.md
├── data-model.md
├── plan.md
├── quickstart.md
├── research.md
├── spec.md
└── tasks.md
```

### Source Code

```text
experiments/
└── blocks.json
fixtures/corpus/
├── provenance.json
└── study-*.{txt,html}
python/palimpsest/puzzle/
├── block.py             # paragraph model, bounded allocation, oracle set selection
├── build.py             # paired build orchestration and trusted artifact writes
├── corpus.py            # pinned plain-text and HTML paragraph extraction
├── manifest.py          # schema-version-3 build records
└── revision.py          # reused deterministic key revision primitive
python/tests/puzzle/
├── test_block.py
├── test_build.py
├── test_corpus.py
└── test_manifest.py
src/
├── artifacts.ts         # strict schema-version-3 decoder
└── build.ts             # thin block-definition/process boundary
```

**Structure Decision**: Keep all design and scientific selection in one new Python module beside the existing build primitives. Do not add an optimizer package or another application layer. TypeScript validates the resulting contract but does not duplicate selection logic.

## Phase 0 Decisions

The decisions and rejected alternatives are recorded in [research.md](research.md). The key design is a deterministic bounded search over ordered paragraph units, followed by deterministic oracle-set selection and an explicit feasibility check. Release offsets are deliberately excluded from build identity.

## Phase 1 Design

### Paragraph And Window Selection

The corpus registry accepts `gutenberg-text` and `gutenberg-html`. Both formats are stripped to the Gutenberg body. Plain-text blank-line blocks and HTML `<p>` elements are entity-decoded, normalized to NFC, collapsed to single internal spaces, and filtered to natural prose with at least 20 word tokens. Those canonical UTF-8 paragraph bytes, not raw HTML slices, are the allocation units. Stages join paragraphs with exactly two LF bytes and end with one LF. HTML uses the standard-library parser; no scraping dependency is added.

For each block definition, the builder scans at most the first 512 paragraph starts in source order. For each start it chooses the smallest end whose cumulative mass reaches 18,000 words; if that exceeds 20,000 words, it chooses the immediately preceding end when that mass is at least 16,000. The boundary is the first paragraph boundary whose cumulative mass reaches half the window mass, with at least nine paragraphs on each side. It then tries tiers in strict-to-fallback order. The first feasible allocation is final.

`--discover true` performs this search from a zero-window catalog entry and writes only `discovery.json`; it does not publish variants or a study build. A normal build requires a positive committed window, deterministically searches again from the beginning, and rejects the pin unless it equals the first feasible discovery result exactly.

### Bounded Allocation

Each tier resets to a seed-hashed, token-balanced assignment. For each region, paragraphs are ordered by descending word count, then `SHA256("palimpsest-block:v1:<seed>:<blockId>:<tier>:<region>:<paragraphSha256>")`, then ordinal. Each paragraph goes to the cell minimizing `(currentTokens, SHA256("<paragraphRank>:<cell>"), cellIndex)`. Rendered cells are re-sorted by paragraph ordinal.

Each tier gets one fresh deterministic allocation from the contract hash and least-loaded-cell rule. The builder evaluates that allocation against the complete tier geometry, records stable rejection reason codes when it fails, and moves to the next tier. This puzzle-level fallback replaces the earlier hill-climb: real-source evidence showed the fallback allocation is directly feasible, while exhaustive paragraph moves added minutes of computation without improving the treatment.

The three frozen tiers are:

| Tier | Specialist owner share | Owner occurrences/region | Sentinel occurrences/agent/region | Max solo changed-set coverage | Agent-region token deviation | Stage token deviation | Max control distance |
| --- | --: | --: | --: | --: | --: | --: | --: |
| strict | 67% | 3 | 3 | 60% | 4% | 12% | 0.15 |
| balanced | 60% | 2 | 2 | 67% | 7% | 18% | 0.25 |
| fallback | 55% | 2 | 1 | 75% | 10% | 25% | 0.40 |

Every tier also requires at least 12 shared stable anchors with one occurrence per agent and region, at least six sentinels, at least three specialists per owner, unique disjoint controls, nonempty stages, post-boundary changed-token mass of at least 15% for every agent, and global old-key loss of at least 15 percentage points. Stage spread may not exceed the largest indivisible paragraph.

For two types, frequency distance is `abs(log1p(a)-log1p(b))/log1p(maxPostCount)`. Exposure distance is the mean absolute difference between their normalized six-component agent-by-region vectors. Context distance is Jaccard distance between their immediate normalized-word neighbor sets. Control distance is the arithmetic mean of those three values. Changed types are matched in `(-postCount, word)` order using deterministic augmenting paths over candidate controls ordered by `(distance, word)`, with edges only at or below the tier limit.

### Paired Variants

One base key encrypts the stationary twin. The re-key twin changes the selected sentinels and specialists at stage four using the existing deterministic derangement primitive; anchors, controls, and unselected mappings remain stable. The builder rejects a pair unless:

- stages one through three are byte-identical;
- both variants share paragraph assignment and base key digest;
- no changed type retains its old cipher mapping;
- matched controls remain stable; and
- old-key global token accuracy after the boundary falls by at least 15 percentage points.

### Authority And Runtime Bridge

`experiments/blocks.json` is the sole authority for target, references, seed, window, geometry, and paired key design. The schema-v1 experiment config stops duplicating those fields; its puzzle section selects only `block` and the current arithmetic `stageIntervalMs`. `puzzle:build --block` loads the catalog without config. `puzzle:run` and `puzzle:experiment` require the paired manifest's `blockId` to equal the configured block and, until Feature 014 derives selection from `CS/CR/IS/IR`, always select the `rekey` variant to preserve the existing baseline. A pure TypeScript `selectBuildVariant` boundary performs that selection and rejects unknown or mismatched variants.

### Artifact Boundary

The extended contract is defined in [contracts/paired-block-build.md](contracts/paired-block-build.md). Agent-visible files contain only ciphertext stages and target-excluded references. Oracle paths retain paragraph allocation, set membership, keys, tier evidence, and manipulation checks. Build identity covers registered source digest, committed window, allocation, base key, both variant stage digests, and oracle design metadata, but not release timing.

## Complexity Tracking

No constitution violations or additional runtime systems are required.
