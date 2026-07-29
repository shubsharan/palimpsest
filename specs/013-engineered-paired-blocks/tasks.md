# Tasks: Engineered Paired Puzzle Blocks

**Input**: Design documents from `specs/013-engineered-paired-blocks/` **Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/paired-block-build.md`

**Verification**: Provider-free tests must prove deterministic construction, paragraph integrity and complete union, tier fallback, oracle-set geometry, paired pre-boundary identity, stationary stability, old-key degradation, strict artifact decoding, and no oracle leakage. Feature 013 does not run live models or require a clean research preflight.

## Phase 1: Pinned Corpus And Contract Setup

**Purpose**: Establish immutable study inputs and strict block definitions before implementing selection.

- [ ] T001 Download `pg133.txt`, `pg4313.txt`, `367-h.htm`, `pg11052.txt`, and `pg482.txt` from the exact URLs frozen in `research.md` into `fixtures/corpus/`, then add URL, media type, byte length, SHA-256, title, author, ebook number, and retrieval date to `fixtures/corpus/provenance.json`
- [ ] T002 Create strict five-entry discovery catalog `experiments/blocks.json` with fixed IDs, phases, sources, target-excluded references, seeds, stage-four boundary, and zero/empty discovery windows
- [ ] T003 [P] Add plain-text and XHTML canonical paragraph tests covering NFC, entities, whitespace, 20-word filtering, LF serialization, plus five-source provenance tests in `python/tests/puzzle/test_corpus.py`
- [ ] T004 Implement Gutenberg body paragraph extraction for registered text and XHTML sources in `python/palimpsest/puzzle/corpus.py`

**Checkpoint**: All exact source bytes resolve locally and produce stable ordered natural-prose paragraphs.

## Phase 2: Foundational Block Model

**Purpose**: Define deterministic paragraph, tier, allocation, and paired-manifest contracts.

- [ ] T005 [P] Add deterministic block-definition, discovery-state, paragraph-unit, global tier, reference, and metric validation tests in `python/tests/puzzle/test_block.py`
- [ ] T006 Implement block catalog decoding, paragraph units, frozen tier constants, scoring records, and canonical digests in `python/palimpsest/puzzle/block.py`
- [ ] T007 [P] Add schema-version-3 paired-manifest round-trip and rejection tests in `python/tests/puzzle/test_manifest.py`
- [ ] T008 Replace the single-variant build manifest with strict paired-build schema version 3 in `python/palimpsest/puzzle/manifest.py`
- [ ] T009 [P] Add TypeScript schema-version-3 decoder and path/digest rejection tests in `src/artifacts.test.ts`
- [ ] T010 Extend `src/artifacts.ts` with strict paired-build, allocation-summary, manipulation-check, and variant decoders

**Checkpoint**: Python and TypeScript agree on one compact paired-build contract with no release timing.

## Phase 3: User Story 1 - Deterministic Paragraph Allocation

**Goal**: Select and allocate one first-feasible prose window without splitting, losing, or duplicating paragraphs.

**Independent Test**: Synthetic strict-pass, strict-fail/balanced-pass, all-tier-fail, and repeated-build fixtures reproduce exact allocation bytes.

### Verification

- [ ] T011 [P] [US1] Add allocation property tests for complete union, nonempty 3x6 cells, internal source order, pre/post separation, balance metrics, deterministic tie-breaking, and bounded iteration in `python/tests/puzzle/test_block.py`
- [ ] T012 [P] [US1] Add window selection tests for the exact start/end/boundary order, 512-start cap, discovery-only output, full pin revalidation, and explicit infeasibility in `python/tests/puzzle/test_build.py`

### Implementation

- [ ] T013 [US1] Implement deterministic first-feasible window scanning and stage-four paragraph partitioning in `python/palimpsest/puzzle/block.py`
- [ ] T014 [US1] Implement the contract-defined seed hash, initial assignment, score tuple, exhaustive legal-move order, 384-improvement cap, tier resets, rejection reason codes, and lexicographic tie-breaking in `python/palimpsest/puzzle/block.py`
- [ ] T015 [US1] Replace contiguous `split_text`/`assign_streams` use with paragraph allocation in `python/palimpsest/puzzle/build.py`
- [ ] T016 [US1] Reconstruct complete evaluation plaintext and ciphertext by source paragraph ordinal rather than agent-major order in `python/palimpsest/puzzle/build.py`

**Checkpoint**: A synthetic block builds deterministically with exact paragraph union and an explicit selected tier.

## Phase 4: User Story 2 - Oracle Information Geometry

**Goal**: Select hidden anchors, sentinels, owner-weighted specialists, and matched stable controls from actual allocation exposure.

**Independent Test**: Synthetic exposure matrices pass each tier or fail with one stable reason, and no oracle term enters the agent-visible tree.

### Verification

- [ ] T017 [P] [US2] Add tests for 12 stable anchors with all-agent/all-region exposure, six universal sentinels, three specialists per owner, solo changed-set coverage, and 15% post-boundary mass in `python/tests/puzzle/test_block.py`
- [ ] T018 [P] [US2] Add one-to-one control tests for the exact log-frequency, six-vector exposure, neighbor-Jaccard distance, arithmetic weighting, candidate order, deterministic augmenting paths, and tier thresholds in `python/tests/puzzle/test_block.py`
- [ ] T019 [P] [US2] Add explicit changed-set bijection and derangement tests in `python/tests/puzzle/test_primitives.py`

### Implementation

- [ ] T020 [US2] Implement allocation-aware exposure and neighbor-context summaries plus anchor/sentinel/specialist selection in `python/palimpsest/puzzle/block.py`
- [ ] T021 [US2] Implement deterministic one-to-one stable-control matching with a small augmenting-path matcher in `python/palimpsest/puzzle/block.py`
- [ ] T022 [US2] Extend `python/palimpsest/puzzle/revision.py` to revise an explicit changed set while preserving a bijection, stable controls, and deterministic derangement
- [ ] T023 [US2] Write compact allocation/design/manipulation oracle records outside variant-visible trees in `python/palimpsest/puzzle/build.py`

**Checkpoint**: Every feasible allocation yields valid disjoint oracle sets and exact matching evidence without exposing them to agents.

## Phase 5: User Story 3 - Stationary And Re-key Twins

**Goal**: Publish both variants from one allocation and base key with enforced pre-boundary identity and post-boundary manipulation.

**Independent Test**: Correct-key decoding is perfect for both variants, stages 1-3 match byte-for-byte, stationary old-key mismatch is zero, and re-key old-key mismatch is at least 15%.

### Verification

- [ ] T024 [P] [US3] Add paired build tests for shared base identity, pre-boundary byte equality, stationary stability, changed mapping derangement, stable controls, per-agent changed mass, and old-key loss in `python/tests/puzzle/test_build.py`
- [ ] T025 [P] [US3] Add atomic no-publication tests for infeasible tiers, control failure, pre-boundary divergence, insufficient degradation, and existing output in `python/tests/puzzle/test_build.py`
- [ ] T026 [P] [US3] Add TypeScript build handoff tests for block selection, paired result decoding, strict configured-block mismatch, fixed interim `rekey` runtime selection, and timing exclusion in `src/build.test.ts`

### Implementation

- [ ] T027 [US3] Refactor `python/palimpsest/puzzle/build.py` to derive and atomically publish stationary and re-key variants from one allocation and base key
- [ ] T028 [US3] Add paired manipulation validation and schema-version-3 publication in `python/palimpsest/puzzle/build.py`
- [ ] T029 [US3] Update `src/build.ts`, `src/flags.ts`, and `src/cli.ts` so build requires `--block`, accepts only `--discover true`, loads no experiment config, preserves one-object success output, and validates the paired result
- [ ] T030 [US3] Make the block catalog authoritative, reduce schema-v1 `puzzle` config to `block` plus `stageIntervalMs`, remove timing from Python build records, derive current offsets in TypeScript, and select the `rekey` variant in `src/config.ts`, `src/run.ts`, `src/experiment.ts`, `src/offline.ts`, and focused tests

**Checkpoint**: One provider-free command publishes a complete verified pair and existing runtime consumers can select immutable variant stages.

## Phase 6: Real Blocks And Verification

- [ ] T031 Build all five discovery entries, review first-feasible outputs, and replace zero windows with exact paragraph ranges, word counts, tiers, and window digests in `experiments/blocks.json`
- [ ] T032 [P] Add five-block deterministic rebuild and oracle-leakage acceptance tests in `python/tests/puzzle/test_build.py`
- [ ] T033 [P] Update active README, proposal, and architecture descriptions plus `specs/013-engineered-paired-blocks/quickstart.md` to distinguish implemented paired construction from later communication/protocol work
- [ ] T034 Run focused Python and TypeScript suites, format, `pnpm verify`, and `git diff --check`
- [ ] T035 Mark all completed Feature 013 tasks, re-run Spec Kit analysis, and commit the verified feature branch before starting Feature 014

## Dependencies And Parallel Work

- T001-T004 establish bytes and parsing; T005-T010 establish contracts.
- T011-T016 implement allocation before oracle selection.
- T017-T023 implement oracle design before paired encryption.
- T024-T030 implement and integrate variants before real-block discovery.
- T003, T005, T007, and T009 touch different files and can run in parallel.
- Within each user story, verification tasks are written before implementation.
- T031-T035 require all prior phases.

## Implementation Strategy

Keep one scientific owner: Python constructs and verifies the pair; TypeScript decodes and routes it. Delete obsolete contiguous allocation behavior rather than wrapping it. Use checked-in files, bounded loops, deterministic hashes, and ordinary tests; add no solver service, database, generic constraint framework, or compatibility layer.
