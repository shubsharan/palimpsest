# Roadmap

## Direction

Palimpsest develops only what is needed to ask and evaluate word-substitution puzzle questions. The active architecture is the direct flow `ExperimentManifest -> FixturePackage -> RunRecord`; historical feature machinery remains available through Git history rather than the working tree.

## Lean Experiment Engine

### Flexible Fixtures

- Declare only source, agent count, release geometry, and an optional re-key boundary on each named run.
- Derive agent IDs, source windows, construction randomness, allocation policy, package identity, and paths.
- Prepare immutable packages with deterministic agent-visible evidence, trusted oracle data, provenance, manipulation checks, and scoring inputs.
- Verify 2-agent/3-stage, 3-agent/6-stage, and 4-agent/8-stage fixtures without source changes.

Done means repeated preparation is byte-stable, trusted data stays hidden, and new fixture geometry needs only declarations and corpus inputs.

### Explicit Experiments

- Declare concrete named runs with one model, communication mode, schedule, optional token limit, and one spend ceiling.
- Execute runs sequentially and agents within a run concurrently.
- Preserve shared ordinary Git and an optional team room, or isolated usable private Git, without prescribing model workflow.
- Stop on failure without retry, replacement, phase, reservation, or resume machinery.

Done means two manifests can vary fixtures, geometry, schedules, models, and communication without runner edits, and every invalid or unauthorized path stops before provider access.

### Complete Evidence

- Publish one secret-free `RunRecord` plus an append-only behavioral trace.
- Freeze and evaluate the one shared origin or every isolated agent origin; retain missing publication and integration as outcomes.
- Permit provider-free re-evaluation and optional post-publication overlap analysis without changing frozen evidence or scores.

Done means a reviewer can reconstruct the declared conditions, inspect the observed behavior, and reproduce scoring from the frozen record without a live provider session.

### Research Validation

- Keep ordinary development checks fast and advisory.
- Immediately before paid or findings-bearing execution, validate the exact manifest and fixture packages, probe the sandbox, complete the provider-free smoke path, and require explicit spend authorization.
- Retain the resolved fixture, configuration, sandbox, and validation identities with the run rather than maintaining a repository-wide preflight receipt.

Done means no provider request can occur on invalid, drifted, sandbox-failing, or unauthorized inputs.

## Boundaries

Palimpsest remains a local word-substitution research environment. It adds no hosted service, database, account system, arbitrary puzzle plugin framework, automatic statistical conclusions, workflow roles, checkpoints, consensus, or hidden recovery system.

The historical five-fixture, twenty-run design remains a checked-in example expressed through the lean declarations. It is a preset, not the runner architecture or the only valid experiment.

Palimpsest claims controlled opportunities and recorded outcomes only. It does not claim deterministic live behavior, guaranteed collaboration, belief revision, causal effects from one run, construct validity, adversarial security, or general benchmark status.
