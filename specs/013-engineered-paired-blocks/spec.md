# Feature Specification: Engineered Paired Puzzle Blocks

**Feature Branch**: `feature/013-engineered-paired-blocks` **Created**: 2026-07-28 **Status**: Draft **Input**: Replace contiguous puzzle slicing with deterministic paragraph-preserving paired blocks whose stationary and re-keyed variants support the planned four-condition study.

## User Scenarios & Testing

### User Story 1 - Build a Deterministic Study Block (Priority: P1)

As a researcher, I can build one named block into three private agent streams and six stages whose paragraph allocation creates a useful team puzzle without losing or duplicating target text.

**Why this priority**: Every later condition depends on a stable block whose evidence geometry is deliberate rather than an accidental contiguous split.

**Independent Test**: Build the same block twice from fixed registered source bytes and confirm byte-identical agent stages, allocation metadata, oracle metadata, and build identity.

**Acceptance Scenarios**:

1. **Given** a registered target and seed, **When** the block is built twice, **Then** both builds select the same natural-prose window, boundary, allocation tier, paragraph assignments, and bytes.
2. **Given** all private stages for a block, **When** their paragraph identities are combined, **Then** every selected paragraph appears exactly once and original paragraph order is recoverable.
3. **Given** an infeasible strict tier, **When** construction continues, **Then** the first feasible declared fallback tier is selected and earlier rejection reasons are retained.

---

### User Story 2 - Preserve the Intended Information Geometry (Priority: P2)

As a researcher, I can inspect oracle-only metrics showing that each block contains shared anchors, agent-weighted specialist evidence, universal sentinels, bounded solo coverage, balanced token mass, and matched stable controls.

**Why this priority**: The puzzle design should create controlled opportunities for collaboration and re-key detection without prescribing agent behavior.

**Independent Test**: Validate every committed block against the selected tier and confirm the agent-visible stage tree contains none of the oracle labels, sets, keys, or expected effects.

**Acceptance Scenarios**:

1. **Given** a built block, **When** allocation metrics are validated, **Then** every selected constraint passes the recorded tier and no agent exceeds the tier's solo-coverage bound.
2. **Given** sentinel, specialist, and control sets, **When** exposure is measured, **Then** sentinels are visible to all agents, specialist evidence is owner-weighted, and controls are matched on declared frequency, exposure, and context metrics.
3. **Given** an agent-visible build, **When** its files and prompts are searched, **Then** no oracle label, key, set membership, optimizer expectation, or manipulation-check result is exposed.

---

### User Story 3 - Derive Stationary and Re-key Twins (Priority: P3)

As a researcher, I can derive stationary and re-keyed variants from one selected window, base key, and paragraph allocation so their evidence is identical before the boundary and differs only through the declared post-boundary key manipulation.

**Why this priority**: Paired variants are the basis for comparing stable and changing key regimes without confounding pre-boundary evidence.

**Independent Test**: Build both variants and verify byte-identical stages before stage four, stable decoding in the stationary twin, and a declared minimum old-key loss after the re-key boundary.

**Acceptance Scenarios**:

1. **Given** paired variants, **When** stages one through three are compared, **Then** corresponding ciphertext bytes are identical.
2. **Given** the stationary twin, **When** the base key is applied after the boundary, **Then** its declared sentinel, specialist, and control mappings remain stable.
3. **Given** the re-keyed twin, **When** the old key is applied after the boundary, **Then** the recorded manipulation check meets the selected tier's minimum degradation while stable controls remain unchanged.

### Edge Cases

- A target has enough text overall but no natural-prose window satisfies even the fallback tier.
- Paragraph parsing encounters front matter, empty markup, headings, or unusually long paragraphs.
- A candidate allocation balances token mass but fails complete union coverage or paragraph order.
- A word type appears frequently but lacks usable exposure on both sides of the boundary.
- Specialist candidates overlap, lose owner asymmetry, or cannot be matched to stable controls.
- The stationary and re-key twins diverge before the boundary.
- An oracle-only label or key path would enter an agent-visible directory.

## Puzzle & Observation Boundaries

**Puzzle Behavior**: Exactly three agents receive six paragraph-preserving stages from one deterministic natural-prose window. The allocation creates shared, asymmetric, and universal evidence without telling agents those categories. A paired variant may change selected mappings beginning at stage four.

**Agent Instructions & Tools**: This feature does not change the concise team objective, model sessions, tools, Git surface, checker disclosure, or requested output. It adds no roles, decoding advice, workflow, required artifact, or behavioral expectation.

**Environmental Constraints**: Existing private-evidence, sandbox, network, secret, token, wall-time, and evaluation boundaries remain unchanged. Allocation and key-selection oracles remain outside agent-visible workspaces and Git.

**Observable Outcomes**: Build records retain block identity, paired variant identity, allocation tier and metrics, rejected-tier reasons, oracle sets, and manipulation checks. Model behavior is not exercised or judged by this feature.

**Infrastructure Failures**: Missing or mismatched source provenance, paragraph extraction failure, infeasible allocation, invalid union coverage, unmatched controls, pre-boundary twin divergence, insufficient old-key degradation, or artifact publication failure stop construction explicitly.

**Verification Boundary**: Provider-free deterministic and property tests authorize implementation. Existing advisory development checks and clean receipt-bound research preflight remain unchanged.

**Out-of-Scope Claims**: The allocation does not guarantee collaboration, source recognition, belief revision, construct validity, or a particular solving advantage. It is a controlled puzzle opportunity, not a behavioral conclusion.

## Requirements

### Functional Requirements

- **FR-001**: The builder MUST use exactly three agents, six stages, and a paired-variant boundary beginning at stage four for study blocks.
- **FR-002**: The builder MUST select the first deterministic feasible natural-prose window for each registered block.
- **FR-003**: The builder MUST preserve canonical extracted paragraph bytes and original paragraph order within every stage while independently pinning the raw source bytes.
- **FR-004**: The union of all private stages MUST cover every selected paragraph exactly once.
- **FR-005**: Allocation MUST use a bounded seeded search across exactly three predeclared constraint tiers in strict-to-fallback order.
- **FR-006**: The build record MUST identify the selected tier, its measured metrics, and the reason every earlier tier was rejected.
- **FR-007**: Every feasible allocation MUST contain at least 12 stable shared anchors, each exposed at least once before and after the boundary to every agent.
- **FR-008**: Every feasible allocation MUST contain disjoint owner-weighted specialist sets for all three agents.
- **FR-009**: Every feasible allocation MUST contain at least six sentinels with tier-required pre- and post-boundary exposure in all three agents.
- **FR-010**: Every feasible allocation MUST keep each agent's solo coverage within the selected tier's declared bound.
- **FR-011**: Every feasible allocation MUST keep private token mass within the selected tier's declared balance bound.
- **FR-012**: Stable controls MUST be selected deterministically and matched to manipulated types on declared frequency, exposure, and context metrics.
- **FR-013**: Stationary and re-keyed twins MUST share one selected window, paragraph allocation, and base key.
- **FR-014**: Corresponding pre-boundary stages in paired twins MUST be byte-identical.
- **FR-015**: The stationary twin MUST retain the base mappings across all six stages.
- **FR-016**: The re-keyed twin MUST change only its selected post-boundary mappings while stable controls remain unchanged.
- **FR-017**: The build MUST fail unless applying the base key after the boundary loses at least 15 percentage points of token accuracy in the re-key twin while losing none in the stationary twin.
- **FR-018**: Agent-visible artifacts MUST exclude keys, oracle labels, set membership, tier expectations, rejected-tier reasons, and manipulation checks.
- **FR-019**: Build records MUST identify block, variant, selected source window, allocation identity, tier metrics, oracle metadata, and manipulation-check results.
- **FR-020**: The provenance registry MUST pin source URL, local bytes, byte length, and digest for the calibration target _The Damnation of Theron Ware_ and validation targets _The Odd Women_, _The Country of the Pointed Firs_, _The Custom of the Country_, and _The Woodlanders_.
- **FR-021**: Construction and acceptance MUST require no provider credentials or live model request.
- **FR-022**: Existing build consumers MUST continue to receive immutable ordered private stage files and complete evaluation ciphertext.

### Key Entities

- **Study Block**: A named registered target, deterministic prose window, fixed three-agent/six-stage geometry, base allocation, and two paired variants.
- **Paragraph Unit**: One ordered natural-prose paragraph with stable identity, text bytes, token mass, and word-type evidence.
- **Allocation Tier**: One predeclared set of feasibility bounds and its deterministic rejection or selection record.
- **Allocation**: The complete paragraph-to-agent-and-stage assignment plus coverage and balance metrics.
- **Oracle Word Set**: Deterministically selected anchor, specialist, sentinel, or stable-control types retained only in trusted build records.
- **Paired Variant**: The stationary or re-keyed ciphertext derived from the same base block.
- **Manipulation Check**: Deterministic evidence that pre-boundary twins match and old-key performance degrades sufficiently only after the re-key boundary.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Two builds from identical registered bytes and scientific inputs are byte-identical in all stages, oracle records, metrics, and build identity.
- **SC-002**: Every committed block has 100% paragraph union coverage, zero duplicate paragraph assignments, and preserved original order.
- **SC-003**: Every committed block satisfies all constraints of one declared tier with complete rejected-tier reasons for any prior tier.
- **SC-004**: Every agent has at least three owner-weighted specialists, every block has at least 12 shared anchors and six sentinels with their declared exposure, and every manipulated type has a stable matched control.
- **SC-005**: All paired blocks have byte-identical stages one through three, zero stationary old-key mismatch, and at least 15% re-key old-key mismatch over all post-boundary word tokens.
- **SC-006**: All five provenance-pinned targets build deterministically with no network or model-provider access.
- **SC-007**: Agent-visible artifact scans find zero oracle keys, labels, set memberships, expected effects, or manipulation-check values.
- **SC-008**: The complete focused Python and TypeScript suites plus repository verification pass without changing the existing runtime behavior.

## Assumptions

- The experimental geometry is fixed at three agents, six stages, and a boundary at stage four.
- Paragraph allocation, not new runtime workflow, is the primary mechanism for creating collaboration opportunity.
- The first deterministic feasible prose window is committed before any paid calibration.
- Corpus bytes are checked in and provenance-pinned; construction never downloads sources.
- Release timing belongs to the runtime protocol rather than block identity, so immutable ordered stages can later use non-uniform schedules.
- Existing provider adapters, sessions, sandbox, checker, preflight, evaluation, and durable publication are reused unchanged.
- Tier bounds are global frozen builder constants recorded in the feature plan and contract rather than configurable per block.
