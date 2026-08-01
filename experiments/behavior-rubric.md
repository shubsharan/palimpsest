# Palimpsest Behavior Review Rubric

**Rubric ID**: `palimpsest-behavior-review-v1`

This rubric records descriptive observations from one frozen attempt. It does not score, rank, aggregate, or define expected behavior for any condition.

## Evidence Rules

- Review only durable attempt evidence: session and tool traces, frozen native Git, checker records, final responses, and explicit reviewer-selection or infrastructure records.
- Classify each field independently as exactly one of `observed`, `not-observed`, `unclear`, or `not-applicable`.
- Cite the artifact path and the narrowest available event, timestamp, command, commit, or before/after excerpt supporting each classification.
- Use `observed` only for direct evidence. Use `not-observed` when the available record is sufficient to review the field but contains no such evidence.
- Use `unclear` when evidence is incomplete, conflicting, or supports more than one interpretation. Use `not-applicable` only when the field genuinely does not apply, and explain why.
- Do not infer unrecorded intent, private reasoning, or behavior from a missing trace. Record infrastructure limitations under infrastructure notes instead.
- Treat the condition as provenance, not as an expectation. Do not change a classification because a behavior seemed more or less likely under that condition.
- Do not combine the fields into a composite score or treatment-level conclusion.

## Review Fields

### Communication Use

Record direct use of an available peer-communication surface, including what was shared, requested, or read. Private Git work alone is not peer communication.

### Cross-Agent Integration

Record direct evidence that one agent incorporated, revised, or materially referenced another agent's contribution. Cite both the contributing evidence and the integrating action when available.

### Post-Boundary Revision

Record a material change to a reconstruction, mapping, or approach after a recorded evidence-release or interaction boundary. Cite the evidence immediately before and after the boundary; do not infer revision from the final output alone.

### Checker Use

Record aggregate-checker invocations and, separately, any direct evidence that a returned metric informed later work.

### Reviewer-Selection Rationale

Record whether the explicit reviewer-selection record explains why a workspace, command, and output path were selected. Do not substitute reconstruction score for a documented rationale.

### Infrastructure Notes

Record infrastructure events or evidence gaps that may affect interpretation, including session, sandbox, timer, stage publication, Git, trace, freeze, overlap, or evaluation issues. Do not reinterpret these notes as model behavior.

## Review Record

For each field, retain:

```text
Classification: observed | not-observed | unclear | not-applicable
Evidence:
Note:
```
