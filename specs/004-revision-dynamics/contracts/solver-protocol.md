# Gate C Solver Protocol

## Solver-visible Inputs

At start, the solver receives:

- a statement that chapters will arrive on a fixed wall-clock schedule;
- the mapping and checkpoint file formats;
- the total number of reveal slots and nominal interval;
- permission to use Python in one Code Interpreter container;
- the currently released ciphertext chapter files;
- its own prior responses and files.

The solver is not told whether or where a key change exists.

## Prohibited Inputs and Capabilities

The solver receives no:

- source title, author, source URL, plaintext, entity regeneration map, or source hash;
- stationary or revised key, changed set, matched controls, switch boundary, contradiction threshold, or seed;
- unreleased chapter filenames, metadata, digests, or token counts;
- network access, API key, repository checkout, trusted Python package, host filesystem, or operator control surface.

Source recognition or evidence of an undeclared external lookup invalidates the attempt.

## Per-release Exchange

For each reveal slot, the trusted runner:

1. Durably records the reveal event.
2. Uploads the newly released complete chapter files to the existing container.
3. Sends a continuation request using the previous response ID.
4. Streams public response events and tool summaries to the local `live.jsonl`.
5. Downloads declared solver-created files while the container is active.
6. Validates and stores the structured checkpoint.

The prompt asks the solver to inspect all available evidence, continue its executable analysis, preserve useful prior mappings unless contradicted, and publish the required checkpoint. It does not mention the oracle threshold or suggest that a switch has occurred.

Each response has a frozen 110-second timeout, shorter than the two-minute reveal interval. A valid attempt therefore finishes each checkpoint before the next scheduled release. The reveal runner uses absolute monotonic offsets, zero early-release tolerance, and 1,000 milliseconds of retryable scheduler lateness. Any response timeout or reveal outside that window terminates the attempt without a solver result; the frozen retry count is zero.

## Checkpoint Requirements

Every checkpoint contains:

- active, retracted, and superseded mappings in deterministic order;
- confidence and revealed-chapter provenance for each mapping;
- zero or more switch hypotheses with boundary interval, confidence, and public evidence;
- reconstruction artifact references;
- public rationales and exact references to downloaded solver-created files;
- API usage and response-chain identifiers.

The runner rejects malformed checkpoints. It does not repair, infer, or translate solver claims.

## Observable Work

`live.jsonl` stores timestamped public API events, tool-call lifecycle events, code outputs, upload and download receipts, reveal releases, and checkpoint acceptance as they occur. This gives the operator a durable real-time activity record. It is evidence of observable work, not a private reasoning transcript.

## Failure Semantics

- Incorrect mappings, premature alarms, missed detection, and wholesale restart are solver outcomes.
- The frozen retry policy permits zero retries; an API or response-timeout failure seals that attempt as failed.
- Container expiry, quota exhaustion before the first release, malformed API output, or trusted runner failure yields no solver result.
- Oracle leakage, future-evidence leakage, wrong model, network access, or response-chain ambiguity invalidates the attempt.
