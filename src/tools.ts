import { mkdtemp, rm } from "node:fs/promises";
import { basename, join, posix } from "node:path";

import { ActivityBus, type ActivityEvent } from "./activity.js";
import type { AgentId } from "./model.js";
import {
  SANDBOX_PATHS,
  type AgentSandboxLease,
  type SandboxCommandResult,
} from "./sandbox/contracts.js";

export interface ToolDefinition {
  name: "run_command" | "check_published_solver" | "wait_for_activity";
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
    name: "check_published_solver",
    description:
      "Run origin/main:solver.py against your currently visible private evidence and receive its commit and aggregate metrics.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "wait_for_activity",
    description: "Wait until new private evidence or Git activity is available.",
    inputSchema: {
      type: "object",
      properties: { afterSequence: { type: "integer", minimum: 0 } },
      required: ["afterSequence"],
      additionalProperties: false,
    },
  },
];

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

function failed(result: SandboxCommandResult): boolean {
  return (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.outputExceeded ||
    result.indeterminate === true
  );
}

function executionSummary(result: SandboxCommandResult): Readonly<Record<string, unknown>> {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    outputExceeded: result.outputExceeded,
    ...(result.indeterminate === true ? { indeterminate: true } : {}),
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function checkPublishedSolver(
  options: {
    agentId: AgentId;
    workspacePath: string;
    sandbox: AgentSandboxLease;
    checker: CheckerHook;
    commandTimeoutMs: number;
  },
  releasedStages: readonly number[],
  signal?: AbortSignal,
): Promise<unknown> {
  const checkRoot = await mkdtemp(join(options.workspacePath, ".palimpsest-check-"));
  const sandboxRoot = posix.join(SANDBOX_PATHS.workspace, basename(checkRoot));
  const repositoryPath = posix.join(sandboxRoot, "repository");
  const ciphertextPath = posix.join(sandboxRoot, "ciphertext.txt");
  const outputPath = posix.join(sandboxRoot, "reconstruction.txt");
  let commit: string | undefined;
  try {
    const checkout = await options.sandbox.execute({
      command: [
        "set -eu",
        `git clone --no-local --branch main --single-branch ${shellQuote(SANDBOX_PATHS.gitOrigin)} ${shellQuote(repositoryPath)} >/dev/null 2>&1`,
        `git -C ${shellQuote(repositoryPath)} rev-parse HEAD`,
      ].join("\n"),
      timeoutMs: options.commandTimeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });
    if (failed(checkout)) {
      return {
        error: "Published solver checkout failed.",
        execution: executionSummary(checkout),
      };
    }
    commit = checkout.stdout.trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) {
      return { error: "Published solver checkout returned an invalid commit identity." };
    }

    const visibleStages = releasedStages.map(
      (ordinal) => `${SANDBOX_PATHS.evidence}/stage-${String(ordinal).padStart(2, "0")}-*.txt`,
    );
    const execution = await options.sandbox.execute({
      command: [
        "set -eu",
        `cat ${visibleStages.join(" ")} > ${shellQuote(ciphertextPath)}`,
        `cd ${shellQuote(repositoryPath)}`,
        `PALIMPSEST_CIPHERTEXT=${shellQuote(ciphertextPath)} PALIMPSEST_OUTPUT=${shellQuote(outputPath)} python3 solver.py`,
        `test -f ${shellQuote(outputPath)}`,
      ].join("\n"),
      timeoutMs: options.commandTimeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });
    if (failed(execution)) {
      return {
        commit,
        error: "Published solver execution failed.",
        execution: executionSummary(execution),
      };
    }
    const score = await options.checker({
      agentId: options.agentId,
      candidatePath: join(checkRoot, "reconstruction.txt"),
      releasedStages,
      ...(signal === undefined ? {} : { signal }),
    });
    return { commit, ...score };
  } finally {
    await rm(checkRoot, { recursive: true, force: true });
  }
}

function activitySummary(event: ActivityEvent): string {
  return event.kind === "stage-released"
    ? "new private evidence is available"
    : "Git activity is available";
}

export function createAgentTools(options: {
  agentId: AgentId;
  workspacePath: string;
  sandbox: AgentSandboxLease;
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
        const request = {
          command: input.command,
          timeoutMs: requestedTimeout as number,
          ...(signal === undefined ? {} : { signal }),
        };
        return options.sandbox.execute(request) satisfies Promise<SandboxCommandResult>;
      }
      if (name === "check_published_solver") {
        if (Object.keys(input).length !== 0) {
          throw new Error("check_published_solver does not accept arguments.");
        }
        return checkPublishedSolver(
          {
            agentId: options.agentId,
            workspacePath: options.workspacePath,
            sandbox: options.sandbox,
            checker: options.checker,
            commandTimeoutMs: options.commandTimeoutMs ?? 30_000,
          },
          options.getReleasedStages(),
          signal,
        );
      }
      if (name === "wait_for_activity") {
        if (!Number.isSafeInteger(input.afterSequence) || (input.afterSequence as number) < 0) {
          throw new Error("wait_for_activity afterSequence must be a non-negative safe integer.");
        }
        const afterSequence = Math.max(input.afterSequence as number, options.getActivityCursor());
        const result = await options.activity.waitFor(afterSequence, signal);
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
