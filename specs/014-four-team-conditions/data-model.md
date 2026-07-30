# Data Model: Four Team Conditions

## Condition

- `id`: exactly `CS`, `CR`, `IS`, or `IR`
- `communicationMode`: derived `shared` or `isolated`
- `keyRegime`: derived `stationary` or `rekey`

Validation: only `id` is accepted as input. Derived fields must equal the canonical table whenever serialized.

## Release Schedule

- `releaseOffsetsMs`: exactly `[0, 300000, 600000, 1200000, 1800000, 2400000]`
- `cutoffMs`: exactly `3600000`

Validation: six strictly increasing safe integers, first offset zero, final offset before cutoff, and exact equality to the F014 constants.

## Git Repository

- `repositoryId`: `shared` in shared mode or the owning canonical agent ID in isolated mode
- `path`: absolute host path
- `agentIds`: one or three canonical agents assigned to this repository

Validation: shared mode contains one repository assigned to all three agents. Isolated mode contains three repositories, each assigned to exactly its matching agent.

## Agent Workspace

- `agentId`: canonical agent ID
- `path`: absolute host path
- `repositoryId`: assigned repository

Validation: exactly one workspace per declared agent and exactly one resolvable repository assignment.

## Git Environment

- `root`: absolute active or frozen root
- `communicationMode`: derived from condition
- `repositories`: complete repository inventory
- `workspaces`: complete workspace inventory
- `frozen`: present and true only after immutable copy

State transition: absent -> active topology -> frozen copy. Freeze does not merge, rewrite, or select work.

## Protocol Snapshot

- `schemaVersion`: `1`
- `blockId`
- `condition`
- derived `communicationMode`
- derived `keyRegime`
- selected `variantId` and `buildId`
- exact release offsets and cutoff
- token budget per agent
- three ordered non-secret model bindings
- three ordered prompt texts
- sandbox identity

Identity: `protocolDigest` is the SHA-256 of the fixed-order secret-free snapshot bytes. The full snapshot is retained with the attempt.

## Condition Attempt

- existing attempt and build identifiers, run name, and repetition
- `blockId`, `condition`, derived treatment, and selected variant
- release schedule, token budget, and protocol snapshot/digest
- three ordered session records
- trace and trace-metadata paths
- frozen Git environment
- sandbox identity and policy

Validation: schema version 3; exactly three canonical agents; condition-derived variant build ID matches the paired manifest; topology matches communication mode; protocol digest matches the retained snapshot; session order matches agent order.

## Overlap Observation

- existing findings
- additive scan counters across all repositories
- isolated committed paths prefixed by owning agent ID

Validation: each physical repository is scanned once; shared repository is not triple-counted; findings remain non-blocking and score-independent.

## Manual Evaluation

- explicit selected `agentId`
- selected frozen workspace
- selected assigned frozen repository
- canonical `python3 solver.py` command and `reconstruction.txt` output path
- optional notes, execution, and score

Validation: the workspace and repository must be the exact pair recorded for the selected agent. No repository merge, automatic workspace selection, or reviewer-selected command occurs.
