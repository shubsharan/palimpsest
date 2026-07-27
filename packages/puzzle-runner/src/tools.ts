import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { ActivityBus, type ActivityEvent } from "./activity.js";
import type { AgentId } from "./config.js";

export interface ToolDefinition {
  name: "run_command" | "check_reconstruction" | "wait_for_activity";
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "run_command",
    description: "Execute a local shell command in your workspace.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "integer", minimum: 1 },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "check_reconstruction",
    description:
      "Compare a candidate file with your currently visible private evidence and receive aggregate metrics.",
    inputSchema: {
      type: "object",
      properties: { candidatePath: { type: "string" } },
      required: ["candidatePath"],
      additionalProperties: false,
    },
  },
  {
    name: "wait_for_activity",
    description: "Wait until new private evidence or shared Git activity is available.",
    inputSchema: {
      type: "object",
      properties: { afterSequence: { type: "integer", minimum: 0 } },
      required: ["afterSequence"],
      additionalProperties: false,
    },
  },
];

export interface LocalCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function localEnvironment(extra: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
  for (const key of ["PATH", "TMPDIR"] as const) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return { ...environment, ...extra };
}

function killProcess(child: ReturnType<typeof spawn>): void {
  if (child.pid !== undefined && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The child may already have exited between the timeout and this signal.
    }
  }
  child.kill("SIGKILL");
}

export function executeLocalCommand(options: {
  command: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
}): Promise<LocalCommandResult> {
  if (
    options.command.length === 0 ||
    options.command.length > 32_768 ||
    options.command.includes("\0")
  ) {
    throw new Error("Command must contain between 1 and 32768 non-NUL characters.");
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("Command timeout must be a positive safe integer.");
  }
  const maxOutputBytes = options.maxOutputBytes ?? 4 * 1024 * 1024;
  return new Promise((resolveResult, reject) => {
    const child = spawn("/bin/sh", ["-lc", options.command], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: localEnvironment(options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;

    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        outputExceeded = true;
        killProcess(child);
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));

    const timeout = setTimeout(() => {
      timedOut = true;
      killProcess(child);
    }, options.timeoutMs);
    const abort = () => killProcess(child);
    options.signal?.addEventListener("abort", abort, { once: true });

    child.once("error", (error) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (settled) return;
      settled = true;
      const suffix = outputExceeded ? "\nCommand output exceeded the host safety limit." : "";
      resolveResult({
        exitCode: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}${suffix}`,
        timedOut,
      });
    });
  });
}

export interface CheckerMetrics {
  matchedWords: number;
  totalWords: number;
  coverage: number;
  accuracy: number;
}

export type CheckerResult = CheckerMetrics | { error: string };

export type CheckerHook = (request: {
  agentId: AgentId;
  candidatePath: string;
  releasedStages: readonly number[];
  signal?: AbortSignal;
}) => Promise<CheckerResult>;

export interface AgentToolSet {
  definitions: readonly ToolDefinition[];
  execute(name: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
}

function requireObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object.");
  }
  return input as Record<string, unknown>;
}

async function resolveCandidate(workspacePath: string, candidatePath: unknown): Promise<string> {
  if (
    typeof candidatePath !== "string" ||
    candidatePath.length === 0 ||
    isAbsolute(candidatePath)
  ) {
    throw new Error("candidatePath must be a non-empty path relative to the workspace.");
  }
  const workspace = await realpath(workspacePath);
  const candidate = resolve(workspace, candidatePath);
  const difference = relative(workspace, candidate);
  if (
    difference === ".." ||
    difference.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error("candidatePath must remain inside the workspace.");
  }
  return candidate;
}

function activitySummary(event: ActivityEvent): string {
  return event.kind === "stage-released"
    ? "new private evidence is available"
    : "shared Git activity is available";
}

export function createAgentTools(options: {
  agentId: AgentId;
  workspacePath: string;
  activity: ActivityBus;
  checker: CheckerHook;
  getReleasedStages: () => readonly number[];
  getActivityCursor: () => number;
  setActivityCursor?: (sequence: number) => void;
  commandTimeoutMs?: number;
}): AgentToolSet {
  return {
    definitions: TOOL_DEFINITIONS,
    async execute(name, rawInput, signal) {
      const input = requireObject(rawInput);
      if (name === "run_command") {
        if (typeof input.command !== "string") throw new Error("run_command requires command.");
        const requestedTimeout = input.timeoutMs ?? options.commandTimeoutMs ?? 30_000;
        if (!Number.isSafeInteger(requestedTimeout) || (requestedTimeout as number) <= 0) {
          throw new Error("run_command timeoutMs must be a positive safe integer.");
        }
        return executeLocalCommand({
          command: input.command,
          cwd: options.workspacePath,
          timeoutMs: requestedTimeout as number,
          ...(signal === undefined ? {} : { signal }),
        });
      }
      if (name === "check_reconstruction") {
        const candidatePath = await resolveCandidate(options.workspacePath, input.candidatePath);
        return options.checker({
          agentId: options.agentId,
          candidatePath,
          releasedStages: options.getReleasedStages(),
          ...(signal === undefined ? {} : { signal }),
        });
      }
      if (name === "wait_for_activity") {
        if (!Number.isSafeInteger(input.afterSequence) || (input.afterSequence as number) < 0) {
          throw new Error("wait_for_activity afterSequence must be a non-negative safe integer.");
        }
        const afterSequence = Math.max(input.afterSequence as number, options.getActivityCursor());
        const result = await options.activity.waitForVisible(
          options.agentId,
          afterSequence,
          signal,
        );
        if ("ended" in result) return result;
        options.setActivityCursor?.(result.sequence);
        return {
          sequence: result.sequence,
          kind: result.kind,
          summary: activitySummary(result),
        };
      }
      throw new Error(`Unknown agent tool: ${name}`);
    },
  };
}
