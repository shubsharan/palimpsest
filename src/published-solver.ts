import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runGit } from "./git.js";
import {
  type CommandSandbox,
  type SandboxCommandResult,
  WorkspaceFileError,
} from "./sandbox/contracts.js";
import { resolveWorkspaceRegularFile } from "./sandbox/workspace.js";

export const PUBLISHED_SOLVER_COMMAND = "python3 solver.py";
export const PUBLISHED_SOLVER_OUTPUT_PATH = "output/reconstruction.txt";
const PUBLISHED_SOLVER_CHECKOUT_PATH = "submission";

interface PublishedSolverContext {
  commit: string;
  execution: SandboxCommandResult;
  outputPath: string;
}

export type PublishedSolverExecution =
  | ({ status: "succeeded" } & PublishedSolverContext)
  | ({ status: "no-output" } & PublishedSolverContext)
  | ({ status: "execution-error"; error: string } & PublishedSolverContext)
  | { status: "checkout-error"; error: string };

function executionFailed(result: SandboxCommandResult): boolean {
  return (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.outputExceeded ||
    result.indeterminate === true
  );
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function executePublishedSolver(options: {
  repositoryPath: string;
  ciphertextPaths: readonly string[];
  executionRoot: string;
  sandbox: CommandSandbox;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<PublishedSolverExecution> {
  const workspacePath = join(options.executionRoot, "workspace");
  const submissionPath = join(workspacePath, PUBLISHED_SOLVER_CHECKOUT_PATH);
  const outputPath = join(workspacePath, PUBLISHED_SOLVER_OUTPUT_PATH);
  const inputRoot = join(options.executionRoot, "input");
  const ciphertextPath = join(inputRoot, "ciphertext.txt");

  await mkdir(options.executionRoot, { recursive: false });
  await mkdir(workspacePath);
  await Promise.all([mkdir(join(workspacePath, "output")), mkdir(inputRoot)]);
  await writeFile(
    ciphertextPath,
    Buffer.concat(await Promise.all(options.ciphertextPaths.map((path) => readFile(path)))),
    { flag: "wx" },
  );

  let commit: string;
  try {
    await runGit([
      "clone",
      "--no-local",
      "--branch",
      "main",
      "--single-branch",
      options.repositoryPath,
      submissionPath,
    ]);
    commit = (await runGit(["rev-parse", "--verify", "HEAD"], submissionPath)).stdout.trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) {
      return {
        status: "checkout-error",
        error: "Published solver checkout returned an invalid commit identity.",
      };
    }
    await rm(join(submissionPath, ".git"), { recursive: true, force: false });
  } catch (error) {
    return {
      status: "checkout-error",
      error: `Published solver checkout failed: ${errorDetail(error)}`,
    };
  }

  const execution = await options.sandbox.execute({
    profile: "evaluation",
    command: `cd ${PUBLISHED_SOLVER_CHECKOUT_PATH} && ${PUBLISHED_SOLVER_COMMAND}`,
    timeoutMs: options.timeoutMs ?? 30_000,
    workspacePath,
    ciphertextPath,
    outputPath: PUBLISHED_SOLVER_OUTPUT_PATH,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const context = { commit, execution, outputPath };
  if (executionFailed(execution)) {
    return {
      status: "execution-error",
      ...context,
      error: "Published solver execution failed.",
    };
  }

  try {
    const candidatePath = await resolveWorkspaceRegularFile(
      workspacePath,
      PUBLISHED_SOLVER_OUTPUT_PATH,
      "Published solver output",
    );
    if ((await readFile(candidatePath)).byteLength === 0) {
      return { status: "no-output", ...context };
    }
    return { status: "succeeded", ...context, outputPath: candidatePath };
  } catch (error) {
    if (error instanceof WorkspaceFileError && error.failure === "missing") {
      return { status: "no-output", ...context };
    }
    return {
      status: "execution-error",
      ...context,
      error: errorDetail(error),
    };
  }
}
