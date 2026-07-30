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

1. requires a clean committed source checkout before construction or receipt validation;
2. refuses any non-empty study root that has no design receipt;
3. constructs and validates all five registered paired builds without reusing unreceipted output, then seals each complete build root;
4. reads the rubric and prompt templates;
5. verifies all twenty primary authorizations fit total ceilings;
6. immediately before publication, requires the source to remain clean at the same commit;
7. exclusively publishes strict `design.json`;
8. returns the decoded receipt.

No provider credential, adapter, or session is touched before receipt publication completes. An interrupted unreceipted root is never resumed; the operator must select a new study root.

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

1. exclusively creates `<study-root>/<phase>/.execution.lock` before phase initialization and holds it for the invocation;
2. validates the receipt, complete build-tree bindings, phase prerequisites, and current manifest;
3. reads or initializes strict `phase.json`;
4. rejects an unresolved reservation or unremediated eligible failure;
5. selects the next unstarted cell;
6. verifies remaining token and monetary authorization;
7. verifies provider preflight when adapters are not injected;
8. reverifies the selected complete build-tree seal immediately before launch;
9. writes a launch reservation;
10. executes exactly one attempt with three concurrent sessions;
11. reverifies the selected build, seals the complete frozen Git/workspace root, and durably publishes the attempt;
12. indexes the strict durable attempt and resolves the reservation;
13. stops nonzero on eligible infrastructure classification, otherwise continues sequentially;
14. removes the phase lock after normal completion or handled failure.

Reinvocation never launches an indexed primary cell. Reloading an indexed attempt revalidates its complete receipt-bound protocol plus its selected-build and frozen-tree seals. A post-publication overlap failure remains in the attempt trace, but the durable non-infrastructure attempt is indexed and the same invocation continues to the next cell.

A competing or abandoned phase lock rejects execution before preflight, reservation, adapter construction, or provider work. The runner does not inspect, steal, expire, or recover locks; an abandoned lock requires a new study root.

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

`puzzle:evaluate` remains an explicit attempt-level command. It reverifies the selected-build and frozen-tree seals before consuming ciphertext, oracle truth, workspaces, or Git origins. Phase completion does not invoke it.

Tree seals provide local drift detection under a trusted-operator model. They are not signatures and do not defend against coherent rewriting of artifacts and their embedded seals.
