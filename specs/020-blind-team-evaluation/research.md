# Research: Blind Calibration and Team-Level Evaluation

## Blind Feedback Without Oracle Access

**Decision**: Compute checker coverage from normalized word counts in the released ciphertext and solver output only. Return captured commit, execution status, output-validity status, ciphertext word count, output word count, and bounded coverage.

**Rationale**: This preserves useful packaging and completeness feedback while making correctness inaccessible by construction. Correct and incorrect same-length outputs traverse the same computation and produce the same feedback.

**Alternatives considered**: Coarsening the current accuracy into bands still leaks correctness. Computing coverage beside the oracle scorer makes non-use harder to prove. Removing the checker entirely would change an existing agent capability more than the calibration requires.

## Native Origin Set

**Decision**: Derive evaluation targets exclusively from the frozen condition topology: one shared repository for `CS`/`CR`, all three private repositories for `IS`/`IR`.

**Rationale**: These are the actual team artifacts created by the treatment. Derivation removes reviewer discretion and preserves failed integration as an outcome.

**Alternatives considered**: Selecting the best isolated score introduces post-treatment ranking. Evaluating workspaces or unpushed commits violates the publication contract. Merging isolated artifacts manufactures behavior that did not occur.

## Collective Ceiling and Integration Gap

**Decision**: Compute a position-wise ceiling across scoreable final-origin outputs in trusted memory and store only diagnostic aggregates. Never write the synthetic word sequence. Define integration gap only when a realized product and at least two distinct scoreable origins exist.

**Rationale**: The ceiling measures complementarity without turning it into a submission. Explicit null reasons prevent a meaningless zero from being interpreted as successful integration.

**Alternatives considered**: Best whole-origin score misses complementary positions. Persisting a synthetic reconstruction creates a new artifact that no team produced. Defining isolated integration gap against a nonexistent team product overstates the design.

## Diagnostic Geometry

**Decision**: Annotate expected token positions from sealed source order, stage assignment, evidence owner, boundary region, changed/control mapping, and sentinel/specialist membership. Every partition stores numerator, denominator, and nullable accuracy.

**Rationale**: Position annotations keep all diagnostic families consistent, make missing-token semantics direct, and allow exact synthetic fixtures. Nullable empty partitions are more honest than success-shaped defaults.

**Alternatives considered**: Independent ad hoc scorers risk denominator drift. Paragraph-only scores cannot express type-level or missing-position behavior. Padding candidates invents output.

## Separate Validity Tiers

**Decision**: Preserve the existing bounded evidence-threshold search as `evidenceTier` and derive `controlTier` independently from control completeness and matching distance. Apply phase gates after both values are known.

**Rationale**: Specialist evidence geometry and stable-control quality answer different validity questions. Separate tiers prevent a strong value in one dimension from concealing weakness in the other.

**Alternatives considered**: One combined tier repeats the current ambiguity. A boolean control flag loses matching-quality information. Accepting fallback evidence for calibration would weaken the exact run intended to calibrate the instrument.

## Source-To-Build Workflow

**Decision**: Make `puzzle:build --source <path> --phase <phase> --output <path>` the only source-preparation workflow. It parses, scans, validates, seals, and publishes atomically; there is no separate discovery or catalog-promotion command.

**Rationale**: Eligibility is a property of the supplied bytes and the phase gate. Deriving identity and seed from those bytes lets operators drop in new material without weakening reproducibility or requiring hand-maintained pins.

**Alternatives considered**: A discover-then-promote workflow creates stale intermediate state and manual catalog edits. Silently selecting weaker thresholds makes rejection ambiguous. Fetching bytes during builds breaks offline reproducibility.

## Behavior Review Boundary

**Decision**: Generate a strict trace-grounded behavior record whose fields are observations or explicit `null`; retain source-recognition evidence and first explicit time, but make no claim that recognition was prevented.

**Rationale**: The requested dimensions are useful only if distinguished from hidden reasoning and model-quality gates. Exact evidence references keep reviewer judgments auditable.

**Alternatives considered**: Free-form prose alone is difficult to compare. Automatic latent-intent classification would overclaim. Treating empty provider summaries as missing hidden reasoning contradicts the capture boundary.

## Paid-Run Gate

**Decision**: Commit the complete implementation and sealed catalog, run full provider-free verification, then run clean receipt-bound preflight before reading the existing credential for the four-cell calibration.

**Rationale**: Preflight binds the exact source and runnable sandbox that may support empirical findings. Rejecting invalid evidence before credential access prevents a build fallback from becoming paid behavior.

**Alternatives considered**: A live smoke test before sealing spends against an unverified instrument. Reusing an older preflight after the commit changes would leave stale provenance. Running validation immediately would skip review of the redesigned instrument.
