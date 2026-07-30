import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix, resolve, win32 } from "node:path";

import {
  type AggregateScore,
  decodeAggregateScore,
  decodeAttemptSummary,
  decodeBuildManifest,
  decodeEvaluationRecord,
  selectBuildVariant,
} from "./artifacts.js";
import type { GitRepositoryId } from "./git.js";
import { isAgentId, type AgentId } from "./model.js";
import {
  type CommandSandbox,
  InfrastructureError,
  type SandboxCommandResult,
} from "./sandbox/contracts.js";
import { requiredFlag } from "./flags.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";
import {
  PUBLISHED_MAIN_REF,
  PublishedSolverSubmissionError,
  runPublishedSolver,
  SOLVER_COMMAND,
  SOLVER_OUTPUT_PATH,
} from "./published-solver.js";

import { appendTraceEvent, readJsonObject, runPythonJson } from "./python.js";
import { verifyTree } from "./seal.js";

export type EvaluationStatus = "scored" | "not-runnable" | "no-output" | "execution-error";

export interface EvaluationSelection {
  workspace: AgentId;
  repositoryId: GitRepositoryId;
  ref: typeof PUBLISHED_MAIN_REF;
  commit: string;
  command: string;
  outputPath: string;
  notes?: string;
}

export type EvaluationSelectionRequest = Omit<EvaluationSelection, "ref" | "commit">;

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
  notes?: string;
}

export { SOLVER_COMMAND, SOLVER_OUTPUT_PATH };

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

function validateReviewerSelection(selection: EvaluationSelectionRequest | undefined): void {
  if (
    selection !== undefined &&
    (!isAgentId(selection.workspace) ||
      (selection.repositoryId !== "shared" && !isAgentId(selection.repositoryId)))
  ) {
    throw new Error("Reviewer selection must identify one published-main repository.");
  }
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
  frozenGitPath: string;
  evaluationRoot: string;
  ciphertextPath: string;
  sandbox: CommandSandbox;
  selection: EvaluationSelectionRequest | undefined;
  score: ScoreHook;
  observe?: EvaluationObserver;
  timeoutMs?: number;
}): Promise<EvaluationResult> {
  validateReviewerSelection(options.selection);
  await mkdir(options.evaluationRoot, { recursive: false });
  if (options.selection === undefined || options.selection.command.trim().length === 0) {
    await writeJson(join(options.evaluationRoot, "selection.json"), {
      selectedAt: new Date().toISOString(),
      selection: null,
    });
    await options.observe?.("reviewer.selection", { selection: null });
    const result = withSelection("not-runnable", undefined);
    return writeEvaluationResult(options.evaluationRoot, result);
  }

  const selectionRequest = options.selection;
  const outputRoot = join(options.evaluationRoot, "output");
  const deadline = performance.now() + (options.timeoutMs ?? 30_000);
  let recordedSelection = false;
  let selection: EvaluationSelection | undefined;
  try {
    await mkdir(outputRoot);
    const published = await runPublishedSolver({
      repositoryPath: options.frozenGitPath,
      ciphertextPath: options.ciphertextPath,
      outputRoot,
      sandbox: options.sandbox,
      command: selectionRequest.command,
      outputPath: selectionRequest.outputPath,
      deadline,
      onCaptured: async (identity) => {
        selection = {
          ...selectionRequest,
          ref: identity.ref,
          commit: identity.commit,
        };
        await writeJson(join(options.evaluationRoot, "selection.json"), {
          selectedAt: new Date().toISOString(),
          selection,
        });
        recordedSelection = true;
        await options.observe?.("reviewer.selection", { selection });
        await options.observe?.("evaluation.started", {
          command: selection.command,
          outputPath: selection.outputPath,
        });
      },
      evaluate: async ({ outputPath }) =>
        decodeAggregateScore(
          await options.score({
            outputPath,
            ciphertextPath: options.ciphertextPath,
          }),
        ),
    });
    if (selection === undefined) {
      throw new InfrastructureError("Published solver completed without captured provenance.");
    }
    const { execution, outputPath } = published;
    await options.observe?.("evaluation.completed", { execution });
    if (published.kind === "submission-error") {
      if (
        published.error === "Published solver did not produce output." ||
        published.error === "Published solver output is empty."
      ) {
        return writeEvaluationResult(
          options.evaluationRoot,
          withSelection("no-output", selection, { execution, outputPath }),
        );
      }
      return writeEvaluationResult(
        options.evaluationRoot,
        withSelection("execution-error", selection, {
          execution,
          outputPath,
          error: execution.timedOut
            ? "Reviewer-selected command timed out."
            : execution.exitCode !== 0
              ? `Reviewer-selected command exited ${String(execution.exitCode)}.`
              : published.error,
        }),
      );
    }
    await options.observe?.("evaluation.scored", { score: published.value });
    return writeEvaluationResult(
      options.evaluationRoot,
      withSelection("scored", selection, {
        execution,
        outputPath,
        score: published.value,
      }),
    );
  } catch (error) {
    if (error instanceof PublishedSolverSubmissionError) {
      if (!recordedSelection) {
        await writeJson(join(options.evaluationRoot, "selection.json"), {
          selectedAt: new Date().toISOString(),
          selection: null,
        });
        await options.observe?.("reviewer.selection", { selection: null });
      }
      await options.observe?.("evaluation.error", { error: error.message });
    } else if (error instanceof InfrastructureError) {
      await options.observe?.("evaluation.infrastructure-error", {
        error: error.message,
      });
    }
    throw error;
  }
}

function attemptRootFrom(path: string): string {
  const resolved = resolve(path);
  return basename(resolved) === "frozen" ? dirname(resolved) : resolved;
}

export async function evaluatePuzzle(options: EvaluatePuzzleOptions): Promise<EvaluationResult> {
  const root = resolve(options.root);
  const attemptRoot = attemptRootFrom(options.attempt);
  if (options.workspace === undefined) {
    throw new Error("Reviewer workspace must be provided for evaluation.");
  }
  const attempt = decodeAttemptSummary(await readJsonObject(join(attemptRoot, "attempt.json")));
  await Promise.all([
    verifyTree(attempt.buildRoot, attempt.buildTreeSeal, "Attempt build tree"),
    verifyTree(attempt.frozen.root, attempt.frozen.treeSeal, "Attempt frozen tree"),
  ]);
  const workspace = options.workspace;
  if (!attempt.agentIds.includes(workspace)) {
    throw new Error(`Workspace ${workspace} is not declared by attempt ${attempt.attemptId}.`);
  }
  const build = decodeBuildManifest(
    await readJsonObject(join(attempt.buildRoot, "puzzle-build.json")),
  );
  const variant = selectBuildVariant(build, attempt.variantId);
  if (variant.buildId !== attempt.buildId) {
    throw new Error("Attempt build identity does not match the selected paired-build variant.");
  }
  const frozenWorkspace = attempt.frozen.workspaces.find(
    (candidate) => candidate.agentId === workspace,
  );
  if (frozenWorkspace === undefined) {
    throw new Error(`Frozen workspace ${workspace} is missing from attempt ${attempt.attemptId}.`);
  }
  const frozenRepository = attempt.frozen.repositories.find(
    (candidate) => candidate.repositoryId === frozenWorkspace.repositoryId,
  );
  if (
    frozenRepository === undefined ||
    !frozenRepository.agentIds.includes(workspace) ||
    frozenWorkspace.path !== join(attempt.frozen.root, "workspaces", workspace)
  ) {
    throw new Error(`Frozen Git topology is inconsistent for workspace ${workspace}.`);
  }
  const selection: EvaluationSelectionRequest = {
    workspace,
    repositoryId: frozenRepository.repositoryId,
    command: SOLVER_COMMAND,
    outputPath: SOLVER_OUTPUT_PATH,
    ...(options.notes === undefined ? {} : { notes: options.notes }),
  };
  const sandbox = await createDockerCommandSandbox({
    root,
    expectedImageId: attempt.sandbox.imageId,
  });
  await evaluateFrozenAttempt({
    frozenGitPath: frozenRepository.path,
    evaluationRoot: join(attemptRoot, "evaluation"),
    ciphertextPath: join(attempt.buildRoot, variant.publicCiphertextPath),
    sandbox,
    selection,
    score: async ({ outputPath }) =>
      decodeAggregateScore(
        await runPythonJson(root, "palimpsest.evaluation.score", [
          "--truth",
          join(attempt.buildRoot, "oracle", "plaintext.txt"),
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
  if (flags.has("--command") || flags.has("--output-path")) {
    throw new Error(
      "Evaluation always runs origin/main:solver.py; --command and --output-path are not accepted.",
    );
  }
  const notes = flags.get("--notes");
  return evaluatePuzzle({
    root,
    attempt: requiredFlag(flags, "--attempt"),
    ...(workspace === undefined ? {} : { workspace }),
    ...(notes === undefined ? {} : { notes }),
  });
}
