# Grading configuration

This directory contains operator-owned, versioned inputs for post-run grading. The default `epistemic-process-v1.yaml` selects one frozen rubric and two reviewer profiles from distinct official provider drivers. It contains model names and per-reviewer authorization ceilings, but never credentials, run labels, outcome data, generated prompts, analysis IDs, or output paths.

Provider-free grading may use this file without reading credentials. Qualitative review derives the official provider credential environment (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) only after the exact run, evidence bundle, reviewer distinction, and literal `--allow-spend true` have been validated. A ceiling bounds authorization; it is not a billing guarantee or permission to retry.

Changes to the rubric, profiles, models, or ceilings change the configuration digest. Keep old configuration files when analyses still reference them; grading artifacts are immutable and must not be reinterpreted under a newer configuration.

`calibration/` is provider-free synthetic calibration material. It can verify citation and mechanical behavior, but does not establish construct validity or authorize findings-bearing use.
