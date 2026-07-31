# Research: Configurable Run Controls

## Decision: Freeze resolved values, not accepted values

**Rationale**: A research result must retain the exact controls that governed it, but different runs must be allowed to select different safe controls. The existing manifest digest, protocol digest, receipt, reservation, trace, and attempt boundaries already provide the right per-run freezing points.

**Alternatives considered**:

- Compile-time schedule constants: rejected because manifest fields become decorative and every experiment requires source changes.
- Unvalidated arbitrary values: rejected because malformed schedules can strand releases or create ambiguous termination.
- Named clock presets only: rejected because presets merely move hard-coding and still require repository changes for new experiments.

## Decision: Use explicit nullable token policy

**Rationale**: `tokenBudgetPerAgent: null` says unambiguously that usage is observed but does not terminate the session. A positive integer preserves the existing token-exhaustion behavior. Matching nullable total authorization keeps study accounting honest.

**Alternatives considered**:

- Remove token controls globally: rejected because some runs need a token safety/opportunity bound.
- A sentinel integer such as zero: rejected because it conflates invalid budget values with disabled policy.
- Omit the field: rejected because missing configuration is ambiguous.

## Decision: Validate schedule relationships at each trust boundary

**Rationale**: JSON Schema can enforce safe integer shape and six entries. TypeScript resolution and artifact decoders must enforce first-zero, strictly-increasing, final-release-before-cutoff, and build-stage-count relationships. Repeating these small checks protects reload and direct run APIs.

**Alternatives considered**:

- Schema-only validation: rejected because cross-field ordering and build relationships are clearer in code.
- One validation during YAML parsing: rejected because stored artifacts and direct internal APIs are separate trust boundaries.

## Decision: Reapply only generic Feature 018 observability

**Rationale**: Exact returned reasoning-summary evidence is independent of the hour experiment and useful for every compatible run. The implementation keeps a small safe subset and discards the raw response body.

**Alternatives considered**:

- Merge the full Feature 018 branch: rejected because it globally hard-codes one clock and removes configurable token policy.
- Retain full response bodies: rejected because they add hidden/encrypted reasoning, unrelated content, and unnecessary sensitive surface.

## Decision: Do not run a paid experiment for this feature

**Rationale**: Provider-free tests can prove configuration resolution, clock and token enforcement, evidence propagation, and artifact consistency. A future paid run must use its chosen manifest and a fresh clean receipt-bound preflight; it is not proof that the abstraction itself is configurable.

**Alternatives considered**:

- Repeat the one-hour live run: rejected as unnecessary spend and as a return to treating one configuration as the feature.
