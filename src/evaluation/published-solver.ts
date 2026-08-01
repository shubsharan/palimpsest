import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GitCommandError, runGitCommand } from "../git.js";
import type { CommandSandbox, SandboxCommandResult } from "../sandbox/contracts.js";
import { InfrastructureError, WorkspaceFileError } from "../sandbox/contracts.js";
import { resolveWorkspaceRegularFile } from "../sandbox/workspace.js";

export const PUBLISHED_MAIN_REF = "refs/heads/main";
const CAPTURED_MAIN_REF = "refs/palimpsest/captured-main";
export const SOLVER_COMMAND = "python3 solver.py";
export const SOLVER_OUTPUT_PATH = "reconstruction.txt";
export const MAX_SOLVER_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface PublishedMainSnapshot {
  ref: typeof PUBLISHED_MAIN_REF;
  commit: string;
  snapshotPath: string;
}

export type PublishedSolverIdentity = Pick<PublishedMainSnapshot, "ref" | "commit">;

export type PublishedSolverOutcome<T> =
  | {
      kind: "succeeded";
      identity: PublishedSolverIdentity;
      execution: SandboxCommandResult;
      outputPath: string;
      value: T;
    }
  | {
      kind: "submission-error";
      identity: PublishedSolverIdentity;
      execution: SandboxCommandResult;
      outputPath: string;
      error: string;
    };

export type PublishedSolverExecution =
  | {
      kind: "succeeded";
      execution: SandboxCommandResult;
      outputPath: string;
    }
  | {
      kind: "submission-error";
      execution: SandboxCommandResult;
      outputPath: string;
      error: string;
    };

export class PublishedSolverSubmissionError extends Error {
  override readonly name = "PublishedSolverSubmissionError";
}

export class PublishedSolverInfrastructureError extends InfrastructureError {
  override readonly name = "PublishedSolverInfrastructureError";
  override readonly component = "published-solver";
}

async function trustedOperation<T>(label: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InfrastructureError || error instanceof DOMException) throw error;
    throw new PublishedSolverInfrastructureError(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function gitOptions(options: { cwd?: string; signal?: AbortSignal; deadline: number }): {
  cwd?: string;
  signal?: AbortSignal;
  deadline: number;
} {
  return {
    deadline: options.deadline,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

async function removeSnapshot(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    throw new PublishedSolverInfrastructureError(
      `Unable to clean captured published-main snapshot: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

async function withPublishedMainSnapshot<T>(
  options: {
    repositoryPath: string;
    snapshotPath: string;
    deadline: number;
    signal?: AbortSignal;
  },
  use: (snapshot: PublishedMainSnapshot) => Promise<T>,
): Promise<T> {
  let created = false;
  let outcome: { value: T } | undefined;
  let operationFailure: { error: unknown } | undefined;
  try {
    try {
      await mkdir(options.snapshotPath);
      created = true;
      await runGitCommand(
        ["init", "--initial-branch=main", "."],
        gitOptions({
          cwd: options.snapshotPath,
          deadline: options.deadline,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      );
    } catch (error) {
      if (error instanceof InfrastructureError || error instanceof DOMException) throw error;
      throw new PublishedSolverInfrastructureError(
        `Unable to initialize captured published-main snapshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    let commit: string;
    try {
      await runGitCommand(
        [
          "fetch",
          "--no-tags",
          "--no-recurse-submodules",
          "--force",
          options.repositoryPath,
          `+${PUBLISHED_MAIN_REF}:${CAPTURED_MAIN_REF}`,
        ],
        gitOptions({
          cwd: options.snapshotPath,
          deadline: options.deadline,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      );
      commit = (
        await runGitCommand(
          ["rev-parse", "--verify", `${CAPTURED_MAIN_REF}^{commit}`],
          gitOptions({
            cwd: options.snapshotPath,
            deadline: options.deadline,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          }),
        )
      ).stdout.trim();
      if (!/^[0-9a-f]{40}$/.test(commit)) {
        throw new PublishedSolverSubmissionError(
          `Published ref ${PUBLISHED_MAIN_REF} returned an invalid commit identity.`,
        );
      }
      await runGitCommand(
        ["checkout", "--detach", commit],
        gitOptions({
          cwd: options.snapshotPath,
          deadline: options.deadline,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      );
    } catch (error) {
      if (error instanceof GitCommandError) {
        throw new PublishedSolverSubmissionError(
          `Published ref ${PUBLISHED_MAIN_REF} must resolve to an available commit.`,
          { cause: error },
        );
      }
      throw error;
    }
    try {
      await rm(join(options.snapshotPath, ".git"), { recursive: true, force: false });
    } catch (error) {
      throw new PublishedSolverInfrastructureError(
        `Unable to seal captured published-main snapshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    outcome = {
      value: await use({
        ref: PUBLISHED_MAIN_REF,
        commit,
        snapshotPath: options.snapshotPath,
      }),
    };
  } catch (error) {
    operationFailure = { error };
  }
  if (created) {
    try {
      await removeSnapshot(options.snapshotPath);
    } catch (error) {
      if (operationFailure === undefined) throw error;
      throw new PublishedSolverInfrastructureError(
        "Published-main capture and cleanup both failed.",
        {
          cause: new AggregateError(
            [operationFailure.error, error],
            "Published-main capture and cleanup both failed.",
          ),
        },
      );
    }
  }
  if (operationFailure !== undefined) throw operationFailure.error;
  if (outcome === undefined) {
    throw new PublishedSolverInfrastructureError(
      "Published-main capture completed without a result.",
    );
  }
  return outcome.value;
}

export async function executePublishedSolver(options: {
  snapshot: PublishedMainSnapshot;
  ciphertextPath: string;
  outputRoot: string;
  sandbox: CommandSandbox;
  command?: string;
  outputPath?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<PublishedSolverExecution> {
  const outputPath = options.outputPath ?? SOLVER_OUTPUT_PATH;
  const candidatePath = join(options.outputRoot, outputPath);
  const execution = await options.sandbox.execute({
    profile: "solver",
    command: options.command ?? SOLVER_COMMAND,
    timeoutMs: options.timeoutMs ?? 30_000,
    submissionPath: options.snapshot.snapshotPath,
    ciphertextPath: options.ciphertextPath,
    outputRoot: options.outputRoot,
    outputPath,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (
    execution.exitCode !== 0 ||
    execution.timedOut ||
    execution.outputExceeded ||
    execution.indeterminate === true
  ) {
    return {
      kind: "submission-error",
      execution,
      outputPath: candidatePath,
      error: "Published solver execution failed.",
    };
  }
  if (execution.outputFailure !== undefined) {
    return {
      kind: "submission-error",
      execution,
      outputPath: candidatePath,
      error: execution.outputFailure,
    };
  }

  let resolved: string;
  try {
    resolved = await resolveWorkspaceRegularFile(
      options.outputRoot,
      outputPath,
      "Published solver output",
    );
  } catch (error) {
    const detail =
      error instanceof WorkspaceFileError && error.failure === "missing"
        ? "Published solver did not produce output."
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      kind: "submission-error",
      execution,
      outputPath: candidatePath,
      error: detail,
    };
  }

  const metadata = await stat(resolved);
  if (metadata.size === 0) {
    return {
      kind: "submission-error",
      execution,
      outputPath: resolved,
      error: "Published solver output is empty.",
    };
  }
  if (metadata.size > MAX_SOLVER_OUTPUT_BYTES) {
    return {
      kind: "submission-error",
      execution,
      outputPath: resolved,
      error: `Published solver output exceeds ${String(MAX_SOLVER_OUTPUT_BYTES)} bytes.`,
    };
  }
  return { kind: "succeeded", execution, outputPath: resolved };
}

export async function runPublishedSolver<T>(options: {
  repositoryPath: string;
  ciphertextPath: string;
  outputRoot: string;
  sandbox: CommandSandbox;
  deadline: number;
  command?: string;
  outputPath?: string;
  signal?: AbortSignal;
  onCaptured?: (identity: PublishedSolverIdentity) => void | Promise<void>;
  evaluate: (input: {
    identity: PublishedSolverIdentity;
    execution: SandboxCommandResult;
    outputPath: string;
  }) => Promise<T>;
}): Promise<PublishedSolverOutcome<T>> {
  const scratchRoot = await trustedOperation("Unable to create published-solver scratch root", () =>
    mkdtemp(join(tmpdir(), "palimpsest-published-solver-")),
  );
  const snapshotPath = join(scratchRoot, "submission");
  let outcome: PublishedSolverOutcome<T> | undefined;
  let operationFailure: { error: unknown } | undefined;
  try {
    outcome = await withPublishedMainSnapshot(
      {
        repositoryPath: options.repositoryPath,
        snapshotPath,
        deadline: options.deadline,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
      async (snapshot) => {
        const identity = { ref: snapshot.ref, commit: snapshot.commit };
        if (options.onCaptured !== undefined) {
          await trustedOperation("Unable to publish captured solver identity", () =>
            Promise.resolve(options.onCaptured!(identity)),
          );
        }
        const published = await executePublishedSolver({
          snapshot,
          ciphertextPath: options.ciphertextPath,
          outputRoot: options.outputRoot,
          sandbox: options.sandbox,
          timeoutMs: Math.max(1, Math.ceil(options.deadline - performance.now())),
          ...(options.command === undefined ? {} : { command: options.command }),
          ...(options.outputPath === undefined ? {} : { outputPath: options.outputPath }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        if (published.kind === "submission-error") {
          return {
            kind: "submission-error",
            identity,
            execution: published.execution,
            outputPath: published.outputPath,
            error: published.error,
          };
        }
        const value = await trustedOperation("Trusted published-solver evaluation failed", () =>
          options.evaluate({
            identity,
            execution: published.execution,
            outputPath: published.outputPath,
          }),
        );
        return {
          kind: "succeeded",
          identity,
          execution: published.execution,
          outputPath: published.outputPath,
          value,
        };
      },
    );
  } catch (error) {
    operationFailure = { error };
  }
  try {
    await rm(scratchRoot, { recursive: true, force: true });
  } catch (error) {
    const cause =
      operationFailure === undefined
        ? error
        : new AggregateError(
            [operationFailure.error, error],
            "Published-solver operation and scratch cleanup both failed.",
          );
    throw new PublishedSolverInfrastructureError(
      `Unable to clean published-solver scratch root: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause },
    );
  }
  if (operationFailure !== undefined) throw operationFailure.error;
  if (outcome === undefined) {
    throw new PublishedSolverInfrastructureError(
      "Published-solver transaction completed without an outcome.",
    );
  }
  return outcome;
}
