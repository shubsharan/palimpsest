# Research: Configurable Research Runs

## Direct provider integration

**Decision**: Keep Palimpsest's `ModelAdapter` and implement it with pinned AI SDK provider packages for OpenAI, Anthropic, Google, and OpenAI-compatible endpoints.

**Rationale**: AI SDK provides one language-model and tool-call shape across direct providers while allowing Palimpsest to retain its existing session, observation, and cutoff semantics. Direct connections preserve the requested provider as an observable condition and avoid a gateway that may route, retry, or transform requests.

**Alternatives considered**:

- LiteLLM proxy: broader provider coverage but adds a service, another configuration surface, and a translation boundary not needed by one researcher.
- OpenRouter or Vercel AI Gateway: smallest client surface but changes the provider trust/routing boundary and may obscure the actual serving path.
- Vendor SDKs or hand-written HTTP decoders: duplicate multi-turn tool and usage normalization in Palimpsest and recreate the hard-coding the feature removes.

**Primary references**:

- <https://ai-sdk.dev/docs/ai-sdk-core/provider-management>
- <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>
- <https://ai-sdk.dev/providers/openai-compatible-providers>

## Model-turn ownership

**Decision**: Invoke one AI SDK generation per `ModelSession.respond`, expose tools without provider-side execution, and append AI SDK v7 `responseMessages` to adapter-owned history.

**Rationale**: The existing Palimpsest loop must continue to observe every tool request/result, waiting transition, checker disclosure, token cutoff, and abort. Letting a framework execute a multi-step agent loop would hide or duplicate those boundaries.

**Alternatives considered**:

- AI SDK multi-step agent loop: useful for applications but would move lifecycle and tool execution away from current named owners.
- Stateless prompt reconstruction: loses provider-normalized assistant/tool messages and is more error-prone for mixed tool content.
- Provider response IDs: efficient for some providers but not portable across all four drivers.

## Usage and provider failure

**Decision**: Disable AI SDK request retries, require normalized input and output token counts, enforce the existing cumulative `input + output` cutoff, scrub error strings against resolved credentials, and record optional provider detail separately.

**Rationale**: Silent estimates and hidden retries would make the declared budget and call history less interpretable. Provider token accounting is retained as reported evidence, not claimed to be identical across providers.

**Alternatives considered**:

- Estimate missing usage locally: model-specific tokenization would add dependencies and false precision.
- Use provider total tokens only: provider definitions vary and may include reasoning or overhead inconsistently.
- Automatic transient retry: can add unobserved billable calls and nondeterministic sampling.
- Unmodified provider errors: may echo request headers or credential-bearing endpoint details into durable research artifacts.

## Manifest format and validation

**Decision**: Use YAML 2.9.0 for authoring, a checked-in JSON Schema validated by Ajv 8.20.0 for structure, and a typed semantic resolver for cross-reference and geometry rules.

**Rationale**: YAML is readable for a small research configuration; one strict schema gives editor support and rejects unknown keys, while semantic validation remains short and explicit. The configuration is data, not executable code.

**Alternatives considered**:

- JSON: dependency-free parsing but less pleasant for repeated hand-authored experiment conditions.
- TypeScript configuration: typed composition but executable configuration is harder to canonicalize and share safely.
- Zod plus generated schema: duplicates or adds schema-generation machinery without a current need.

## Experiment granularity

**Decision**: One manifest declares one puzzle and an ordered list of model conditions/repetitions. The puzzle is built once and attempts run sequentially.

**Rationale**: This matches the researcher's immediate need, keeps local resource/provider usage understandable, and makes repetitions comparable against identical deterministic evidence.

**Alternatives considered**:

- General Cartesian matrix engine: concise for large sweeps but can create accidental cost and needs more expansion/resume policy.
- One file per attempt: minimal runtime code but repeats puzzle configuration and makes mixed comparisons harder to share.
- Parallel attempts: faster but increases local Docker/provider contention and time-of-run confounds.

## Corpus selection

**Decision**: Resolve target and reference sources from the checked-in provenance registry, add explicit path/format fields, verify byte length and digest, reject target leakage into references, and interpret configured chapter ranges as one-based inclusive after discarding leading Gutenberg table-of-contents matches.

**Rationale**: A shared manifest must mean the same source bytes on another checkout. Arbitrary absolute paths would make the declared condition non-portable.

**Alternatives considered**:

- Arbitrary local paths: convenient but not reproducible.
- Download sources during a build: adds network state and makes deterministic verification dependent on external availability.

## Successive partial re-keys

**Decision**: Represent re-keys as ordered stage-boundary transitions. Each transition revises the immediately preceding bijection, selects symbols with evidence in every agent's adjacent pre/post regions, and records a numeric key version per stage.

**Rationale**: This is the direct generalization of the existing hidden transition. Adjacent-region eligibility keeps each declared change observable without prescribing whether models notice it.

**Alternatives considered**:

- Full new key per transition: discards the selective belief-revision behavior that defines the puzzle.
- One re-key per separate puzzle: supports comparison but not the requested multiple revisions inside one attempt.
- Eligibility over the entire run only: may choose symbols absent near a particular transition and create nominal rather than usable contradictory evidence.

## Artifact versioning

**Decision**: Move the build/attempt contracts to current schema version 2 with dynamic agents, re-key arrays, model bindings, and resolved scientific inputs; do not add v1 migration code.

**Rationale**: The repository is greenfield, generated artifacts are untracked, and the current active reader should describe only the new authoritative record.

**Alternatives considered**:

- Optional v1/v2 fields: weakens validation and leaves two active meanings for transition data.
- Migration command: no current retained dataset requires it.
