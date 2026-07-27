# Offline Harness Evidence Contract

## Schema Families

Version 1 defines:

- `instance-records`: build request, public instance, oracle, reference corpus, shard, released shard, difficulty, and scoring policy records;
- `run-control-records`: run manifest, agent invocation/event, Git transaction, ledger entry, published snapshot, run event, freeze snapshot, and private deliverable records;
- `grading-records`: staging, solver execution, score report, trusted replay bundle, and public report records;
- `offline-harness-report`: declaration-bound predeclared and completed decisions.

Every record ID is independently registered and validated in TypeScript and Python. Unknown fields are rejected. Contract changes require a version increment or explicit migration.

## Attempt and Promotion

The attempt path is:

`artifacts/harness/attempts/<declaration-digest>/<run-id>/`

The runner:

1. creates a fresh path;
2. writes immutable `attempt.json` before any external process, repository, or container side effect;
3. appends only declared in-progress evidence;
4. writes all deterministic grade and replay outputs;
5. atomically writes `terminal.json` last.

`terminal.json` enumerates and hashes every other attempt file. A failed attempt is sealed with its safe failure classification. No terminal attempt can be resumed, rescored, or reused. `current.json` has `evidence:false` and cannot resolve an evidence import.

## Completion Predicates

`liveModelValidationAuthorized` is true only when:

- the exact instance rebuilds byte-identically;
- TypeScript preflight accepts it without puzzle conversion;
- three isolated fixture agents complete the production lifecycle;
- real Git admission, accounting, publication, freeze, and finalization reconcile;
- private deliverables remain outside peer visibility;
- the clean solver accepts the valid non-Python fixture and the hostile matrix is rejected;
- scoring and public redaction complete;
- independent replay reproduces every trusted state and digest;
- a second attempt leaves the first byte-identical and independently replayable;
- the run records zero external model requests;
- every required verification artifact is present and hash-valid.

Any missing predicate returns `rework` with the owning Milestone 4, 5, or 6 component. Leakage, accounting disagreement, freeze mismatch, event-chain failure, undeclared output, or replay mismatch returns `invalid`.

## Failure Semantics

- Fixture-agent mistakes are scored outcomes.
- Trusted process failure before terminal promotion is retryable only in a new attempt.
- Malformed contracts, partial output, hash mismatch, wrong producer, or wrong environment promote nothing.
- Oracle, shard, credential, network, output, or repository visibility leakage invalidates the attempt.
- Ref, ledger, visibility, event, or freeze disagreement invalidates the attempt.
- Model-provider access or a non-fixture adapter invalidates the completion report.

## Replay

Replay resolves one explicit declaration digest and run ID. It ignores mutable pointers and directory order. It verifies the terminal exact output set before reading domain artifacts, reconstructs trusted state, reruns clean grading from sealed inputs, and compares canonical bytes and digests.

Replay does not claim to reproduce fixture process interleaving, operating-system scheduling, or future model behavior.

## Public Projection

The public report contains implementation status, approved aggregate scores, plots, sanitized observable events, contract and environment versions, replay identity, and the narrow authorization decision. It contains no source fingerprint, seed, prepared text, oracle mapping, future release metadata, private shard, exact private telemetry, credential, or private submission.
