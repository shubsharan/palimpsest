import { spawn } from "node:child_process";
import { access, appendFile, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  const start = argv[0] === "--" ? 1 : 0;
  for (let index = start; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === undefined || !name.startsWith("--")) {
      throw new Error(`Expected an option name, received ${name ?? "end of input"}.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    if (flags.has(name)) throw new Error(`${name} may be provided only once.`);
    flags.set(name, value);
    index += 1;
  }
  return flags;
}

export function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function integerFlag(
  flags: ReadonlyMap<string, string>,
  name: string,
  fallback?: number,
): number {
  const raw = flags.get(name);
  if (raw === undefined && fallback !== undefined) return fallback;
  if (raw === undefined || !/^-?\d+$/.test(raw)) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer.`);
  return value;
}

export function numberFlag(
  flags: ReadonlyMap<string, string>,
  name: string,
  fallback?: number,
): number {
  const raw = flags.get(name);
  if (raw === undefined && fallback !== undefined) return fallback;
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: { cwd: string; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const result = {
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (signal !== null || result.exitCode !== 0) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed${signal === null ? ` with exit ${result.exitCode}` : ` from ${signal}`}: ${result.stderr.trim()}`,
          ),
        );
        return;
      }
      resolveResult(result);
    });
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
): Promise<Record<string, unknown>> {
  const result = await runProcess(await pythonExecutable(root), ["-m", module, ...args], {
    cwd: root,
    ...(signal === undefined ? {} : { signal }),
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
  const source = await readFile(tracePath, "utf8");
  const lines = source.split("\n").filter((line) => line.length > 0);
  const last = lines.at(-1);
  const sequence =
    last === undefined
      ? 1
      : ((JSON.parse(last) as { sequence?: number }).sequence ?? lines.length) + 1;
  await appendFile(tracePath, `${JSON.stringify({ sequence, atMs: 0, kind, data })}\n`, "utf8");
}
