# Palimpsest Behavior Review Rubric

**Rubric ID**: `palimpsest-behavior-review-v1`

`behavior-evidence.json` contains mechanical facts copied or referenced from the frozen attempt, trace, and evaluation. Those facts are not behavioral conclusions. A human reviewer applies this rubric later and cites the specific durable facts supporting each interpretation.

## Review Rules

- Use only durable attempt artifacts and trace events.
- Distinguish `observed`, `not-observed`, `unclear`, and `not-applicable`.
- Cite the narrowest event, commit, output, or artifact reference supporting the judgment.
- Do not infer intent or hidden reasoning from missing evidence.
- Treat condition, model usage, checker calls, Git activity, and returned reasoning-summary presence as context, not outcomes.
- Do not combine fields into a score or treatment conclusion.

## Human Interpretation Fields

### Integration

Did an agent incorporate, revise, or materially use another agent's contribution? Cite both the contribution and the integrating action when available.

### Interference

Did peer activity overwrite, obstruct, distract from, or degrade useful work? Separate direct evidence from coincident timing.

### Recovery

Did the team or an agent identify and recover from an error, conflict, or failed approach? Cite the failure evidence and subsequent change.

### Belief Replacement

Did later evidence cause an agent to replace a substantive reconstruction hypothesis or strategy? Do not infer this from final output alone.

### Source Recognition

Did an agent identify the source text or exploit source familiarity? Distinguish explicit recognition from generic linguistic inference.

## Review Record

```text
Classification: observed | not-observed | unclear | not-applicable
Evidence:
Note:
```
