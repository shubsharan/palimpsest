# Published Solver Contract

## Submission Selection

- The caller or reviewer selects one condition-assigned repository through a canonical agent workspace.
- One callback-scoped host transaction initializes a fresh temporary repository, fetches only literal `refs/heads/main` into a private local ref, resolves that pinned ref, checks it out, removes Git metadata, and only then exposes the resulting 40-character commit and snapshot path to its callback.
- Symbolic `HEAD`, worktree state, remote-tracking refs, tags, and other branches never select submitted code.
- Capture and solver execution share one abort signal and absolute deadline. A later branch update or unrelated force-push cannot change the already materialized snapshot.

## Materialization

- The complete captured commit tree is exported into a new host-owned temporary root outside all agent workspaces.
- The exported tree contains no Git metadata and is mounted read-only.
- A missing or invalid main commit fails explicitly before submitted code executes.
- The snapshot exists only for the callback and is removed when the callback completes or fails.

## Released Checker Input

- Stage publication appends one ordered host-owned record containing the ordinal, sealed build source path, and agent-visible copied path.
- Checker input reads only the sealed source paths in those records; it never discovers stages by rescanning the agent-visible evidence directory.
- Every stage source ends in `\n`; canonical assembly inserts exactly one additional `\n` between adjacent stages. Python checker truth uses the same rule.

## Execution

- The canonical command is `python3 solver.py`.
- The submission root is the working directory.
- `$PALIMPSEST_CIPHERTEXT` names one read-only assigned ciphertext file.
- `$PALIMPSEST_OUTPUT` names `reconstruction.txt` inside one fresh writable output directory.
- No Git origin, agent workspace, private evidence, reference corpus, oracle tree, host sibling, network, secret, or provider credential is exposed.
- Existing CPU, memory, process, time, output-capture, read-only-root, and bounded temporary-filesystem limits remain in force.
- Missing main, unavailable submission objects, solver exit, timeout, and invalid output are explicit submission outcomes. Host-process, sandbox, mount, cleanup, and cancellation failures propagate as infrastructure failures.

## Output

- The candidate must exist after successful command execution.
- Its resolved path must remain inside the dedicated output directory.
- It must be a non-empty regular file no larger than 16 MiB.
- Invalid output is never passed to checker or final scorer.

## Records

- Checker feedback includes the captured commit and aggregate visible-evidence metrics or an explicit failure.
- Final evaluation selection/result records include reviewer workspace, assigned repository, `refs/heads/main`, captured commit, canonical command/output, execution result, and score or explicit failure.
