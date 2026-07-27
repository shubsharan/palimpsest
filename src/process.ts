import { spawn, type ChildProcess } from "node:child_process";

export interface ProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  deadline?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  stdio?: "capture" | "inherit";
}

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  cancelled: boolean;
  outputExceeded: boolean;
}

function terminateProcessGroup(child: ChildProcess): void {
  if (child.pid !== undefined && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The group can disappear between observing the child and terminating it.
    }
  }
  child.kill("SIGKILL");
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  if (
    options.deadline !== undefined &&
    (!Number.isFinite(options.deadline) || options.deadline < 0)
  ) {
    throw new Error("Process deadline must be a finite monotonic timestamp.");
  }
  if (
    options.maxOutputBytes !== undefined &&
    (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 0)
  ) {
    throw new Error("Process output limit must be a non-negative safe integer.");
  }

  return new Promise((resolveResult, reject) => {
    const capture = options.stdio !== "inherit";
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env ?? {},
      stdio: [
        options.input === undefined ? "ignore" : "pipe",
        capture ? "pipe" : "inherit",
        capture ? "pipe" : "inherit",
      ],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let capturedBytes = 0;
    let timedOut = false;
    let cancelled = false;
    let outputExceeded = false;
    let stopping = false;
    let settled = false;

    const stop = () => {
      if (stopping) return;
      stopping = true;
      terminateProcessGroup(child);
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      const limit = options.maxOutputBytes;
      if (limit === undefined) {
        target.push(chunk);
        return;
      }
      const remaining = limit - capturedBytes;
      if (remaining > 0) {
        const retained = chunk.subarray(0, remaining);
        target.push(retained);
        capturedBytes += retained.byteLength;
      }
      if (chunk.byteLength > remaining) {
        outputExceeded = true;
        stop();
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.stdin?.end(options.input);

    const abort = () => {
      cancelled = true;
      stop();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();

    const remainingMs =
      options.deadline === undefined
        ? undefined
        : Math.max(0, options.deadline - performance.now());
    const timer =
      remainingMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            stop();
          }, remainingMs);
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      finish();
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      finish();
      resolveResult({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut,
        cancelled,
        outputExceeded,
      });
    });
  });
}
