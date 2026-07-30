# Data Model: Frozen Five-Block Protocol

## Study Manifest

Strict schema version 2.

- `blocks`: exactly five `{blockId, phase}` entries in registered order.
- `assignment`: exactly three ordered `{agentId, modelProfileId}` entries.
- `providers`, `models`: current direct provider/model declarations with environment-variable references, never literal credentials.
- `schedule`: exact release offsets and cutoff.
- `budgets`: per-agent tokens, per-attempt authorization cents, total tokens, total authorization cents.
- `orders`: calibration sequence and four validation sequences.
- `scoring`: deterministic metric ID and explicit reviewer-selection ID.
- `rubric`: versioned ID, repository path, SHA-256 digest.
- `adjustableFields`: exactly the two permitted budget paths.
- `failurePolicy`: stop, no automatic retry, explicit appended replacement, one eligible classification.

Unknown, missing, duplicate, reordered, secret-bearing, or unsupported values are invalid.

## Resolved Study

Credential-free value object derived from the manifest.

- Registered block metadata and absolute build inputs.
- Fixed `AgentModelAssignment`.
- Exact schedule and budget values.
- `calibrationCells`: four ordered cells.
- `validationCells`: sixteen ordered cells.
- `manifestDigest`.
- `immutableManifestDigest`.

`ResolvedStudy` does not hold provider credentials or adapters.

## Design Receipt

Strict schema version 1, exclusively created at `<study-root>/design.json`.

- `createdAt`, `sourceRevision`, `sandboxIdentity`.
- `manifestDigest`, `immutableManifestDigest`, `designDigest`.
- Immutable manifest snapshot.
- Five build bindings with block, variant/build identities, raw build-manifest digest, canonical complete-tree seal, and seed/allocation/manipulation metadata.
- Model assignment and orders.
- Rubric bytes digest.
- Scoring/reviewer boundary.
- Prompt templates and baseline prompt snapshots.
- Failure rules and total ceilings.

Once published, the receipt is never overwritten.

## Planned Cell

- `cellId`: deterministic `<phase>-<position>-<block>-<condition>`.
- `phase`: `calibration` or `validation`.
- `blockId`.
- `condition`: `CS | CR | IS | IR`.
- `conditionOrderPosition`: one-based within its block order.
- `phasePosition`: one-based within the complete phase.
- `buildBinding`.

## Launch Reservation

- `reservationId`, `cellId`, `reservedAt`.
- `kind`: `primary | replacement`.
- optional `replacementOfAttemptId`.
- full token and monetary authorization.
- `state`: `reserved | resolved`.
- optional resolved `attemptId`.

A `reserved` entry is terminally unresolved for automatic resume.

## Attempt Summary

Strict schema version 4.

- Existing Feature 014 treatment, schedule, sessions, traces, native frozen Git, sandbox, overlap, evaluation, and score fields.
- `buildTreeSeal`: canonical identity of the complete selected build root.
- `frozen.treeSeal`: canonical identity of the complete frozen repository/workspace root.
- `studyPhase`: `standalone | calibration | validation`.
- `studyRootId`, `conditionOrderPosition`, and `designDigest`, required for calibration, validation, and replacement attempts and absent for standalone attempts.
- `monetaryAuthorizationCeilingCents`.
- `infrastructureClassification`: `none | session-infrastructure-error`.
- optional `replacementOfAttemptId`.

Obsolete `runName` and `repetition` fields are removed. Standalone `puzzle:run` uses `studyPhase: standalone`, the same assignment and protocol snapshot, and no study-receipt identity.

## Tree Seal

Strict schema version 1.

- `digest`: SHA-256 identity of sorted canonical tree entries.
- `fileCount`, `byteCount`: redundant totals checked with the digest.
- Entries cover every relative directory, regular-file byte length/hash/executable bit, and symbolic-link target.

The entry list is intentionally not duplicated into receipts. The compact seal binds the complete published directory while semantic manifests continue to describe its protocol meaning.

## Phase Summary

Strict schema version 1 at `<study-root>/<phase>/phase.json`.

- `phase`, `state`: `ready | running | blocked | complete`.
- Manifest, immutable-manifest, and design digests.
- Ordered planned cells.
- Adjustments with field path, prior/resolved values, and prior/current manifest digests.
- Launch reservations.
- Durable attempt references and replacement lineage.
- Cumulative authorized tokens and cents.
- Cumulative actual token usage.
- Optional failure record.

Transitions:

1. Calibration: absent -> receipt published -> `ready`.
2. Validation: absent -> calibration complete and adjustment validation -> `ready`.
3. `ready|running` -> reservation -> `running`.
4. durable successful attempt -> reservation resolved -> next cell or `complete`.
5. durable eligible infrastructure attempt -> reservation resolved -> `blocked`.
6. successful explicit replacement -> `running` or `complete`.
7. unresolved reservation -> remains blocked in the same study root.

## Replacement

A replacement is an ordinary schema-version-4 attempt with immutable inherited treatment/design fields and `replacementOfAttemptId`.

It is valid only when the source:

- is present in the selected phase index;
- is strict and frozen;
- has `session-infrastructure-error`;
- has no prior replacement;
- matches the cell and design;
- and the next authorization fits remaining ceilings.
