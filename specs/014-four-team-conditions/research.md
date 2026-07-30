# Research: Four Team Conditions

## Canonical Treatment Mapping

**Decision**: Decode only `CS`, `CR`, `IS`, and `IR` through one exhaustive table. Derive communication mode and paired-build variant everywhere else.

**Rationale**: The condition identifier is the treatment. Accepting separate booleans or aliases permits contradictory records and accidental comparison drift.

**Alternatives considered**: Independent `shared` and `rekey` flags were rejected because they create invalid combinations and duplicate validation. Human-friendly aliases and case folding were rejected because the frozen protocol needs exact identifiers.

## Fixed Non-Uniform Schedule

**Decision**: Replace arithmetic stage intervals with explicit offsets `[0, 300000, 600000, 1200000, 1800000, 2400000]` and cutoff `3600000`, all measured by the existing monotonic clock.

**Rationale**: The declared 0/5/10/20/30/40-minute schedule is non-arithmetic. An offset vector is smaller and more truthful than encoding special cases in interval logic.

**Alternatives considered**: Keeping `stageIntervalMs` was rejected because it cannot express the treatment. A generic cron/timeline engine was rejected as unnecessary for six fixed releases.

## Git Topology

**Decision**: Generalize the existing Git environment into a repository inventory plus one workspace-to-repository assignment per agent. Shared conditions assign all workspaces to one origin; isolated conditions assign one origin per agent. All origins appear inside the sandbox at `/git/origin.git` and begin at the same deterministic commit containing a neutral `solver.py`.

**Rationale**: Ordinary Git remains a native, unmetered tool in both modes. One stable path and identical scaffold hold the non-treatment environment constant while host-side assignment enforces peer visibility. Agents choose their own Git operations, but only pushed `main` state can be checked or graded.

**Alternatives considered**: Removing Git in isolated mode was rejected because it changes the tool surface and violates Constitution 5. Permission layers inside one shared repository were rejected as leak-prone and more complex than three local bare repositories.

## Activity Isolation

**Decision**: Give each agent its own activity bus. Publish its stage releases locally, shared Git changes to all buses, and isolated Git changes only to the owner's bus.

**Rationale**: The current global sequence makes all Git events visible and would leak hidden activity through sequence gaps even if events were filtered. Per-agent streams are simpler than cursor remapping and make non-observability testable.

**Alternatives considered**: Adding an owner field to the current global bus was rejected because hidden peer events still advance the sequence. Filtering only tool output was rejected because timing/cursor metadata would remain a side channel.

## Prompt Parity

**Decision**: Build prompts from invariant paragraphs plus exactly one communication paragraph. Declare the word-substitution cipher and canonical `origin/main:solver.py` submission in both modes. In shared conditions, encourage agents to publish useful changes, inspect peer commits, compare approaches, and integrate the strongest work without assigning roles, turns, branches, or a commit sequence.

**Rationale**: Communication availability remains the environmental treatment. The common final interface makes the collaboration target and grading boundary legible; open-ended Git choices preserve collaboration behavior as an outcome.

**Alternatives considered**: Separate full shared and isolated prompt templates were rejected because they drift easily. Keeping the current "coordinate and review" text was rejected as behavior-prescriptive.

## Durable Attempt Contract

**Decision**: Publish attempt schema version 3 with the condition, derived treatment, selected variant, exact schedule, protocol snapshot/digest, complete frozen repository/workspace inventory, sessions, trace, and sandbox identity.

**Rationale**: These fields are the minimum needed to prove which treatment ran and to select the correct frozen inputs for overlap and manual evaluation.

**Alternatives considered**: Deriving all fields from directory names was rejected as fragile. Recording only condition without topology was rejected because isolated evaluation could mount the wrong repository. A replay/event-sourcing system was rejected as unnecessary.

## Variant-Safe Observation And Evaluation

**Decision**: Resolve stationary/re-key selection from the persisted condition in run, overlap, and evaluation. Scan isolated repositories independently. The checker cleanly executes only the current assigned `origin/main:solver.py`; final evaluation cleanly executes the selected frozen origin's captured `main:solver.py`.

**Rationale**: The current re-key hard-coding would make stationary conditions inconsistent. Exact-commit checking aligns feedback with the submitted artifact, and selected-origin evaluation preserves model work without post-hoc synthesis.

**Alternatives considered**: Merging isolated repositories after freeze was rejected because it fabricates a collaboration channel. Scoring all workspaces and choosing automatically was rejected as behavioral-review automation.

## Transitional Configuration

**Decision**: Keep schema v1 only for F014 provider/model/run assignments, remove configurable timing, and require one canonical `--condition` for run, experiment, and offline commands. Feature 015 replaces this shape entirely.

**Rationale**: F014 needs an operator path to exercise a condition but should not prematurely implement the frozen five-block protocol.

**Alternatives considered**: Adding conditions to the `runs` array was rejected because Feature 015 replaces that array. Preserving arbitrary timing was rejected because it would undermine prompt and trace parity.
