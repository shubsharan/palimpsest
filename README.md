# Palimpsest

Palimpsest is a local research runner for a team word-substitution puzzle. One checked-in YAML manifest freezes five blocks, a three-model assignment, four conditions, schedules, budgets, order, communication tooling, and failure rules. Persistent model sessions receive different private evidence over time and decide for themselves how to solve. A canonical condition selects shared or isolated Git and the stationary or re-key puzzle twin.

This is a puzzle and a research artifact. It is not a hosted service, an enterprise application, or a prescribed multi-agent workflow.

## Read First

- [Proposal](docs/proposal.md): puzzle, agent experience, evaluation, and claim boundary.
- [Architecture](docs/architecture.md): configuration, runtime, artifacts, and failure semantics.
- [Roadmap](docs/roadmap.md): delivery sequence and definition of done.
- [Feature 010 specification](specs/010-agent-sandbox-lifecycle/spec.md): attempt-scoped agent sandbox and recovery behavior.
- [Feature 012 quickstart](specs/012-simple-research-ci/quickstart.md): current development check, research preflight, and provenance flow.
- [Feature 013 quickstart](specs/013-engineered-paired-blocks/quickstart.md): paired-block discovery, construction, and verification.
- [Feature 014 quickstart](specs/014-four-team-conditions/quickstart.md): four-condition runtime and provider-free acceptance.
- [Feature 015 quickstart](specs/015-frozen-five-block-protocol/quickstart.md): frozen calibration, validation, and explicit replacement flow.
- [Experiment schema](experiments/schema.json): strict version-4 study manifest.
- [Block catalog](experiments/blocks.json): five pinned paired study blocks.
- [Study manifest](experiments/config.yaml): frozen block matrix, assignment, budgets, providers, rubric, and failure policy.

Features 011 and 012 provide the configurable research runner and its verification boundary. Feature 013 adds engineered stationary/re-key block pairs. Feature 014 implements the four communication/key conditions. Feature 015 freezes the complete five-block protocol. Feature 016 adds an optional direct team channel without changing the Git grading boundary.

## Setup

Use the tool versions pinned in `.tool-versions` and start Docker Engine or Docker Desktop.

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
```

The first bootstrap may use the network. Once the uv cache is populated, local checks use the locked environment offline. The sandbox image contains the Git, POSIX shell, and Python runtime used by model-authored commands and canonical solver execution. Each agent receives one attempt-scoped sandbox lease over its host-backed workspace and private evidence. Checker and final evaluation calls use separate one-shot sandboxes containing only a Git-free published-main snapshot, assigned ciphertext, and 16 MiB container-only output scratch; no writable host output path is mounted. Model calls happen on the host; provider credentials are never mounted into either sandbox.

## Configure The Study

Scientific source inputs live at the `sourcePath` values in the strict study manifest, `experiments/config.yaml`, which declares:

- `blocks`: one calibration and four validation block IDs in fixed order;
- `communication.teamChannel`: `enabled` for a shared public discussion room or `disabled` for Git-only collaboration;
- `assignment`: one ordered three-agent model assignment used by every cell;
- `schedule` and `budgets`: per-run reveal offsets, wall cutoff, optional token limit, and mandatory monetary authorizations;
- `providers`: direct OpenAI, Anthropic, Google, or OpenAI-compatible connections whose credentials are named by environment variable;
- `models`: provider/model profiles and non-secret settings;
- `orders`: one calibration and four balanced validation condition sequences; and
- `scoring`, `rubric`, `adjustableFields`, and `failurePolicy`: the declared observation and replacement boundary.

The builder derives source identity and seed from each source's bytes, retains fixed three-agent/six-stage geometry, and seals the first phase-eligible prose window. Older schema versions, unknown keys, aliases, order drift, secret-bearing values, and mismatched identities fail before an attempt. Palimpsest uses the AI SDK only as a narrow provider-neutral boundary and performs no automatic fallback or retry.

## Run

Build both variants from any eligible local UTF-8 prose source without provider access:

```bash
pnpm puzzle:build -- \
  --source fixtures/chronicles-of-break-oday.txt \
  --phase calibration \
  --output artifacts/build
```

The single command parses, scans, validates, seals, and publishes atomically. Ineligible input exits nonzero without a partial build. The schema-version-4 build contains stationary and re-key variants with byte-identical stages one through three. Every run requires exactly one of `CS`, `CR`, `IS`, or `IR`; the condition selects the variant and native Git topology.

Run one standalone condition with the frozen assignment:

```bash
pnpm puzzle:run -- \
  --config experiments/config.yaml \
  --condition CR \
  --build artifacts/build \
  --attempt-root artifacts/attempt
```

Run calibration, then validation, under one local study root:

```bash
pnpm puzzle:experiment -- \
  --config experiments/config.yaml \
  --phase calibration \
  --study-root artifacts/study
pnpm puzzle:experiment -- \
  --config experiments/config.yaml \
  --phase validation \
  --study-root artifacts/study
```

Calibration constructs all five builds and publishes immutable `design.json` before the first model session. Each phase reserves and runs one cell at a time, evaluates every canonical origin, writes `behavior-evidence.json`, and only then indexes the attempt in `phase.json`. Evaluation or evidence failure leaves the frozen attempt unindexed and stops the phase. Nothing retries automatically.

After an attempt freezes, the evaluator grades every condition-canonical published Git repository:

```bash
pnpm puzzle:evaluate -- \
  --attempt artifacts/study/validation/attempts/<attempt-id>
```

Every assigned origin begins with the same neutral `solver.py` scaffold on `main`. During an attempt, `check_published_solver` captures only literal `refs/heads/main`, runs its pinned Git-free tree on ciphertext assembled from one frozen view of ordered host release records, cleans the capture, and only then reports the commit, execution and output validity, word counts, and plaintext-independent coverage. It never opens oracle plaintext or checker truth and never reports correctness. The captured tree remains stable across later force-pushes. Local files, unpushed commits, other branches, agent-visible evidence mutations, and agent-workspace siblings are absent from that execution.

The manifest is the run-control interface. `schedule.releaseOffsetsMs` supplies six strictly increasing offsets beginning at zero, and `schedule.cutoffMs` must follow the final release. Set both `budgets.tokenBudgetPerAgent` and `budgets.totalTokenCeiling` to positive integers to enforce token termination, or set both to `null` for a wall-time-only run; provider-reported usage is still recorded. Monetary authorization remains explicit in either mode. The resolved values are frozen into each run's protocol and durable artifacts, so changing the next run means editing the manifest rather than changing runner code.

When `communication.teamChannel` is `enabled`, shared-condition agents also receive one attempt-local, append-only public room through `post_team_message` and `read_team_messages`; accepted posts wake peers and are retained in the attempt trace. The runtime commits live message, Git, and release views synchronously and projects them through one ordered trace outbox, so trace I/O cannot delay scheduled evidence. Any projection failure invalidates the attempt. Isolated agents never receive that room or its activity. Set the field to `disabled` to restore the prior Git-only treatment.

Final evaluation uses the same complete capture-execute-evaluate-clean operation, records each exact commit before execution, and publishes completion/results only after cleanup. It evaluates the one shared origin once in shared conditions and all three private origins independently in isolated conditions; it accepts no workspace selection, notes, alternate command, or output path. Missing or invalid submissions remain explicit evaluation outcomes; trusted host-process, scorer, sandbox, mount, cleanup, and cancellation failures remain infrastructure failures. The solver writes only to bounded tmpfs; afterward the host extracts the declared regular file into hidden staging and atomically publishes it after validation. The sandbox mounts no frozen repository, agent workspace, evidence, oracle path, or writable host output. Post-freeze records retain aggregate scores, diagnostics, realized team-product status, collective ceiling, and nullable integration gap without creating a synthetic reconstruction. Discussion is never a submission or grading path. The runner prescribes no roles, commit sequence, branch strategy, messaging cadence, or collaboration cadence.

Each attempt writes an append-only canonical `trace.jsonl` and a live-readable sibling `trace.log`. The text log renders each redacted event with its elapsed time, actor, event type, and indented data; watch it during a run with `tail -F artifacts/attempt/trace.log`. When a trace is reopened, the runner regenerates `trace.log` from `trace.jsonl`.

`behavior-evidence.json` records only durable facts: message, checker, and Git event references; per-agent usage; returned reasoning-summary presence; final origin commits and statuses; and artifact paths. The behavior rubric remains a separate human interpretation step for integration, interference, recovery, belief replacement, and source recognition.

## Development Check

```bash
pnpm check
```

The advisory Linux workflow runs this command for pull requests and pushes to `main`, then builds the sandbox image. It catches locked-dependency, formatting, lint, compile, and Dockerfile build failures without running unit suites, real-container behavior tests, or the offline fixture. It is intentionally not a required branch-protection check.

## Research Preflight

Before spending money on a live experiment or producing findings for publication, commit the exact source, leave the worktree clean, start Docker, and run:

```bash
pnpm preflight
```

Preflight rebuilds the agent sandbox, runs the complete verification suite including real-container tests, and executes a fresh deterministic build-run-evaluate fixture without an external model call. Only then does it write `artifacts/preflight.json`, binding the tested commit to the immutable sandbox identity. Any failed rerun removes the old receipt.

Generated runs belong under the ignored `artifacts/` directory. Provider-backed runs require the current clean checkout and sandbox to match `artifacts/preflight.json` before any model session begins. The matching receipt is copied into each attempt before its sessions start, while `attempt.json` independently records the sandbox actually used.

## Scope

Palimpsest deterministically constructs paired puzzle blocks and scores every canonical final origin. Feature 013 establishes controlled information geometry, not a behavioral result. Live model decisions, provider serving behavior, Git interleavings, reviewer judgment, and collaboration outcomes are not reproducible claims. The runner does not certify collaboration or belief revision or provide a hardened public benchmark.
