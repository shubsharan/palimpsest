import { chmod, cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { executeLocalCommand, type LocalCommandResult } from "./tools.js";

export type EvaluationStatus = "scored" | "not-runnable" | "no-output" | "execution-error";

export interface EvaluationSelection {
  command: string;
  outputPath: string;
  notes?: string;
}

export type ScoreHook = (request: {
  outputPath: string;
  ciphertextPath: string;
}) => Promise<unknown>;

export interface EvaluationResult {
  status: EvaluationStatus;
  selection?: EvaluationSelection;
  execution?: LocalCommandResult;
  outputPath?: string;
  score?: unknown;
  error?: string;
}

export type EvaluationObserver = (kind: string, data: unknown) => void | Promise<void>;

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

export async function evaluateFrozenAttempt(options: {
  frozenWorkspacePath: string;
  evaluationRoot: string;
  ciphertextPath: string;
  selection: EvaluationSelection | undefined;
  score: ScoreHook;
  observe?: EvaluationObserver;
  timeoutMs?: number;
}): Promise<EvaluationResult> {
  await mkdir(options.evaluationRoot, { recursive: false });
  await writeJson(join(options.evaluationRoot, "selection.json"), {
    selectedAt: new Date().toISOString(),
    selection: options.selection ?? null,
  });
  await options.observe?.("reviewer.selection", { selection: options.selection });
  if (options.selection === undefined || options.selection.command.trim().length === 0) {
    const result = withSelection("not-runnable", options.selection);
    await writeJson(join(options.evaluationRoot, "result.json"), result);
    return result;
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const result = withSelection("execution-error", options.selection, { error: detail });
    await writeJson(join(options.evaluationRoot, "result.json"), result);
    return result;
  }

  await options.observe?.("evaluation.started", {
    command: options.selection.command,
    outputPath: options.selection.outputPath,
  });
  let execution: LocalCommandResult;
  try {
    execution = await executeLocalCommand({
      command: options.selection.command,
      cwd: workspacePath,
      timeoutMs: options.timeoutMs ?? 30_000,
      env: {
        PALIMPSEST_CIPHERTEXT: options.ciphertextPath,
        PALIMPSEST_OUTPUT: outputPath,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await options.observe?.("evaluation.error", { error: detail });
    const result = withSelection("execution-error", options.selection, { error: detail });
    await writeJson(join(options.evaluationRoot, "result.json"), result);
    return result;
  }
  await options.observe?.("evaluation.completed", { execution });
  if (execution.exitCode !== 0 || execution.timedOut) {
    const result = withSelection("execution-error", options.selection, {
      execution,
      error: execution.timedOut
        ? "Reviewer-selected command timed out."
        : `Reviewer-selected command exited ${String(execution.exitCode)}.`,
    });
    await writeJson(join(options.evaluationRoot, "result.json"), result);
    return result;
  }

  try {
    if ((await readFile(outputPath)).byteLength === 0) {
      const result = withSelection("no-output", options.selection, { execution, outputPath });
      await writeJson(join(options.evaluationRoot, "result.json"), result);
      return result;
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      const result = withSelection("no-output", options.selection, { execution, outputPath });
      await writeJson(join(options.evaluationRoot, "result.json"), result);
      return result;
    }
    const detail = error instanceof Error ? error.message : String(error);
    const result = withSelection("execution-error", options.selection, {
      execution,
      outputPath,
      error: detail,
    });
    await writeJson(join(options.evaluationRoot, "result.json"), result);
    return result;
  }

  try {
    const score = await options.score({ outputPath, ciphertextPath: options.ciphertextPath });
    await options.observe?.("evaluation.scored", { score });
    const result = withSelection("scored", options.selection, { execution, outputPath, score });
    await writeJson(join(options.evaluationRoot, "result.json"), result);
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await options.observe?.("evaluation.error", { error: detail });
    const result = withSelection("execution-error", options.selection, {
      execution,
      outputPath,
      error: detail,
    });
    await writeJson(join(options.evaluationRoot, "result.json"), result);
    return result;
  }
}
