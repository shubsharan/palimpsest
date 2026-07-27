# Research: Revision Dynamics

## Decision 1: Carry forward the narrow Gate B premise

**Decision**: Use the retained Amber unrecognized-literary profile and one capable solver. Do not add Cobalt, a human arm, or publication-grade replication to Gate C.

**Rationale**: Gate B already answered the product question that semantic analysis can progress beyond the mechanical attempt when the literary source is not recognized. Gate C changes one thing: a bounded subset of mappings becomes stale during progressive reveal.

**Alternatives considered**:

- Three-corpus Gate B completion was rejected because it tests generalization, not whether revision dynamics work.
- Birch was rejected because source recognition contaminated its solver result.
- Human and multi-model arms were deferred because they are research-strengthening work, not prerequisites for the product gate.

## Decision 2: Use a 27,504-token chapter-complete instance

**Decision**: Build a fresh Gate C instance from complete source chapters 10 through 15, containing 27,504 word tokens, and switch after chapter 12. The adjacent segments contain 14,645 and 12,859 word tokens.

**Rationale**: The existing 20,000-token Gate B geometry cannot guarantee the required minimum on both sides of a chapter-aligned switch. A fresh instance preserves the profile while satisfying the revision experiment's geometry.

**Alternatives considered**:

- Reusing the exact Gate B bytes was rejected because a valid internal boundary may not leave 10,000 tokens on both sides.
- Concatenating unrelated passages was rejected because it would introduce a content-regime change independent of the key change.

## Decision 3: Select observable changed entries and matched controls

**Decision**: Eligible types occur at least eight times in each segment. Partition them into four post-switch frequency strata, then deterministically select changed types across strata until their occurrences account for 20% of eligible post-switch token mass. Match each changed type to one unchanged type in the same stratum using closest normalized frequency and a lexicographic tie-break.

**Rationale**: Active-on-both-sides eligibility ensures that stale beliefs can receive contradictory evidence. Stratification and matching separate re-key effects from ordinary frequency-dependent mapping difficulty.

**Alternatives considered**:

- Uniform type sampling was rejected because rare selections can be behaviorally invisible.
- Matching by raw counts alone was rejected because the adjacent segments differ in length.
- Changing most token mass was rejected because it turns partial revision into a near-restart.

## Decision 4: Rotate selected images, not the whole key

**Decision**: Compose the stationary encryption key with a seeded Sattolo derangement over the selected ciphertext-image subset. Verify complete bijection, changed-from-prior, changed-from-identity, and unchanged-outside-selection invariants.

**Rationale**: Composition preserves the vocabulary-wide bijection while isolating the intervention to the declared entries. A Sattolo cycle guarantees that every selected image moves.

**Alternatives considered**:

- Independent reassignment was rejected because it can create collisions.
- Full re-keying was rejected because restart becomes the rational strategy.
- Pairwise swaps were rejected because they create a narrower and less representative rotation topology.

## Decision 5: Release chapters on one injected monotonic clock

**Decision**: Produce six chapter-atomic release slots at equal cumulative-token targets. Production uses two-minute monotonic intervals, zero early-release tolerance, and 1,000 milliseconds of scheduler-lateness tolerance. Each response has a 110-second timeout and zero retries. The runner records planned and observed monotonic offsets before the solver request associated with each release. Tests inject a fake clock.

**Rationale**: A fixed wall-clock schedule prevents solver turns, inspection order, and tool use from determining when contradictory evidence arrives. The response deadline is shorter than the reveal interval, so a valid chained checkpoint completes before the next release; a timeout fails the attempt instead of delaying the clock. Six slots provide pre-switch learning and multiple post-switch recovery observations without creating a long product experiment.

**Alternatives considered**:

- Turn-based release was rejected because detection latency would be confounded by solver behavior.
- Releasing the complete instance at start was rejected because latency would measure inspection order.
- One file per paragraph was rejected because it adds scheduling noise without improving the gate decision.

## Decision 6: Preserve solver continuity with API-managed state

**Decision**: Use one explicit Code Interpreter container and chain Responses API calls with `previous_response_id`. Upload only newly released cipher chapters before each response. Keep the container network disabled and persist every response event and checkpoint locally as it arrives.

**Rationale**: Explicit container reuse gives the solver a stable code workspace, while response chaining preserves conversational context. OpenAI documents explicit container creation and reuse by ID, and documents `previous_response_id` as the mechanism for chained responses. Containers expire after 20 minutes of inactivity, so the two-minute schedule stays within the active window and the runner still treats container state as ephemeral.

**Primary sources**:

- [OpenAI Code Interpreter guide](https://developers.openai.com/api/docs/guides/tools-code-interpreter)
- [OpenAI conversation state guide](https://developers.openai.com/api/docs/guides/conversation-state)
- [OpenAI Containers API](https://developers.openai.com/api/reference/resources/containers)
- [OpenAI container files API](https://developers.openai.com/api/reference/resources/containers/subresources/files)

**Alternatives considered**:

- A new container per reveal was rejected because it discards the solver's executable working state.
- Passing all prior plaintext conversation manually was rejected because it duplicates API-managed continuation and complicates provenance.
- Substituting a cheaper model after quota failure was rejected because it changes the experimental condition.

## Decision 7: Keep live output observable without claiming hidden reasoning

**Decision**: Append timestamped response events, tool-call summaries, code outputs, structured checkpoints, and artifact digests to `live.jsonl` during the run. Do not claim to expose private chain-of-thought.

**Rationale**: The product need is operational observability and durable work evidence. Streamed public response events and code artifacts show what the solver does without depending on hidden internal reasoning.

**Alternatives considered**:

- Waiting for one final transcript was rejected because it obscures progress and failure timing.
- Reconstructing or labeling hidden reasoning as chain-of-thought was rejected because it is not an available or reliable evidence surface.

## Decision 8: Separate calibration, judged attempts, and operator pointers

**Decision**: Calibration outputs use a disposable namespace. Every judged run creates a fresh immutable attempt directory keyed by declaration digest and run ID. Imports name the exact attempt. `current.json` is written atomically and is never an evidence input.

**Rationale**: This prevents reruns, stale outputs, and concurrent work from contaminating the judged bundle.

**Alternatives considered**:

- Reusing `artifacts/gate-c/work` was rejected because partial files can look current.
- Scanning for the newest attempt was rejected because filesystem order is not identity.
- Treating the pointer as evidence was rejected because it is mutable operator state.

## Decision 9: Bound the replay claim

**Decision**: Replay regenerates the instance and reveal plan, validates recorded clock ordering, recomputes every score and decision, and verifies all digests. It does not reproduce the model's behavior, remote container state, network timing, or exact scheduler jitter.

**Rationale**: Deterministic evidence processing supports auditability without overstating stochastic reproducibility.

## Resolved Operational Constraint

The local OpenAI-backed admission returned `insufficient_quota`. Gate C implementation is complete and its components may be integrated into Milestones 4–6, but no further admission or judged solver call is permitted until the offline end-to-end harness passes. API capacity is a second execution prerequisite after that milestone, not a reason to change the model or gate rule.
