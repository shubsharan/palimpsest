# Feature Specification: Decipherment Headroom

| Field          | Value                                                 |
| -------------- | ----------------------------------------------------- |
| Feature branch | `003-decipherment-headroom`                           |
| Created        | 2026-07-26                                            |
| Status         | Qualified feasibility pass                            |
| Input          | Roadmap Milestone 3: "Decipherment headroom (Gate B)" |

## Decision

Gate B answers the product question needed before partial re-keying: meaningful semantic headroom exists above the tested mechanical attack.

On the unrecognized-literary Amber instance, a frontier model made semantic mapping progress beyond the mechanical attempt without identifying the source. This establishes that the stationary puzzle exposes a useful semantic-solving signal rather than only frequency mechanics or memorized source continuation.

The observation is accepted as product feasibility evidence. It is not a publication-grade or replayable Gate B result because the original judged artifacts were cleared during the later corpus reset and the expanded replication protocol was not completed.

## User Scenarios & Testing

### User Story 1 - Decide whether semantic solving exists (Priority: P1)

A product maintainer needs to know whether a capable semantic solver can improve on a mechanical substitution attack without relying on source recognition.

**Independent Test**: Compare the mechanical attempt with the observed Amber solver work and determine whether the latter contains additional coherent semantic mappings while remaining source-unrecognized.

**Acceptance Scenarios**:

1. **Given** a stationary unrecognized-literary cipher and a mechanical attempt, **When** a capable solver develops coherent mappings not present in the mechanical output, **Then** semantic headroom is observed.
2. **Given** the same solver work, **When** source-recognition claims are reviewed, **Then** the headroom claim is accepted only if it did not depend on identifying or copying the source.

### User Story 2 - Preserve the limit of the claim (Priority: P2)

A reviewer needs the repository to distinguish a product go/no-go decision from a broader empirical claim.

**Independent Test**: Read the Gate B decision and verify that it authorizes only the minimum Gate C experiment while deferring non-literary generalization, human comparison, multi-instance replication, and publication-grade replay.

**Acceptance Scenarios**:

1. **Given** the qualified pass, **When** a reviewer inspects its limitations, **Then** no claim is made about non-literary corpora, average human performance, model-population performance, or formal replication.
2. **Given** the missing original judged artifacts, **When** the decision is recorded, **Then** it is not represented as a completed version 1 gate report.

### Edge Cases

- Source recognition may help a solver, as observed on Birch, but that does not establish semantic decipherment headroom.
- A later replication may fail on non-literary material without invalidating the narrower observation that semantic headroom exists on the retained literary profile.
- A future change to the stationary profile may invalidate its use as the starting point for Gate C.

## Evidence & Trust Boundaries

**Owning Gate/Milestone**: Roadmap Milestone 3, Gate B.

**Minimum Scope**: One unrecognized-literary stationary instance, one mechanical comparator, and one capable semantic solver observation are sufficient for the product decision to test revision dynamics next.

**Accepted Evidence**: The maintainer-observed Amber comparison established semantic mapping progress beyond mechanics without source recognition. The evidence is an operator-accepted observation; its original judged outputs are not present in the canonical repository.

**Trust & Visibility Impact**: Gate B retains the stationary public/private/oracle separation. The qualified decision exposes no source identity, plaintext, key, seed, entity map, or oracle.

**Failure Classification**: Missing replay artifacts limit the claim but do not turn the product observation into an infrastructure pass. Any publication-grade claim remains unsupported until a new predeclared replication is run.

**Invalidation Path**: A change to the literary stationary profile used by Gate C requires rechecking semantic headroom. Gate C failure does not retroactively erase the stationary headroom observation; it rejects the revision mechanic.

## Requirements

### Functional Requirements

- **FR-001**: The repository MUST record Gate B as a qualified product-feasibility pass, not as a completed publication-grade gate report.
- **FR-002**: The decision MUST state that semantic mapping progress exceeded the tested mechanical attempt on unrecognized-literary material.
- **FR-003**: The decision MUST state that source recognition did not produce the accepted Amber progress.
- **FR-004**: The decision MUST authorize only the minimum Gate C revision-dynamics experiment.
- **FR-005**: Non-literary generalization, human comparison, three-role replication, full identification coverage, and publication-grade replay MUST be explicitly deferred.
- **FR-006**: The full harness and Gate D MUST remain unauthorized.

### Key Entities

- **Qualified Feasibility Decision**: The bounded product decision, its accepted observation, claim limits, and downstream authorization.
- **Retained Literary Profile**: The stationary unrecognized-literary puzzle geometry carried into the minimum Gate C experiment.
- **Deferred Replication**: Optional future work required only for broader or publication-grade claims.

## Success Criteria

### Measurable Outcomes

- **SC-001**: The repository contains exactly one current Gate B decision classification and identifies it as `qualified-pass`.
- **SC-002**: The decision authorizes Gate C and records full-harness authorization as `false`.
- **SC-003**: All five deferred claim classes are named: non-literary generalization, human comparison, three-role replication, complete identification coverage, and publication-grade replay.
- **SC-004**: No current document describes the expanded three-corpus matrix as a prerequisite for beginning Gate C.

## Assumptions

- The maintainer accepts the observed Amber run as sufficient for the product decision.
- Product feasibility and publication-grade empirical replication are separate standards.
- Gate C begins from the unrecognized-literary stationary profile rather than a generalized corpus tier.
