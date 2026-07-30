# Published Solver Contract

## Submission Selection

- The caller or reviewer selects one condition-assigned repository through a canonical agent workspace.
- One complete host operation initializes a fresh temporary repository, fetches only literal `refs/heads/main` into a private local ref, resolves that pinned ref, checks it out, removes Git metadata, executes and evaluates the solver, removes the snapshot, and only then returns the resulting 40-character commit and typed outcome.
- Symbolic `HEAD`, worktree state, remote-tracking refs, tags, and other branches never select submitted code.
- Capture and solver execution share one abort signal and absolute deadline. A later branch update or unrelated force-push cannot change the already materialized snapshot.

## Materialization

- The complete captured commit tree is exported into a new host-owned temporary root outside all agent workspaces.
- The exported tree contains no Git metadata and is mounted read-only.
- A missing or invalid main commit fails explicitly before submitted code executes.
- The snapshot never escapes the operation and is removed whether capture, execution, trusted evaluation, or cleanup succeeds or fails.

## Released Checker Input

- Stage publication appends one ordered host-owned record containing the ordinal, sealed build source path, and agent-visible copied path.
- Checker input reads only the sealed source paths in those records; it never discovers stages by rescanning the agent-visible evidence directory.
- Every stage source ends in `\n`; canonical assembly inserts exactly one additional `\n` between adjacent stages. Python checker truth uses the same rule.

## Execution

- The canonical command is `python3 solver.py`.
- The submission root is the working directory.
- `$PALIMPSEST_CIPHERTEXT` names one read-only assigned ciphertext file.
- `$PALIMPSEST_OUTPUT` names `reconstruction.txt` inside one fresh 16 MiB container tmpfs at `/output`.
- No writable host path is mounted. After exit, the host extracts only the declared output to hidden staging, validates it, and atomically publishes a valid regular file.
- No Git origin, agent workspace, private evidence, reference corpus, oracle tree, host sibling, network, secret, or provider credential is exposed.
- Existing CPU, memory, process, time, output-capture, read-only-root, and bounded temporary-filesystem limits remain in force; the output quota applies while solver code is running.
- Missing main, unavailable submission objects, solver exit, timeout, and invalid output are explicit submission outcomes. Host-process, trusted evaluator, sandbox, mount, cleanup, and cancellation failures propagate as infrastructure failures.

## Output

- The candidate must exist after successful command execution.
- Its resolved path must remain inside the dedicated output directory.
- It must be a non-empty regular file no larger than 16 MiB.
- Invalid output is never passed to checker or final scorer.

## Records

- Checker feedback includes the captured commit and aggregate visible-evidence metrics or an explicit failure, and is returned only after capture cleanup.
- Final evaluation selection records may durably bind captured provenance before execution; completion and result records are published only after solver execution, trusted scoring, and capture cleanup. They include reviewer workspace, assigned repository, `refs/heads/main`, captured commit, canonical command/output, execution result, and score or explicit submission failure.
