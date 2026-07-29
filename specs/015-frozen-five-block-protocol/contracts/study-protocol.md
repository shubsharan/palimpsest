# Contract: Frozen Study Protocol

## Configuration

`loadStudyManifest(path)` returns one strict schema-version-2 manifest or throws a path-specific validation error. It never accepts schema version 1, `runs`, aliases, unknown fields, literal secrets, alternate schedules, alternate block/order matrices, or partial assignments.

`resolveStudy(manifest, repositoryRoot)` resolves registered blocks, validates rubric bytes, computes manifest identities, and returns the exact calibration and validation cells without reading credentials.

`initializeStudyPhase({ phase: "validation", ... })` accepts changes only to:

- `budgets.tokenBudgetPerAgent`
- `budgets.perAttemptMonetaryCeilingCents`

It returns a deterministic adjustment record and rejects any immutable drift or ceiling overflow.

## Design Preparation

`prepareStudyDesign({ study, studyRoot, ... })`:

1. refuses an existing or partial study root that cannot be validated;
2. constructs and validates all five registered paired builds;
3. reads the rubric and prompt templates;
4. verifies all twenty primary authorizations fit total ceilings;
5. exclusively publishes strict `design.json`;
6. returns the decoded receipt.

No provider credential, adapter, or session is touched before step 5 completes.

## Phase Expansion

`expandPhase(study, "calibration")` returns four cells for `calibration-theron-ware` in `CS CR IR IS`.

`expandPhase(study, "validation")` returns sixteen cells by pairing the four validation blocks with:

- `CS CR IR IS`
- `CR IS CS IR`
- `IS IR CR CS`
- `IR CS IS CR`

Cell IDs and positions are deterministic.

## Phase Execution

`executeStudyPhase(options)`:

1. validates the receipt, build bindings, phase prerequisites, and current manifest;
2. reads or initializes strict `phase.json`;
3. rejects an unresolved reservation or unremediated eligible failure;
4. selects the next unstarted cell;
5. verifies remaining token and monetary authorization;
6. verifies provider preflight when adapters are not injected;
7. writes a launch reservation;
8. executes exactly one attempt with three concurrent sessions;
9. indexes the strict durable attempt and resolves the reservation;
10. stops nonzero on eligible infrastructure classification, otherwise continues sequentially.

Reinvocation never launches an indexed primary cell.

## Explicit Replacement

`executeStudyPhase({ replaceAttemptId: sourceAttemptId, ... })` validates the frozen cited source before reserving any work. It rejects model outcomes, missing/non-frozen/other-phase/successful/already-replaced attempts and ceiling overflow. It appends exactly one attempt with inherited treatment/design/budgets and `replacementOfAttemptId`.

There is no automatic retry API.

## Prompt Parity

For a given agent and token budget:

- `CS` prompt bytes equal `CR`.
- `IS` prompt bytes equal `IR`.
- Removing the one communication paragraph makes shared and isolated prompt bytes equal.
- Block, phase, order, receipt, rubric, ceilings, lineage, and other cells never appear.

The design receipt binds the template with a token placeholder and the baseline resolved snapshots.

## CLI

```text
pnpm puzzle:build -- --block <block-id> --output <build-root>
pnpm puzzle:run -- --config experiments/config.yaml --build <build-root> --condition <CS|CR|IS|IR> --attempt-root <path>
pnpm puzzle:experiment -- --config experiments/config.yaml --phase <calibration|validation> --study-root <path>
pnpm puzzle:experiment -- --config experiments/config.yaml --phase <calibration|validation> --study-root <path> --replace <attempt-id>
```

`puzzle:evaluate` remains an explicit attempt-level command. Phase completion does not invoke it.
