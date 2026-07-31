# Research: Lean Experiment Engine

## Decision: Make prepared fixture packages the runtime puzzle boundary

**Rationale**: Construction can remain deterministic and trusted while execution consumes one validated package without rediscovering corpus windows or importing study rules. The package separates agent-visible stages and references from oracle, keys, checks, and provenance.

**Alternatives considered**:

- Build puzzles inside each run: rejected because repeated construction obscures whether paired runs received identical inputs.
- Keep the five registered blocks as the runtime API: rejected because new geometry or fixtures still require code and schema changes.
- Create a generic puzzle-plugin interface: rejected because Palimpsest only needs the word-substitution experiment.

## Decision: Declare dynamic geometry and scientific constraints

**Rationale**: Agent IDs, stage count, variants, re-key boundaries, and allocation requirements are scientific inputs. Search bounds and selection mechanics remain implementation details so the public definition describes the intended experiment rather than the builder algorithm.

**Alternatives considered**:

- Preserve three agents and six stages: rejected because it makes fixture configuration cosmetic.
- Expose every search heuristic: rejected because it freezes construction internals and multiplies non-scientific controls.

## Decision: Use an explicit ordered run list

**Rationale**: Each run can be read and reviewed as the actual experiment to perform. Sequential execution bounds spend and avoids cross-run interference, while agents inside a run remain concurrent.

**Alternatives considered**:

- Generate a matrix from fixed condition and phase names: rejected because it recreates the study planner and hides concrete runs.
- Execute runs concurrently: rejected because local resource contention becomes an undeclared treatment.
- Add resume and replacement state: rejected because a new run ID is the clear declaration of repetition.

## Decision: Represent communication directly

**Rationale**: `capabilities.git` and `capabilities.teamRoom` express the capability being manipulated without encoding the current `CS`, `CR`, `IS`, or `IR` taxonomy. Shared mode exposes one ordinary peer origin; isolated mode exposes one usable private origin per agent.

**Alternatives considered**:

- Preserve named conditions: rejected because they couple communication to key variant and the current factorial design.
- Replace Git with a runner-owned collaboration protocol: rejected because native model-chosen Git behavior is part of the observation.

## Decision: Stop on failure without automatic recovery

**Rationale**: The trace and explicit status preserve what happened. Stopping makes spend and chronology obvious, while a newly declared run ID makes any repeat intentional.

**Alternatives considered**:

- Retry failed sessions or containers: rejected because retry policy changes model opportunity and can erase an infrastructure outcome.
- Continue later runs after failure: rejected because the ordered experiment would have an undeclared gap and possibly changed operator context.
- Reconstruct interrupted state: rejected because a trace without a final record is already an honest interrupted outcome.

## Decision: Use one normalized run record plus an append-only trace

**Rationale**: The record provides the frozen resolved inputs and results needed for interpretation; JSONL retains observed chronology. Atomic replacement can append later evaluation and analysis entries without introducing phase summaries, reservations, or lineage schemas.

**Alternatives considered**:

- Preserve separate attempt, protocol, design, reservation, and phase records: rejected because their coordination semantics exceed the experiment's needs.
- Store only a raw trace: rejected because reviewers need a validated snapshot of the exact run, frozen topology, and results.
- Persist full provider payloads: rejected because safe summaries and normalized observations provide the needed evidence without hidden or sensitive content.

## Decision: Evaluate every canonical origin

**Rationale**: A shared run has one team origin; an isolated run has one origin per agent. Keeping all outcomes measures integration and publication honestly and avoids a reviewer selecting the most successful isolated solver.

**Alternatives considered**:

- Select one isolated agent: rejected because the selection rule can hide missing integration and inflate the team result.
- Grade private workspaces or non-main refs: rejected because they did not receive the same checker/publication boundary.

## Decision: Validate the exact configuration immediately before execution

**Rationale**: Semantic validation of the manifest, fixture digests, model assignments, schedule, authorization, sandbox, and provider-free smoke path is closer to the scientific inputs than a receipt bound to a repository commit. The execution command repeats this gate and requires an explicit operator spend flag before provider sessions.

**Alternatives considered**:

- Keep revision-bound preflight receipts: rejected because normal config changes stale the receipt while the receipt does not itself prove fixture/run relationships.
- Rely on ordinary CI: rejected because advisory build checks do not exercise the selected fixture, sandbox, or experiment.
- Validate only once with a separate command: rejected because the selected files may drift between validation and execution.

## Decision: Keep public names unversioned

**Rationale**: `FixtureDefinition`, `FixturePackage`, `ExperimentManifest`, and `RunRecord` are clear domain names. Serialized documents include numeric `schemaVersion` solely to reject incompatible bytes.

**Alternatives considered**:

- Add version suffixes to code names: rejected because no parallel public versions exist and the suffix adds migration ceremony.
- Omit stored schema versions: rejected because incompatible archival data should fail explicitly rather than decode ambiguously.

## Decision: Make a clean break and preserve one historical preset

**Rationale**: Git history already archives old schemas and studies. The active tree should teach only the lean path, while example definitions for the existing five fixtures and twenty runs demonstrate that prior scientific inputs remain expressible.

**Alternatives considered**:

- Add compatibility readers or migration tools: rejected because no current experiment needs to execute old artifacts.
- Delete the historical fixture design entirely: rejected because it remains useful regression evidence and an example experiment.
- Retain old feature directories as active documentation: rejected because they keep superseded infrastructure discoverable as current guidance.
