# Implementation Plan: Runner Hardening and Greenfield Cleanup

**Branch**: `008-runner-hardening-cleanup` | **Date**: 2026-07-27 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `/specs/008-runner-hardening-cleanup/spec.md`

## Summary

Replace direct host-shell execution with one injected Docker command sandbox used by both agent tools and frozen-workspace evaluation. Unify trace creation and resumption, scan all reachable Git blobs for observational overlap, then remove the disconnected Gate-era TypeScript and Python systems, historical tracked artifacts, obsolete dependencies, and specifications 001 through 005. Preserve the behavior-neutral puzzle, ordinary voluntary Git, deterministic build/check/score mechanics, all of specification 006, and the current operator command purposes.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4 **Primary Dependencies**: Node standard library, Docker 29.2.1 CLI/engine, Git 2.48.1, `rfc8785` 0.1.4 **Storage**: Local corpus fixtures, generated puzzle/attempt directories, JSON/JSONL records, ordinary bare Git repository and workspaces **Testing**: Vitest 4.1.10, pytest 9.1.1, Ruff 0.16.0, Oxlint 1.75.0, Oxfmt 0.60.0, fresh offline fixture **Target Platform**: macOS or Linux host with Docker Engine/Desktop; Linux containers **Project Type**: Local dual-runtime CLI and library **Performance Goals**: Preserve the configured global wall clock and command timeouts; sandbox startup must not alter reveal scheduling or token accounting **Constraints**: No public network or undeclared mounts in command containers; 2 CPUs, 2 GiB memory, 256 PIDs, 256 MiB temporary storage, 4 MiB combined output; standard safety boundary only **Scale/Scope**: Three persistent agents, six stages per agent, one shared bare Git repository, one reviewer-selected evaluation, one trace and overlap record per attempt **Puzzle Contribution**: Makes the existing behavior-neutral puzzle safe to operate and its post-run observation truthful without changing the puzzle or prescribing a solve path **Agent Instructions & Tools**: Preserve the shared objective, peer context, `run_command`, `check_reconstruction`, and `wait_for_activity`; keep Git optional and unmetered **Environmental Constraints**: Agent containers receive workspace, own released evidence, reference corpus, shared Git, and temporary storage; evaluation receives the frozen workspace, public ciphertext, frozen Git, and temporary storage; secrets, host files, peer evidence, oracle data, and public network are absent **Observable Outcomes**: Preserve model responses, tool activity, session states, Git ref changes, checker aggregates, selected command, execution result, reconstruction score, reachable raw overlap, unusual behavior, and resource termination **Determinism Claim**: Puzzle construction, staged inputs, checker aggregates, overlap rules, and scoring reproduce for fixed inputs; model decisions, Git interleaving, command duration, and team behavior do not

## Constitution Check

_GATE: Passed before research and passed again after design._

- **Puzzle behavior before process — PASS**: The sandbox changes only the environmental view. Prompts, tools, optional Git use, and reviewer selection remain behavior-neutral.
- **Environmental constraints, not workflow — PASS**: Mounts, network absence, and resource limits are fixed before commands and identical for peers. No turn, branch, checkpoint, file, or coordination requirement is added.
- **Minimal reproducible mechanics — PASS**: Docker addresses the demonstrated host-shell exposure. The design adds one executor interface, one small image, one trace sidecar, and scan counts; it does not restore policy gateways, security attestations, or replay infrastructure.
- **Observe outcomes honestly — PASS**: Sandbox launch/path failures are infrastructure errors. Agent commands, raw sharing, unusual Git, failed output, timeouts, and nonzero programs retain their existing observable semantics and never change scoring.
- **Voluntary native collaboration — PASS**: The shared repository is an ordinary mounted bare Git repository. The runner does not meter, inspect, reject, merge, or prescribe Git operations.

## Project Structure

### Documentation (this feature)

```text
specs/008-runner-hardening-cleanup/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── command-sandbox.md
│   ├── attempt-artifacts.md
│   └── operator-cli.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
containers/
└── puzzle-sandbox/
    └── Dockerfile

fixtures/
└── corpus/
    ├── middlemarch.txt
    ├── jane-eyre.txt
    ├── moby-dick.txt
    └── provenance.json

packages/
└── puzzle-runner/
    ├── src/
    └── tests/

python/
├── src/palimpsest/puzzle/
└── tests/puzzle/

tools/
├── puzzle/
└── verify-versions.ts

tests/
├── integration/
└── puzzle/
```

**Structure Decision**: Retain one TypeScript runner package and one Python puzzle package. Add only the sandbox implementation and neutral corpus fixtures. Delete rather than adapt disconnected packages and move the active Python dependency closure beneath `palimpsest.puzzle`.

## Design

### Command Sandbox

`CommandSandbox.execute(request)` is the only process boundary for model-authored and reviewer-selected commands. Typed agent and evaluation request profiles prevent callers from inventing additional mounts. `DockerCommandSandbox` assigns an unpredictable name, creates, starts, attaches to, inspects, and unconditionally force-removes one short-lived container per command. Timeout, cancellation, output overflow, launch failure, and normal exit all converge on the same cleanup path; failure to remove is an infrastructure error. The agent mapping is `/workspace` read-write, `/evidence` read-only, `/reference` read-only, and `/git/shared.git` read-write. The evaluator mapping is `/workspace` read-write, `/input/ciphertext.txt` read-only, and `/git/shared.git` read-only.

The Docker invocation uses the host UID/GID, a read-only root, `--network none`, `--cap-drop ALL`, `no-new-privileges`, the default seccomp profile, fixed CPU/memory/PID limits, and tmpfs `/tmp`. The API key and host environment never enter the container. Cancellation, timeout, and output overflow trigger forced removal by the trusted runner; client-process termination alone is not treated as cleanup. The immutable inspected image ID and effective policy are recorded as operational attempt metadata.

The build command tags `palimpsest-puzzle-sandbox:0.1.0` and labels it with profile version 1 and the checked-in Dockerfile digest. Execution refuses an absent or mismatched label and names `pnpm puzzle:sandbox:build` as the remedy. Commands execute by inspected image ID rather than mutable tag. Evaluation requires the image ID recorded by the attempt. The base is `python:3.12.4-slim-bookworm@sha256:a3e58f9399353be051735f09be0316bfdeab571a5c6a24fd78b92df85bcb2d85` with Git and standard POSIX utilities.

### Trace and Attempt Records

`JsonlObservationLog.create()` writes `trace.meta.json` before the first event and owns serialized live appends. `JsonlObservationLog.open()` reads the clock origin, validates every existing event, restores the last sequence/time, and appends post-run overlap or evaluation events through the same redaction path. Live elapsed time uses a monotonic clock; resumed elapsed time uses wall-clock delta clamped to the previous value. Existing corruption is an explicit infrastructure failure.

`attempt.json` records the trace paths, frozen paths, sessions, build root, sandbox image ID, and effective operational policy. It remains an operator summary, not a promotion manifest or validity gate.

### Reachable Git Observation

Overlap collection obtains unique object IDs reachable from current refs with `git rev-list --objects --all --no-object-names`, classifies them through `git cat-file --batch-check`, and reads each text blob once. It separately enumerates every reachable commit tree with NUL-delimited `git ls-tree` output to count repeated blob references across paths and history. UTF-8 content without NUL bytes is materialized by object ID; other blobs are skipped. The overlap record adds counts for reachable objects, blob references, unique blobs, repeated tree references, unique text blobs, and skipped non-text blobs. It remains post-run and observational only.

### Greenfield Cut

Move the active canonical JSON, digest, source parsing, text/cipher, revision, and reference-corpus helpers beneath `palimpsest.puzzle`, then delete all other Python namespaces and legacy tests. Delete TypeScript contracts, Git accounting, Git gateway, run control, Gate/artifact tools and tests, and runtime comparison scripts. Retain a relocated version verifier.

Move the exact Middlemarch, Jane Eyre, and Moby-Dick bytes plus reduced provenance to `fixtures/corpus`; delete Count of Monte Cristo and all tracked generated artifacts. Ignore `artifacts/` as runtime output. Delete specifications 001 through 005 while retaining specification 006 byte-for-byte. Update only current docs and the new feature artifacts; Git history is the archive.

## Complexity Tracking

No constitution violations or exceptions are required. Docker is the smallest reliable cross-platform filesystem and credential boundary for arbitrary model-authored shell commands; a working-directory-only host process cannot enforce the declared visibility boundary.
