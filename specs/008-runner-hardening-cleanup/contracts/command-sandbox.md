# Command Sandbox Contract

## Public TypeScript Interface

```ts
interface BaseSandboxCommand {
  command: string;
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
}

export interface SandboxIdentity {
  imageTag: string;
  imageId: string;
  sourceDigest: string;
  profileVersion: 1;
}

export interface CommandSandbox {
  readonly identity: SandboxIdentity;
  execute(request: SandboxCommand): Promise<SandboxCommandResult>;
}
```

An asynchronous factory inspects the image labels and optional expected image ID before returning a sandbox. `RunAttemptOptions` and `evaluateFrozenAttempt` receive a `CommandSandbox`. No production caller may execute model-authored or reviewer-selected shell source outside this interface.

## Agent Mount Contract

| Container path    | Access           | Contents                                |
| ----------------- | ---------------- | --------------------------------------- |
| `/workspace`      | Read-write       | Calling agent's persistent Git worktree |
| `/evidence`       | Read-only        | Calling agent's released private stages |
| `/reference`      | Read-only        | Public target-excluded reference corpus |
| `/git/shared.git` | Read-write       | Ordinary team bare Git repository       |
| `/tmp`            | Read-write tmpfs | Disposable command-local storage        |

The workspace Git remote uses `/git/shared.git`. Prompts describe container paths, not host paths.

## Evaluation Mount Contract

| Container path          | Access           | Contents                                       |
| ----------------------- | ---------------- | ---------------------------------------------- |
| `/workspace`            | Read-write       | Writable copy of the selected frozen workspace |
| `/input/ciphertext.txt` | Read-only        | Complete public ciphertext                     |
| `/git/shared.git`       | Read-only        | Frozen shared Git repository                   |
| `/tmp`                  | Read-write tmpfs | Disposable command-local storage               |

`PALIMPSEST_CIPHERTEXT` is `/input/ciphertext.txt`; `PALIMPSEST_OUTPUT` is the validated path beneath `/workspace`.

## Environment Contract

The container receives only:

- `HOME=/workspace`
- `LANG=C.UTF-8`
- `LC_ALL=C.UTF-8`
- `TMPDIR=/tmp`
- `GIT_TERMINAL_PROMPT=0`
- declared `PALIMPSEST_*` evaluator variables

Host `PATH`, `HOME`, temporary paths, model credentials, and other process variables are never copied.

## Failure Contract

- Missing, stale, or uninspectable image: reject before starting the command and name the sandbox build command.
- Docker inspection, creation, start, cleanup, or daemon error: reject as `SandboxInfrastructureError`.
- Every execution uses an unpredictable container name. Normal exit, nonzero exit, timeout, cancellation, output overflow, and partial launch all run one unconditional `docker rm --force`; a regression must prove no named container survives.
- Requested timeout or trusted cancellation: kill the Docker client process group and return or propagate the existing termination semantics.
- Combined output beyond 4 MiB: kill the command and append an explicit host-safety message.
- Nonzero command exit, timeout, resource kill, or output overflow: return the normal command result with explicit flags; it is not a sandbox infrastructure failure.
- Candidate/output missing, non-regular, absolute, outside the workspace, or symlink-escaped: reject explicitly.
- An agent-side `SandboxInfrastructureError` terminates that session as `infrastructure-error`; it is never converted into retry-shaped tool output.
- Evaluation uses the image ID recorded in `attempt.json`; mismatch is an evaluation infrastructure error.
