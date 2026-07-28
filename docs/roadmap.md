# Roadmap

## Direction

Feature 011 is the active implementation. It generalizes the Feature 009 behavior-neutral runner into researcher-authored, provider-neutral experiments without turning Palimpsest into a service or workflow product.

The project is complete when one local YAML file can reproduce a puzzle condition, assign direct-provider models to its agents, retain sequential attempts, and leave each frozen attempt available for explicit reviewer evaluation.

Feature 012 defines the active verification policy: advisory mechanical CI and a fail-closed preflight at the point of consequential provider-backed research.

## Delivery Sequence

### 1. Establish The Experiment Contract

- Check in a strict version-1 JSON Schema and readable baseline YAML.
- Declare one puzzle, limits, direct provider connections, model profiles, run conditions, and explicit repetitions.
- Reject unknown keys, literal credentials, unsafe provider options, unresolved references, invalid mixed assignments, and invalid puzzle geometry before side effects.
- Materialize a resolved non-secret configuration with canonical dynamic agent identities and ordered model bindings.

This step is done when a homogeneous and mixed fixture condition resolve from one file without source edits or live credentials.

### 2. Generalize Deterministic Construction

- Make the provenance registry authoritative for source paths, formats, byte lengths, and digests.
- Interpret configured chapter ranges as one-based and inclusive; ignore table-of-contents chapter matches.
- Generate the declared number of private streams and stages.
- Support zero or more ordered partial re-keys, each derived from the prior key and constrained by recurring evidence on both sides of its boundary.
- Publish strict build schema version 2 with dynamic agent IDs, stage geometry, re-key transitions, paths, counts, and hashes.

This step is done when fixed 2-, 3-, and 5-agent configurations with zero, one, and two re-keys rebuild byte-identically and infeasible geometry fails explicitly.

### 3. Add Direct Provider-Neutral Sessions

- Keep the existing `ModelAdapter` as the single runtime boundary.
- Use AI SDK direct providers for one OpenAI, Anthropic, Google, or OpenAI-compatible turn at a time.
- Construct one model binding and adapter per declared agent, including mixed conditions.
- Forward model settings, provider options, tools, conversation history, and abort signals without delegating Palimpsest's lifecycle.
- Require normalized provider-reported input/output usage and preserve optional actual provider/model identity.
- Add no gateway, model registry, provider fallback, hidden retry, or vendor SDK coupling to the runner.

This step is done when mocked first and continuation turns, mixed assignments, usage, abort, and scrubbed provider errors pass without network access.

### 4. Make The Runtime Dynamic

- Create `agent-1` through `agent-N` workspaces, private evidence roots, sessions, prompts, trace identities, and frozen records.
- Release the configured number of stages on one monotonic schedule.
- Preserve independent concurrent sessions, shared ordinary Git, equivalent tools, aggregate private checking, token cutoffs, and one wall-time cutoff.
- Validate evaluation workspaces against each attempt rather than a static enumeration.
- Keep durable attempt publication before optional overlap observation.

This step is done when the existing behavioral fixtures work for dynamic identities without introducing roles, rounds, checkpoints, or solver conventions.

### 5. Preserve Sequential Research Runs

- Build one immutable puzzle per experiment.
- Execute conditions and repetitions sequentially in declaration order while keeping sessions inside each attempt concurrent.
- Publish `experiment.json` atomically after every durable attempt.
- Retain requested and actual model identities, normalized usage, termination, roots, and resolved scientific inputs without credential values.
- Freeze and index an attempt containing a provider infrastructure-error session, then stop before launching another.
- Leave reviewer selection and evaluation as a separate explicit action.

This step is done when a multi-condition fixture experiment preserves all prior attempts across a later failure and every indexed attempt can be evaluated independently.

### 6. Keep The Surface Small

The operator surface is six commands:

```bash
pnpm puzzle:sandbox:build
pnpm puzzle:build -- --config experiments/config.yaml --output artifacts/build
pnpm puzzle:run -- --config experiments/config.yaml --run gpt-only \
  --build artifacts/build --output artifacts/attempt
pnpm puzzle:experiment -- --config experiments/config.yaml \
  --output artifacts/experiment
pnpm puzzle:evaluate -- --attempt artifacts/attempt --workspace agent-1 \
  --command "sh solve.sh" --output-path reconstruction.txt
pnpm puzzle:offline -- --output artifacts/offline
```

All commands route through `src/cli.ts`. TypeScript owns configuration, provider construction, sessions, tools, Git, traces, artifacts, and orchestration. Python owns deterministic corpus preparation, cipher/re-key geometry, checker, overlap, and scoring. Docker remains the only nested runtime subsystem.

Generated attempts stay untracked. Git history remains the archive for superseded implementations and research evidence; active docs describe only the current path.

### 7. Verify Without Provider Spend

- Schema and semantic tests cover every invalid manifest class.
- Mocked provider tests cover model settings, history, tools, usage, abort, identity, failures, and secret scrubbing.
- Python tests cover registered corpora, chapter parsing, dynamic streams, successive re-keys, deterministic builds, checking, overlap, and scoring.
- TypeScript tests cover sessions, prompts, Git, releases, traces, cutoffs, freezing, durability, experiments, and reviewer-selected evaluation.
- Docker tests cover mounts, environment isolation, network denial, path containment, termination, and cleanup.
- A fixture experiment and fresh `puzzle:offline` flow exercise the complete path without a live provider call.

Verification proves that the runner behaves as documented. It does not require agents to solve well, use Git, detect a re-key, collaborate effectively, or avoid workarounds.

CI provides one advisory mechanical check covering locked dependencies, formatting, lint, compilation, and a sandbox image build without test suites or a required status gate. Before provider-backed work that spends money or may support findings, `pnpm preflight` runs the full suite and fresh scored fixture, then records the tested commit and sandbox identity.

## Definition Of Done

Palimpsest is delivered when:

- one strict YAML file declares the corpus, chapter range, seed, agents, stages, re-keys, limits, provider models, assignments, and repetitions;
- fixed scientific inputs deterministically reproduce build schema version 2 for supported dynamic puzzle geometry;
- one named run constructs the declared provider-neutral binding for every agent and preserves independent concurrent sessions;
- one experiment command builds once, runs sequential attempts, and atomically indexes every durable result;
- provider credentials never enter checked-in configuration, generated records, traces, errors, or command containers;
- no automatic fallback or hidden retry can change a declared condition;
- each attempt publishes schema version 2 before optional overlap observation and remains available for explicit reviewer-selected evaluation;
- the checked-in three-agent, six-stage, one-re-key fixture still runs end-to-end without an external model request; and
- advisory checks remain available for development, while a matching preflight receipt authorizes provider-backed attempts.

## Claim Boundary

The delivered artifact supports controlled local comparisons and qualitative inspection of particular runs. It does not isolate collaboration value, prove semantic reasoning or belief revision, equate provider token accounting, reproduce live model decisions, prevent raw communication, provide statistical analysis, or establish a secure public benchmark.
