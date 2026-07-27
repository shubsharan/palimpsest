# Feature Specification: Channel Separation

| Field          | Value                                              |
| -------------- | -------------------------------------------------- |
| Feature branch | `002-channel-separation`                           |
| Created        | 2026-07-26                                         |
| Status         | Complete                                           |
| Input          | Roadmap Milestone 2: "Channel separation (Gate A)" |

## Outcome

Gate A passes the frozen rule for the retained `tokens-27000-vocab-8000` geometry. The useful-state workload costs 18,503 cumulative `GitAccountingFrameV1` bytes. The strongest tested exact full-shard relay costs 39,534 frame bytes, and the separately bounded publication-presence channel contributes 15 bytes. Twenty adjacent 1 KiB sweep points pass from 19,456 through 38,912 bytes.

The completed [gate report](../../artifacts/gate-a/gate-report.json), [milestone report](../../artifacts/gate-a/milestone-report.json), [raw sweep summary](../../artifacts/gate-a/raw/sweep-summary.json), and [frontier plot](../../artifacts/gate-a/raw/frontiers.svg) resolve the 630 exact relay attempts and four cumulative useful-state checkpoints by digest. Independent replay reconstructs every stored frame, recomputes every cumulative charge and sweep point, and returns the same pass. The result freezes accounting version 1 and this tested interval for later feasibility work. It authorizes Gate B, not the live Git Gateway or full harness.

## User Scenarios & Testing _(mandatory)_

Gate A serves maintainers and independent reviewers deciding whether constrained Git collaboration is mechanically defensible before Palimpsest builds an agent harness. It tests the channel itself, not agent behavior: real Git state must carry a useful evolving belief payload while the strongest tested relay strategy, with all shared side information, cannot carry a complete shard within the same cumulative budget.

### User Story 1 - One logical Git state, one charge (Priority: P1)

An independent reviewer constructs or replays a permitted Git ref update and obtains one deterministic communication charge from the logical state that becomes peer-visible. Repacking, delta selection, object order, compression settings, or another supported Git client cannot change that charge. Any peer-visible choice in refs, commits, trees, blobs, paths, modes, metadata, topology, object selection, or publication timing is charged, bounded separately, or rejected.

**Why this priority**: A budget interval is meaningless until the meter is injective over every accepted logical channel and independent of sender-selected transport representation.

**Independent Test**: Create equivalent pushes through varied native Git pack encodings and clients, reconstruct their accepted logical transactions, and compare the accounting frames byte for byte. Mutate each peer-visible field in isolation and confirm that the frame changes or the transaction is rejected.

**Acceptance Scenarios**:

1. **Given** two packfiles representing the same accepted logical ref and object transaction, **When** each is metered against the same slot-start visibility set, **Then** both produce byte-identical accounting frames and equal charges.
2. **Given** a valid accounting frame, **When** it is decoded and re-encoded, **Then** the bytes are identical and every length-delimited field has exactly one interpretation.
3. **Given** a mutation to a peer-visible ref, commit, tree, blob, filename, mode, timestamp, parent edge, or object choice, **When** the candidate is metered, **Then** the accounting bytes change or the candidate is rejected.
4. **Given** an object already visible before a slot, **When** a later update references it, **Then** its contents are not charged again but the new logical references that communicate the choice are charged.
5. **Given** the same never-visible object independently exposed by two candidates in one publication slot, **When** charges are computed, **Then** each candidate pays for the object relative to the slot-start visibility set.

---

### User Story 2 - Strongest tested shard relay stays outside a useful budget (Priority: P2)

An adversarial researcher receives every input legitimately shared with agents and tries to encode a complete shard through all accepted Git surfaces. The researcher may compress raw text or token IDs, exploit shared dictionaries and reference corpora, design custom codebooks, split payloads across cumulative updates, choose metadata-heavy histories, select objects or graph shapes, and choose publication slots. The same sweep also measures compact belief artifacts that later agents actually need: partial dictionaries with confidence and provenance, switch hypotheses, contradiction notes, and reconstruction diffs.

**Why this priority**: Channel separation is the empirical premise of constrained collaboration. The strongest tested complete-shard relay must remain more expensive than useful evolving belief under the exact production accounting rule.

**Independent Test**: Run the frozen attack and useful-state corpus through real repositories, sum exact per-agent frame charges and separately bounded timing capacity over the full run, and plot relay and useful-state frontiers across every predeclared text and vocabulary geometry.

**Acceptance Scenarios**:

1. **Given** the complete declared common-input bundle, **When** every predeclared relay strategy encodes each frozen shard, **Then** the report identifies the least cumulative exact-frame charge achieved for a complete relay.
2. **Given** the frozen useful-state workload, **When** each required belief artifact is encoded through permitted Git operations, **Then** the report identifies the greatest cumulative charge required to preserve the predeclared useful content.
3. **Given** relay and useful-state frontiers plus bounded slot-choice capacity, **When** the budget sweep is evaluated, **Then** any claimed interval has a lower bound that carries every required useful state and an upper bound strictly below every successful complete-shard relay.
4. **Given** a strategy that splits information across branches, commits, shared objects, metadata, topology, or time, **When** all updates are accumulated over a run, **Then** no charge or separately bounded capacity is reset or omitted.
5. **Given** a relay strategy that fails to reconstruct the complete shard exactly, **When** results are ranked, **Then** it is recorded as an incomplete attack and cannot establish the relay threshold.

---

### User Story 3 - A predeclared decision governs what may be built next (Priority: P3)

A maintainer freezes the accounting version, Git genesis, common side information, shard and useful-state fixtures, supported environment, attack matrix, budget sweep, timing model, and pass/rework/stop rule before judged measurements. The completed Gate A report resolves every raw artifact by digest and authorizes later work only when a defensible nonempty interval exists.

**Why this priority**: Post hoc budget selection would manufacture separation. Gate A must decide whether the communication mechanic survives adversarial measurement, not tune the conclusion after seeing results.

**Independent Test**: Validate the predeclaration, run the frozen matrix, complete the report without changing its inputs or decision rule, and verify that all plotted points and extrema can be recomputed from digest-addressed raw results.

**Acceptance Scenarios**:

1. **Given** no valid predeclaration, **When** a judged sweep is requested, **Then** no Gate A result is produced.
2. **Given** a completed Gate A report, **When** a reviewer resolves its artifacts, **Then** the accounting vectors, native Git fixtures, attack outputs, useful-state outputs, timing calculation, sweep table, and analysis all match their recorded digests.
3. **Given** a passing nonempty interval, **When** the result is completed, **Then** the accounting version and tested interval are frozen for later gates while full-harness construction remains unauthorized.
4. **Given** no nonempty interval, **When** useful belief still fits below some relays, **Then** the result is `rework` and identifies the owning geometry changes without weakening accounting or tuning the cap.
5. **Given** an accounting omission or an invalid experiment, **When** detected, **Then** the result is blocked as an integrity failure rather than reported as an empirical pass or stop.

### Edge Cases

- A push creates rather than updates a ref, uses the maximum legal ref name, or selects the all-zero old object identifier.
- A commit has multiple parents, repeated-looking metadata, non-ASCII content, unusual but permitted timestamps, an executable file, an empty tree, or a zero-length blob.
- Object order differs, a pack is thin, deltas use different bases or depths, or an object is already present locally but has never been peer-visible.
- A candidate contains duplicate, unreachable, unsupported, oversized, unsafe, case-colliding, or non-normalized objects or paths.
- Two candidates in one slot expose identical objects, update the same ref, or depend on different captured published snapshots.
- An attacker uses branch choice, commit count, parent topology, filename choice, object-ID grinding, push presence, or later-slot choice instead of blob contents.
- A relay reconstructs all but one byte, reconstructs a normalized rather than exact shard, or relies on side information not included in the frozen common-input bundle.
- A useful-state encoding omits required confidence, provenance, contradiction, or version history to appear artificially cheap.
- The cheapest relay or most expensive useful state lies at the edge of the predeclared sweep, leaving the interval unresolved.

## Evidence & Trust Boundaries _(mandatory)_

**Owning Gate/Milestone**: Roadmap Milestone 2, Channel Separation (Gate A). It answers: "Does a usable cumulative outbound budget interval exist in which agents can share an evolving belief state but cannot relay a complete shard?"

**Minimum Scope**: Build only the exact accounting codec and the adversarial real-Git measurement harness required to answer Gate A. This feature does not implement authentication, a live Git Gateway, ledgers, publication services, agent sandboxes, reveal, grading, puzzle generation, or a production run coordinator. It simulates only the publication-slot and ever-visible-set semantics necessary to calculate the complete channel capacity honestly.

**Predeclared Evidence**: Before judged runs, the Gate A predeclaration freezes the accounting contract and golden vectors; Git object format and genesis; supported Git versions; repository scaffold and allowed policy; common side information including the exact agent reference corpus, schemas, client behavior, and custom codebooks; exact shard and useful-state fixtures; attack and codec matrix; text and vocabulary geometries; cumulative update and slot schedules; ingress limits; timing and push-presence capacity calculation; numeric budget sweep; environment and producer versions; raw artifact inventory; and pass/rework/stop criteria. Pass requires a nonempty practical interval between the worst required useful-state charge and the best exact complete-shard relay charge after all separately bounded capacity is included. Rework changes geometry in the roadmap order and reruns Gate A. Stop forbids weakening accounting or tuning the cap to create a pass.

**Trust & Visibility Impact**: The harness processes only frozen Gate A fixtures and public/common side information. It creates no agent environment, secret shard mount, oracle, credential, network service, or public benchmark artifact. Native Git repositories and compressor processes run in temporary, network-disabled workspaces. Raw attack outputs and reports stay trusted evidence artifacts. The contract adds the future peer-visible accounting frame but does not expose any live repository.

**Failure Classification**: A compressor that cannot reconstruct the shard is an expected failed attack. A valid measurement showing no usable interval is an empirical `rework` or `stop` result. A codec disagreement, omitted channel, undeclared side input, digest mismatch, non-reproducible Git fixture, environment mismatch, or changed predeclaration is an infrastructure integrity failure that invalidates the run and produces no Gate A conclusion.

**Invalidation Path**: Gate A depends on Milestone 1. A Milestone 1 contract or promotion defect invalidates Gate A evidence. A change to accounting bytes, Git object format, genesis, ref policy, publication-slot model, common inputs, shard geometry, useful-state definition, attack matrix, or timing calculation requires a new Gate A predeclaration and rerun. Gate A changes invalidate every later communication budget, Gate D matched comparison, harness policy, calibration, and release claim that consumes them.

## Requirements _(mandatory)_

### Functional Requirements

**Accounting authority**

- **FR-001**: The feature MUST define one versioned, deterministic, injective accounting frame for exactly one accepted create or update operation over a Git SHA-256 repository.
- **FR-002**: The frame MUST encode its magic, complete length, accounting version, object format, authenticated run-local agent number, publication slot, raw ref operation, sorted newly peer-visible object records, and all fixed-width lengths and identifiers specified by the architecture.
- **FR-003**: Object records MUST contain enough exact logical type, length, content, and identifier information to uniquely determine each accepted commit, tree, and blob independent of its pack representation.
- **FR-004**: The charge MUST equal the complete serialized frame length and MUST accumulate per agent over the whole run without resets.
- **FR-005**: Decode followed by encode MUST be byte-identical for every valid frame, and malformed, ambiguous, duplicate, unsupported, over-limit, or trailing data MUST be rejected.
- **FR-006**: Golden vectors MUST cover creates, updates, commits, merge commits, trees, regular and executable files, empty and non-empty blobs, already-visible objects, and every permitted boundary-sized field.

**Real Git transaction reconstruction**

- **FR-007**: The harness MUST create and inspect real SHA-256 Git repositories, refs, commits, trees, and blobs rather than substitute abstract message or file sizes.
- **FR-008**: For an accepted candidate, the newly visible set MUST contain every object reachable from the new tip that is absent from the slot-start ever-visible set, sorted by unsigned raw object identifier.
- **FR-009**: Two candidates in the same slot MUST each be charged relative to the same slot-start ever-visible set before accepted objects are unioned into the next published visibility journal.
- **FR-010**: The harness MUST reject force updates, deletions, multi-ref pushes, unreachable objects, unsupported object types or modes, unsafe or colliding paths, and every disallowed surface named by the architecture.
- **FR-011**: The same logical transaction MUST produce identical accounting bytes across every predeclared pack order, compression, delta, thin-pack, and supported-client variation.
- **FR-012**: Mutating any accepted peer-visible ref, commit, tree, blob, path, mode, metadata, topology, or object-selection field MUST change the frame or make the transaction invalid.

**Adversarial capacity measurement**

- **FR-013**: The attack harness MUST give every relay strategy the complete frozen common-input bundle and MUST record each strategy's declared and actually accessed inputs.
- **FR-014**: The attack matrix MUST include raw and compressed text, token identifiers, sparse and complete dictionaries, reference-corpus-conditioned compression, custom codebooks, metadata-heavy histories, object and topology selection, and cumulative multi-update strategies.
- **FR-015**: A relay attempt MUST count only when it reconstructs the complete frozen shard byte for byte; incomplete reconstruction MUST be retained as a failed attack.
- **FR-016**: The useful-state matrix MUST preserve the predeclared semantic fields and version history of partial dictionaries, confidence, provenance, switch hypotheses, contradiction notes, and reconstruction diffs.
- **FR-017**: Every attack and useful-state candidate MUST be materialized as accepted real Git state and charged by the exact production accounting frame.
- **FR-018**: The harness MUST separately calculate the maximum capacity of publication-slot choice, push presence or absence, bounded ref choice, and any measured residual transport channel, then include that capacity in the separation analysis.
- **FR-019**: The sweep MUST sum all accepted updates over the full run and report sensitivity across every predeclared shard length, vocabulary size, text geometry, side-information bundle, slot schedule, and strategy.

**Evidence and decision**

- **FR-020**: Judged measurement MUST refuse to run without a valid Gate A predeclaration that binds all inputs, numeric sweep points, environment versions, producers, thresholds, and decision rules by digest.
- **FR-021**: Each attempt MUST use the Milestone 1 artifact protocol, run without network access, promote only exact declared outputs, and record failures without success-shaped artifacts.
- **FR-022**: The completed Gate A report MUST reference native Git fixtures, frame vectors, attack results, useful-state results, timing calculations, sweep tables, plots, and analysis by digest.
- **FR-023**: A pass MUST identify at least one predeclared cumulative budget that carries every required useful-state workload and remains strictly below the strongest successful complete-shard relay after separately bounded capacity is included.
- **FR-024**: A rework result MUST identify the owning geometry change in roadmap order and MUST invalidate the prior predeclaration and every dependent result.
- **FR-025**: The feature MUST NOT weaken accounting, omit a channel, redefine complete reconstruction, reduce required useful state, or select an untested budget after observing results to manufacture a pass.
- **FR-026**: A passing result MAY authorize Gate D to consume the frozen accounting version and interval, but MUST NOT authorize full-harness construction before Gates B-D also pass.

### Key Entities

- **Git Accounting Frame V1**: The unique binary record and cumulative charge for one accepted logical ref/object transaction.
- **Git Genesis**: The frozen accounting version, object format, initial published ref map, initial ever-visible object set, and digest that define common repository state.
- **Logical Transaction**: One authenticated create or update operation plus every newly peer-visible reachable logical Git object measured against a slot-start snapshot.
- **Visibility Journal**: The append-only set of objects that have ever been peer-visible and therefore are common side information for later slots.
- **Common Input Bundle**: Every schema, corpus, scaffold, dictionary, codebook, client behavior, genesis value, and other side input available to both agents and attackers.
- **Relay Attempt**: One exact-reconstruction strategy, its frozen inputs, materialized Git history, cumulative charge, separately bounded capacity, output, and verdict.
- **Useful-State Workload**: The minimum predeclared evolving belief content that collaboration must carry, including its required semantic fields and history.
- **Budget Sweep Point**: One cumulative per-agent cap with relay feasibility, useful-state feasibility, timing capacity, margin, and sensitivity coordinates.
- **Gate A Report**: The predeclared and completed evidence record that freezes the accounting version and returns pass, rework, or stop.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For 100% of equivalent logical transactions across the predeclared pack and client variations, accounting frames are byte-identical and charges agree exactly.
- **SC-002**: For 100% of valid golden vectors, decoding and re-encoding is byte-identical; 100% of malformed or ambiguous vectors are rejected.
- **SC-003**: Every predeclared mutation of a peer-visible logical field changes the accounting frame or is rejected, with zero unmeasured accepted mutations.
- **SC-004**: Every accepted transaction's charged object set exactly equals the newly peer-visible reachable set relative to the slot-start journal, including all same-slot duplicate-exposure cases.
- **SC-005**: 100% of relay and useful-state trials use real Git objects and exact frame charges; zero reported sweep points substitute compressed payload size, pack size, or abstract message size for production accounting.
- **SC-006**: Every successful relay reconstructs its frozen shard byte for byte, and the report retains all incomplete attacks without counting them toward the relay threshold.
- **SC-007**: The completed matrix covers 100% of the predeclared compressors, shared-side-information conditions, Git metadata and topology surfaces, cumulative-update strategies, text geometries, and publication schedules.
- **SC-008**: The report accounts for 100% of declared peer-visible byte, object-selection, ref-choice, push-presence, slot-choice, and residual transport capacity, with no unexplained channel.
- **SC-009**: A passing result contains at least one predeclared budget point whose useful-state margin is nonnegative and whose exact complete-shard relay margin remains strictly positive after all separately bounded capacity is included.
- **SC-010**: Repeating the frozen sweep in the pinned supported environment reproduces every promoted raw artifact, extremum, budget classification, and report digest exactly.
- **SC-011**: Every artifact cited by the Gate A report resolves by digest, every threshold and input matches the predeclaration, and zero downstream evidence remains valid after a declared invalidating change.
- **SC-012**: Gate A introduces zero live agent, credential, secret mount, network service, grader, generator, or full-harness component.

## Assumptions

- Gate A measures the communication channel independently of puzzle solving. Frozen shard and useful-state fixtures are representative capacity inputs, not production puzzle instances or Gate B evidence.
- The architecture's `GitAccountingFrameV1`, single-ref fast-forward policy, Git SHA-256 format, slot-start visibility rule, and fixed publication-slot model are settled design inputs, not calibration knobs.
- Exact numeric budget sweep points, fixture geometries, useful-state minimums, supported Git-client matrix, and timing bounds are research decisions made and recorded during planning, then frozen before judged runs.
- The strongest tested attacker is an empirical standard rather than a proof against every possible compressor. The report names residual strategies and preserves the ability to rework when a stronger attack appears.
- A passing Gate A interval is consumed by later feasibility work only. Gates B, C, and D remain independent blockers for the production harness.
