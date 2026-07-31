# Contract: Published Runnability and Coverage

Identifier: `published-runnability-coverage-v1`

## Input

`check_published_solver` accepts no arguments. The trusted runner supplies only the caller's assigned origin, literal `refs/heads/main`, ciphertext assembled from one frozen ordered view of released stages, canonical `python3 solver.py`, canonical `reconstruction.txt`, the solver sandbox, and the deadline.

The checker receives no build root, oracle directory, plaintext, key, score hook, peer origin, workspace sibling, alternate command, or alternate output path.

## Successful Result

```json
{
  "feedbackId": "published-runnability-coverage-v1",
  "ref": "refs/heads/main",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "executionStatus": "succeeded",
  "outputValidity": "valid",
  "ciphertextWords": 1200,
  "outputWords": 1200,
  "coverage": 1
}
```

Correct and incorrect candidate text with the same normalized word count and execution behavior produces identical non-commit fields.

## Terminal Submission Results

- unavailable published `main`
- execution failure
- timeout
- indeterminate execution
- output overflow
- missing output
- empty output
- malformed output
- incomplete output

Each result preserves any captured ref/commit and exposes only submission state, word counts available without oracle access, bounded coverage, and a stable error category.

## Trace

The trace retains the tool call, elapsed time, actor, and complete returned blind result. Repeated calls are neither blocked nor reclassified.
