import { rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { runGit } from "./git.js";
import type { CommandSandbox, SandboxCommandResult } from "./sandbox/contracts.js";
import { WorkspaceFileError } from "./sandbox/contracts.js";
import { resolveWorkspaceRegularFile } from "./sandbox/workspace.js";

export const PUBLISHED_MAIN_REF = "refs/heads/main";
export const SOLVER_COMMAND = "python3 solver.py";
export const SOLVER_OUTPUT_PATH = "reconstruction.txt";
export const MAX_SOLVER_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface PublishedSolverIdentity {
  ref: typeof PUBLISHED_MAIN_REF;
  commit: string;
}

export interface PublishedSolverExecution {
  execution: SandboxCommandResult;
  outputPath: string;
  error?: string;
}

export async function resolvePublishedSolver(
  repositoryPath: string,
): Promise<PublishedSolverIdentity> {
  let commit: string;
  try {
    commit = (
      await runGit(["rev-parse", "--verify", `${PUBLISHED_MAIN_REF}^{commit}`], repositoryPath)
    ).stdout.trim();
  } catch {
    throw new Error(`Published ref ${PUBLISHED_MAIN_REF} must resolve to a commit.`);
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`Published ref ${PUBLISHED_MAIN_REF} returned an invalid commit identity.`);
  }
  return { ref: PUBLISHED_MAIN_REF, commit };
}

export async function materializePublishedSolver(
  repositoryPath: string,
  targetPath: string,
  identity: PublishedSolverIdentity,
): Promise<void> {
  try {
    await runGit(["clone", "--no-local", "--no-checkout", repositoryPath, targetPath]);
    await runGit(["checkout", "--detach", identity.commit], targetPath);
    await rm(join(targetPath, ".git"), { recursive: true, force: true });
  } catch (error) {
    await rm(targetPath, { recursive: true, force: true });
    throw error;
  }
}

export async function executePublishedSolver(options: {
  snapshotPath: string;
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
    submissionPath: options.snapshotPath,
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
    return { execution, outputPath: candidatePath, error: "Published solver execution failed." };
  }

  let resolved: string;
  try {
    resolved = await resolveWorkspaceRegularFile(
      options.outputRoot,
      outputPath,
      "Published solver output",
    );
  } catch (error) {
    if (error instanceof WorkspaceFileError && error.failure === "missing") {
      return {
        execution,
        outputPath: candidatePath,
        error: "Published solver did not produce output.",
      };
    }
    return {
      execution,
      outputPath: candidatePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const metadata = await stat(resolved);
  if (metadata.size === 0) {
    return { execution, outputPath: resolved, error: "Published solver output is empty." };
  }
  if (metadata.size > MAX_SOLVER_OUTPUT_BYTES) {
    return {
      execution,
      outputPath: resolved,
      error: `Published solver output exceeds ${String(MAX_SOLVER_OUTPUT_BYTES)} bytes.`,
    };
  }
  return { execution, outputPath: resolved };
}
