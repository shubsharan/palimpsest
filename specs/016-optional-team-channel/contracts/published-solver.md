# Published Solver Contract

## Submission Selection

- The caller or reviewer selects one condition-assigned repository through a canonical agent workspace.
- The trusted host resolves only `refs/heads/main^{commit}` and records the resulting 40-character commit.
- Symbolic `HEAD`, worktree state, remote-tracking refs, tags, and other branches never select submitted code.

## Materialization

- The complete captured commit tree is exported into a new host-owned temporary root outside all agent workspaces.
- The exported tree contains no Git metadata and is mounted read-only.
- A missing or invalid main commit fails explicitly before submitted code executes.

## Execution

- The canonical command is `python3 solver.py`.
- The submission root is the working directory.
- `$PALIMPSEST_CIPHERTEXT` names one read-only assigned ciphertext file.
- `$PALIMPSEST_OUTPUT` names `reconstruction.txt` inside one fresh writable output directory.
- No Git origin, agent workspace, private evidence, reference corpus, oracle tree, host sibling, network, secret, or provider credential is exposed.
- Existing CPU, memory, process, time, output-capture, read-only-root, and bounded temporary-filesystem limits remain in force.

## Output

- The candidate must exist after successful command execution.
- Its resolved path must remain inside the dedicated output directory.
- It must be a non-empty regular file no larger than 16 MiB.
- Invalid output is never passed to checker or final scorer.

## Records

- Checker feedback includes the captured commit and aggregate visible-evidence metrics or an explicit failure.
- Final evaluation selection/result records include reviewer workspace, assigned repository, `refs/heads/main`, captured commit, canonical command/output, execution result, and score or explicit failure.
