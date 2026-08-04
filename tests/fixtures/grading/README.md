# Grading fixtures

All checked-in grading fixtures are synthetic and provider-free. They describe observable process contrasts, expected missingness, and report-design cases; they are not model outputs or empirical findings. Keep actor IDs anonymous and omit provider/model identity, plaintext, keys, oracle data, final success labels from reviewer inputs, and any credentials.

JSON fixtures are stable contrast cases for contract and golden tests. Filesystem tests should use `tests/support/grading-fixture.ts`, which builds completed or interrupted schema-v1 run artifacts with real local Git topology but no provider or Docker dependency. Shared builders publish one canonical origin; isolated builders retain every canonical agent origin without selecting a best result.

When extending a fixture, encode unavailable and not-applicable observations explicitly rather than using zero. Preserve chronology and cite only the synthetic evidence supplied by the case.
