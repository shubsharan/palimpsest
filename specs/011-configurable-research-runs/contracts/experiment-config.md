# Contract: Experiment Configuration

## Canonical example

```yaml
schemaVersion: 1

puzzle:
  target:
    corpus: middlemarch
    chapters:
      start: 10
      end: 15
  references:
    - jane-eyre
    - moby-dick
  seed: 17
  agentCount: 3
  stageCount: 6
  stageIntervalMs: 120000
  rekeys:
    - atStage: 4
      changedTokenMass: 0.2

limits:
  tokenBudgetPerAgent: 200000
  wallTimeMs: 3600000

providers:
  openai:
    driver: openai
    apiKeyEnv: OPENAI_API_KEY
  anthropic:
    driver: anthropic
    apiKeyEnv: ANTHROPIC_API_KEY
  google:
    driver: google
    apiKeyEnv: GOOGLE_GENERATIVE_AI_API_KEY
  local:
    driver: openai-compatible
    baseURL: http://127.0.0.1:4000/v1

models:
  gpt:
    provider: openai
    model: gpt-5.2
  claude:
    provider: anthropic
    model: claude-opus-4-6
  gemini:
    provider: google
    model: gemini-3.1-pro-preview

runs:
  - name: gpt-only
    model: gpt
    repetitions: 3
  - name: mixed
    agents:
      - gpt
      - claude
      - gemini
    repetitions: 3
```

## Structural contract

- YAML resolves to one JSON object validated against `experiments/schema.json`.
- Every object rejects unknown keys.
- Identifiers use lowercase ASCII letters, digits, and internal hyphens.
- `models`, `providers`, and `runs` are nonempty.
- Provider secret values have no schema field; only environment-variable names are accepted.
- `providerOptions` permits JSON-compatible non-secret values and no YAML tags or aliases that produce non-JSON values.

## Semantic contract

- All provider, model, and corpus names resolve.
- Official provider credentials exist when the selected run is launched.
- Target corpus is absent from references and all source digests match provenance.
- Chapter ranges are one-based inclusive after table-of-contents headings are excluded from the parsed chapter sequence.
- `agentCount >= 2`, `stageCount >= 1`, and run agent arrays match `agentCount`.
- Re-key stages are strictly ascending unique integers in `2..stageCount`.
- Run names are unique; exactly one of `model` or `agents` is present.
- Structural and semantic failures occur before build/attempt side effects and identify the failing field path.

## Secret contract

- Environment-variable values are read only while constructing a selected provider.
- Resolved configuration retains environment-variable names, never values.
- Header values use environment references under the same rule.
- Common settings are allowlisted; provider options recursively reject secret-bearing keys, request-control fields, and provider-native fallback declarations.
- Provider errors are scrubbed against every resolved credential value before leaving the provider boundary.
- Trace redaction remains defense in depth; correctness does not rely on redacting a value after it was intentionally serialized.
