# Active Command Sandbox Contract

The refactor moves these active contracts to `src/sandbox/contracts.ts` while preserving the agent-visible and host-safety behavior they define. No compatibility facade is provided for the old private import path.

## Type Shapes

```ts
export interface BaseSandboxCommand {
  command: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AgentSandboxLeaseRequest {
  profile: "agent";
  workspacePath: string;
  evidencePath: string;
  referenceCorpusPath: string;
  sharedGitPath: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AgentSandboxCommand extends BaseSandboxCommand {
  profile: "agent";
  workspacePath: string;
  evidencePath: string;
  referenceCorpusPath: string;
  sharedGitPath: string;
}

export interface EvaluationSandboxCommand extends BaseSandboxCommand {
  profile: "evaluation";
  workspacePath: string;
  ciphertextPath: string;
  frozenGitPath: string;
  outputPath: string;
}

export type SandboxCommand = AgentSandboxCommand | EvaluationSandboxCommand;

export interface SandboxCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputExceeded: boolean;
  indeterminate?: true;
  sandboxGeneration?: number;
}

export interface SandboxIdentity {
  imageTag: string;
  imageId: string;
  sourceDigest: string;
  profileVersion: 1;
}

export interface CommandSandbox {
  readonly identity: SandboxIdentity;
  openAgentLease(request: AgentSandboxLeaseRequest): Promise<AgentSandboxLease>;
  execute(request: EvaluationSandboxCommand): Promise<SandboxCommandResult>;
}

export interface AgentSandboxLease {
  readonly identity: SandboxIdentity;
  execute(request: BaseSandboxCommand): Promise<SandboxCommandResult>;
  close(): Promise<void>;
}
```

An asynchronous factory validates image labels and an optional expected image ID before returning a sandbox runtime. The run coordinator opens one lease per agent and closes all three before freeze. Production model-authored shell source executes through the assigned lease; reviewer-selected shell source executes through the separate evaluation method.

## Agent Mounts

| Container path    | Access           | Contents                                |
| ----------------- | ---------------- | --------------------------------------- |
| `/workspace`      | Read-write       | Calling agent's persistent Git worktree |
| `/evidence`       | Read-only        | Calling agent's released private stages |
| `/reference`      | Read-only        | Public target-excluded reference corpus |
| `/git/shared.git` | Read-write       | Ordinary team bare Git repository       |
| `/tmp`            | Read-write tmpfs | Private lease-local storage             |

The workspace Git remote remains `/git/shared.git`. Prompts describe container paths, never host paths.

## Evaluation Mounts

| Container path          | Access           | Contents                                       |
| ----------------------- | ---------------- | ---------------------------------------------- |
| `/workspace`            | Read-write       | Writable copy of the selected frozen workspace |
| `/input/ciphertext.txt` | Read-only        | Complete public ciphertext                     |
| `/git/shared.git`       | Read-only        | Frozen shared Git repository                   |
| `/tmp`                  | Read-write tmpfs | Disposable command-local storage               |

`PALIMPSEST_CIPHERTEXT` remains `/input/ciphertext.txt`; `PALIMPSEST_OUTPUT` remains the validated path beneath `/workspace`.

## Environment

The command container receives only:

- `HOME=/workspace`
- `LANG=C.UTF-8`
- `LC_ALL=C.UTF-8`
- `TMPDIR=/tmp`
- `GIT_TERMINAL_PROMPT=0`
- declared evaluator `PALIMPSEST_*` variables

Host `PATH`, host `HOME`, host temporary paths, model credentials, and unrelated process variables are never copied.

## Image and Policy

- Image tag: `palimpsest-puzzle-sandbox:0.1.0`
- Profile version: `1`
- Network: none
- CPU limit: 2
- Memory limit: 2 GiB
- PID limit: 256
- `/tmp` limit: 256 MiB
- Combined stdout/stderr limit: 4 MiB
- Read-only root, all capabilities dropped, no new privileges, and the existing seccomp behavior

Execution uses the inspected immutable image ID. Evaluation requires the image ID recorded in `attempt.json`.

## Failure Contract

- Missing, stale, or uninspectable image rejects before command start and names `pnpm puzzle:sandbox:build`.
- Docker inspection, lease creation, command execution, replacement, cleanup, or daemon failure is `SandboxInfrastructureError` unless a recovered interruption returns an explicit indeterminate command result.
- Every agent lease and evaluation command uses an unpredictable container name.
- Normal and nonzero exits retain a healthy agent lease. Timeout, cancellation, output overflow, resource termination, and partial launch converge on forced removal of the affected lease.
- Lease creation and every command use absolute deadlines.
- Interrupted creation uses bounded settle/retry cleanup for late daemon materialization.
- If runtime service returns within the command deadline, an interrupted agent lease is replaced over the same host-backed mounts and the command returns `indeterminate: true` without replay.
- A later command after configured termination may create a new lease generation over the same host-backed mounts.
- Cleanup failure remains explicit infrastructure failure.
- Combined output beyond 4 MiB terminates the command and appends the existing host-safety message.
- Nonzero exit, timeout, resource kill, and output overflow remain command results rather than sandbox infrastructure failures.
- Missing, non-regular, absolute, outside-workspace, or symlink-escaped candidate/output paths fail explicitly.
- Agent-side sandbox infrastructure failure terminates that session as `infrastructure-error` when recovery cannot complete.
- Evaluation image mismatch remains evaluation infrastructure failure.

## Internal Ownership

The implementation separates:

- contracts, policy, paths, and error types;
- workspace containment and regular-file validation;
- image digest/inspection and Docker argument construction;
- container execution and cleanup.

The shared trusted host-process primitive may implement compatible child lifecycles, but it cannot change any request/result shape, container policy, mount, output limit, or domain error classification.
