import { chmod, cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, win32 } from "node:path";

import {
  type AggregateScore,
  decodeAggregateScore,
  decodeAttemptSummary,
  decodeBuildManifest,
  decodeEvaluationRecord,
} from "./artifacts.js";
import { isAgentId, type AgentId } from "./model.js";
import {
  type CommandSandbox,
  SandboxInfrastructureError,
  type SandboxCommandResult,
  WorkspaceFileError,
} from "./sandbox/contracts.js";
import { resolveWorkspacePath, resolveWorkspaceRegularFile } from "./sandbox/workspace.js";
import { requiredFlag } from "./flags.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";

import { appendTraceEvent, readJsonObject, runPythonJson } from "./python.js";

export type EvaluationStatus = "scored" | "not-runnable" | "no-output" | "execution-error";

export interface EvaluationSelection {
  command: string;
  outputPath: string;
  notes?: string;
}

export type ScoreHook = (request: {
  outputPath: string;
  ciphertextPath: string;
}) => Promise<AggregateScore>;

export interface EvaluationResult {
  status: EvaluationStatus;
  selection?: EvaluationSelection;
  execution?: SandboxCommandResult;
  outputPath?: string;
  score?: AggregateScore;
  error?: string;
}

export type EvaluationObserver = (kind: string, data: unknown) => void | Promise<void>;

export interface EvaluatePuzzleOptions {
  root: string;
  attempt: string;
  workspace?: AgentId;
  command?: string;
  outputPath?: string;
  notes?: string;
}

function resolveOutputPath(workspacePath: string, outputPath: string): string {
  if (outputPath.length === 0 || isAbsolute(outputPath)) {
    throw new Error("Reviewer outputPath must be relative to the selected workspace.");
  }
  const resolved = resolve(workspacePath, outputPath);
  const difference = relative(workspacePath, resolved);
  if (
    difference === ".." ||
    difference.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error("Reviewer outputPath must remain inside the evaluation workspace.");
  }
  return resolved;
}

async function makeWritable(path: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await makeWritable(child);
      } else if (!entry.isSymbolicLink()) {
        const metadata = await lstat(child);
        await chmod(child, metadata.mode | 0o200);
      }
    }),
  );
  const metadata = await lstat(path);
  await chmod(path, metadata.mode | 0o700);
}

function withSelection(
  status: EvaluationStatus,
  selection: EvaluationSelection | undefined,
  extra: Omit<EvaluationResult, "status" | "selection"> = {},
): EvaluationResult {
  return selection === undefined ? { status, ...extra } : { status, selection, ...extra };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

async function writeEvaluationResult(
  evaluationRoot: string,
  value: EvaluationResult,
): Promise<EvaluationResult> {
  const result = decodeEvaluationRecord(value);
  await writeJson(join(evaluationRoot, "result.json"), result);
  return result;
}

function validateReviewerSelection(selection: EvaluationSelection | undefined): void {
  if (selection?.command !== undefined && selection.command.trim().length === 0) {
    throw new Error("Reviewer command must contain non-whitespace shell source.");
  }
  if (selection?.notes !== undefined && selection.notes.trim().length === 0) {
    throw new Error("Reviewer notes must contain non-whitespace text.");
  }
  if (selection !== undefined) {
    const parts = selection.outputPath.split(/[\\/]/);
    if (
      posix.isAbsolute(selection.outputPath) ||
      win32.isAbsolute(selection.outputPath) ||
      selection.outputPath.includes("\0") ||
      parts.some((part) => part.length === 0 || part === "." || part === "..")
    ) {
      throw new Error("Reviewer outputPath must be a safe relative path.");
    }
  }
}

export async function evaluateFrozenAttempt(options: {
  frozenWorkspacePath: string;
  frozenGitPath: string;
  evaluationRoot: string;
  ciphertextPath: string;
  sandbox: CommandSandbox;
  selection: EvaluationSelection | undefined;
  score: ScoreHook;
  observe?: EvaluationObserver;
  timeoutMs?: number;
}): Promise<EvaluationResult> {
  validateReviewerSelection(options.selection);
  await mkdir(options.evaluationRoot, { recursive: false });
  await writeJson(join(options.evaluationRoot, "selection.json"), {
    selectedAt: new Date().toISOString(),
    selection: options.selection ?? null,
  });
  await options.observe?.("reviewer.selection", { selection: options.selection });
  if (options.selection === undefined || options.selection.command.trim().length === 0) {
    const result = withSelection("not-runnable", options.selection);
    return writeEvaluationResult(options.evaluationRoot, result);
  }

  let outputPath: string;
  const workspacePath = join(options.evaluationRoot, "workspace");
  try {
    await cp(options.frozenWorkspacePath, workspacePath, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await makeWritable(workspacePath);
    outputPath = resolveOutputPath(workspacePath, options.selection.outputPath);
    await resolveWorkspacePath(workspacePath, options.selection.outputPath, "Reviewer outputPath");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const result = withSelection("execution-error", options.selection, { error: detail });
    return writeEvaluationResult(options.evaluationRoot, result);
  }

  await options.observe?.("evaluation.started", {
    command: options.selection.command,
    outputPath: options.selection.outputPath,
  });
  let execution: SandboxCommandResult;
  try {
    execution = await options.sandbox.execute({
      profile: "evaluation",
      command: options.selection.command,
      timeoutMs: options.timeoutMs ?? 30_000,
      workspacePath,
      ciphertextPath: options.ciphertextPath,
      frozenGitPath: options.frozenGitPath,
      outputPath: options.selection.outputPath,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await options.observe?.(
      error instanceof SandboxInfrastructureError
        ? "evaluation.infrastructure-error"
        : "evaluation.error",
      { error: detail },
    );
    const result = withSelection("execution-error", options.selection, { error: detail });
    return writeEvaluationResult(options.evaluationRoot, result);
  }
  await options.observe?.("evaluation.completed", { execution });
  if (execution.exitCode !== 0 || execution.timedOut) {
    const result = withSelection("execution-error", options.selection, {
      execution,
      error: execution.timedOut
        ? "Reviewer-selected command timed out."
        : `Reviewer-selected command exited ${String(execution.exitCode)}.`,
    });
    return writeEvaluationResult(options.evaluationRoot, result);
  }

  try {
    outputPath = await resolveWorkspaceRegularFile(
      workspacePath,
      options.selection.outputPath,
      "Reviewer outputPath",
    );
    if ((await readFile(outputPath)).byteLength === 0) {
      const result = withSelection("no-output", options.selection, { execution, outputPath });
      return writeEvaluationResult(options.evaluationRoot, result);
    }
  } catch (error) {
    if (error instanceof WorkspaceFileError && error.failure === "missing") {
      const result = withSelection("no-output", options.selection, { execution, outputPath });
      return writeEvaluationResult(options.evaluationRoot, result);
    }
    const detail = error instanceof Error ? error.message : String(error);
    const result = withSelection("execution-error", options.selection, {
      execution,
      outputPath,
      error: detail,
    });
    return writeEvaluationResult(options.evaluationRoot, result);
  }

  try {
    const score = await options.score({ outputPath, ciphertextPath: options.ciphertextPath });
    await options.observe?.("evaluation.scored", { score });
    const result = withSelection("scored", options.selection, { execution, outputPath, score });
    return await writeEvaluationResult(options.evaluationRoot, result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await options.observe?.("evaluation.error", { error: detail });
    const result = withSelection("execution-error", options.selection, {
      execution,
      outputPath,
      error: detail,
    });
    return writeEvaluationResult(options.evaluationRoot, result);
  }
}

function attemptRootFrom(path: string): string {
  const resolved = resolve(path);
  return basename(resolved) === "frozen" ? dirname(resolved) : resolved;
}

export async function evaluatePuzzle(options: EvaluatePuzzleOptions): Promise<EvaluationResult> {
  const root = resolve(options.root);
  const attemptRoot = attemptRootFrom(options.attempt);
  if ((options.command === undefined) !== (options.outputPath === undefined)) {
    throw new Error("Reviewer command and output path must be provided together.");
  }
  validateReviewerSelection(
    options.command === undefined || options.outputPath === undefined
      ? undefined
      : {
          command: options.command,
          outputPath: options.outputPath,
          ...(options.notes === undefined ? {} : { notes: options.notes }),
        },
  );
  const attempt = decodeAttemptSummary(await readJsonObject(join(attemptRoot, "attempt.json")));
  const workspace = options.workspace ?? "agent-1";
  if (!attempt.agentIds.includes(workspace)) {
    throw new Error(`Workspace ${workspace} is not declared by attempt ${attempt.attemptId}.`);
  }
  const selection: EvaluationSelection | undefined =
    options.command === undefined || options.outputPath === undefined
      ? undefined
      : {
          command: options.command,
          outputPath: options.outputPath,
          ...(options.notes === undefined ? {} : { notes: options.notes }),
        };
  const build = decodeBuildManifest(
    await readJsonObject(join(attempt.buildRoot, "puzzle-build.json")),
  );
  const sandbox = await createDockerCommandSandbox({
    root,
    expectedImageId: attempt.sandbox.imageId,
  });
  await evaluateFrozenAttempt({
    frozenWorkspacePath: join(attempt.frozenRoot, "workspaces", workspace),
    frozenGitPath: join(attempt.frozenRoot, "shared.git"),
    evaluationRoot: join(attemptRoot, "evaluation"),
    ciphertextPath: join(attempt.buildRoot, build.publicCiphertextPath),
    sandbox,
    selection,
    score: async ({ outputPath }) =>
      decodeAggregateScore(
        await runPythonJson(root, "palimpsest.evaluation.score", [
          "--truth",
          join(attempt.buildRoot, build.oracleRoot, "plaintext.txt"),
          "--candidate",
          outputPath,
        ]),
      ),
    observe: async (kind, data) => appendTraceEvent(attempt.tracePath, kind, data),
  });
  return decodeEvaluationRecord(
    await readJsonObject(join(attemptRoot, "evaluation", "result.json")),
  );
}

export function evaluatePuzzleFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<EvaluationResult> {
  const workspace = flags.get("--workspace");
  if (workspace !== undefined && !isAgentId(workspace)) {
    throw new Error("--workspace must be a canonical agent-N identifier.");
  }
  const command = flags.get("--command");
  const outputPath = flags.get("--output-path");
  const notes = flags.get("--notes");
  return evaluatePuzzle({
    root,
    attempt: requiredFlag(flags, "--attempt"),
    ...(workspace === undefined ? {} : { workspace }),
    ...(command === undefined ? {} : { command }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(notes === undefined ? {} : { notes }),
  });
}
