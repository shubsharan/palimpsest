import { access, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { JsonlObservationLog } from "./trace.js";
import { runProcess as runTrustedProcess } from "./process.js";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface BufferProcessResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: { cwd: string; signal?: AbortSignal; env?: NodeJS.ProcessEnv; input?: string | Buffer },
): Promise<ProcessResult> {
  return runProcessBuffer(command, args, options).then((result) => ({
    exitCode: result.exitCode,
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8"),
  }));
}

export function runProcessBuffer(
  command: string,
  args: readonly string[],
  options: { cwd: string; signal?: AbortSignal; env?: NodeJS.ProcessEnv; input?: string | Buffer },
): Promise<BufferProcessResult> {
  const environment: NodeJS.ProcessEnv = {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PYTHONUTF8: "1",
    ...options.env,
  };
  if (process.env.PATH !== undefined && environment.PATH === undefined) {
    environment.PATH = process.env.PATH;
  }
  if (process.env.TMPDIR !== undefined && environment.TMPDIR === undefined) {
    environment.TMPDIR = process.env.TMPDIR;
  }
  return runTrustedProcess(command, args, {
    cwd: options.cwd,
    env: environment,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.input === undefined ? {} : { input: options.input }),
  }).then((result) => {
    const exitCode = result.exitCode ?? 1;
    if (result.cancelled) {
      const error = new Error(`${command} ${args.join(" ")} was cancelled.`);
      error.name = "AbortError";
      throw error;
    }
    if (result.signal !== null || exitCode !== 0) {
      throw new Error(
        `${command} ${args.join(" ")} failed${result.signal === null ? ` with exit ${exitCode}` : ` from ${result.signal}`}: ${result.stderr.toString("utf8").trim()}`,
      );
    }
    return { exitCode, stdout: result.stdout, stderr: result.stderr };
  });
}

async function pythonExecutable(root: string): Promise<string> {
  const candidate = join(root, "python", ".venv", "bin", "python");
  try {
    await access(candidate);
  } catch {
    throw new Error(
      "Python environment is missing; run `uv sync --offline --frozen --project python`.",
    );
  }
  return candidate;
}

export async function runPythonJson(
  root: string,
  module: string,
  args: readonly string[],
  signal?: AbortSignal,
  input?: string | Buffer,
): Promise<Record<string, unknown>> {
  const result = await runProcess(await pythonExecutable(root), ["-m", module, ...args], {
    cwd: root,
    ...(signal === undefined ? {} : { signal }),
    ...(input === undefined ? {} : { input }),
  });
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${module} returned invalid JSON: ${detail}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${module} must return one JSON object.`);
  }
  return value as Record<string, unknown>;
}

export async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not valid JSON: ${detail}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function absoluteFrom(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

export async function appendTraceEvent(
  tracePath: string,
  kind: string,
  data: unknown,
): Promise<void> {
  const log = await JsonlObservationLog.open(tracePath);
  await log.append(kind, data);
}
