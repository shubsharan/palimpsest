import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActivityEvent } from "./activity.js";
import type { AgentAttemptHandle } from "./attempt-runtime.js";
import type { AgentId } from "./model.js";
import {
  type AgentSandboxLease,
  type CommandSandbox,
  InfrastructureError,
  type SandboxCommandResult,
} from "./sandbox/contracts.js";
import {
  PublishedSolverInfrastructureError,
  PublishedSolverSubmissionError,
  runPublishedSolver,
} from "./published-solver.js";
import { type ReleasedStage, writeCanonicalReleasedCiphertext } from "./released-stage.js";

export interface ToolDefinition {
  name:
    | "run_command"
    | "check_published_solver"
    | "wait_for_activity"
    | "post_team_message"
    | "read_team_messages";
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
      "Run origin/main:solver.py against your currently visible private evidence and receive execution, output-validity, word-count, and coverage feedback. This does not report correctness.",
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

const TEAM_CHANNEL_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "post_team_message",
    description: "Post a strategy or coordination message to the shared team channel.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string", minLength: 1, maxLength: 4_000 } },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "read_team_messages",
    description: "Read the next page of shared team messages after a message sequence.",
    inputSchema: {
      type: "object",
      properties: { afterSequence: { type: "integer", minimum: 0 } },
      required: ["afterSequence"],
      additionalProperties: false,
    },
  },
];

export interface CheckerCoverage {
  feedbackId: "published-runnability-coverage-v1";
  outputValidity: "valid" | "incomplete" | "malformed";
  ciphertextWords?: number;
  outputWords?: number;
  coverage?: number;
  error?: string;
}

export interface CheckerResult extends CheckerCoverage {
  executionStatus?: "succeeded";
}

export type CheckerHook = (request: {
  ciphertextPath: string;
  candidatePath: string;
  signal?: AbortSignal;
}) => Promise<CheckerResult>;

export interface PublishedCheckerFeedback {
  feedbackId: "published-runnability-coverage-v1";
  ref?: "refs/heads/main";
  commit?: string;
  executionStatus: "succeeded" | "failed" | "timed-out" | "oversized" | "indeterminate";
  outputValidity: "valid" | "missing" | "empty" | "malformed" | "oversized" | "incomplete";
  ciphertextWords?: number;
  outputWords?: number;
  coverage: number;
  error?: string;
  execution?: Readonly<Record<string, unknown>>;
}

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

function executionSummary(result: SandboxCommandResult): Readonly<Record<string, unknown>> {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    outputExceeded: result.outputExceeded,
    ...(result.outputFailure === undefined ? {} : { outputFailure: result.outputFailure }),
    ...(result.indeterminate === true ? { indeterminate: true } : {}),
  };
}

async function checkPublishedSolver(
  options: {
    repositoryPath: string;
    solverSandbox: CommandSandbox;
    checker: CheckerHook;
    commandTimeoutMs: number;
  },
  releasedStages: readonly ReleasedStage[],
  signal?: AbortSignal,
): Promise<unknown> {
  let checkRoot: string;
  try {
    checkRoot = await mkdtemp(join(tmpdir(), "palimpsest-published-check-"));
  } catch (error) {
    throw new PublishedSolverInfrastructureError(
      `Unable to create published-solver check root: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  const outputRoot = join(checkRoot, "output");
  const ciphertextPath = join(checkRoot, "ciphertext.txt");
  const deadline = performance.now() + options.commandTimeoutMs;
  let outcome: unknown;
  let operationFailure: { error: unknown } | undefined;
  try {
    await mkdir(outputRoot);
    await writeCanonicalReleasedCiphertext(releasedStages, ciphertextPath);
    const published = await runPublishedSolver({
      repositoryPath: options.repositoryPath,
      ciphertextPath,
      outputRoot,
      sandbox: options.solverSandbox,
      deadline,
      ...(signal === undefined ? {} : { signal }),
      evaluate: ({ outputPath }) =>
        options.checker({
          ciphertextPath,
          candidatePath: outputPath,
          ...(signal === undefined ? {} : { signal }),
        }),
    });
    outcome =
      published.kind === "succeeded"
        ? {
            ...published.value,
            ref: published.identity.ref,
            commit: published.identity.commit,
            executionStatus: "succeeded",
          }
        : {
            feedbackId: "published-runnability-coverage-v1",
            ref: published.identity.ref,
            commit: published.identity.commit,
            executionStatus: published.execution.timedOut
              ? "timed-out"
              : published.execution.outputExceeded
                ? "oversized"
                : published.execution.indeterminate === true
                  ? "indeterminate"
                  : "failed",
            outputValidity:
              published.error === "Published solver did not produce output."
                ? "missing"
                : published.error === "Published solver output is empty."
                  ? "empty"
                  : published.error.includes("exceeds")
                    ? "oversized"
                    : "malformed",
            coverage: 0,
            error: published.error,
            execution: executionSummary(published.execution),
          };
  } catch (error) {
    if (error instanceof PublishedSolverSubmissionError) {
      outcome = {
        feedbackId: "published-runnability-coverage-v1",
        executionStatus: "failed",
        outputValidity: "missing",
        coverage: 0,
        error: error.message,
      };
    } else {
      operationFailure = {
        error:
          error instanceof InfrastructureError || error instanceof DOMException
            ? error
            : new PublishedSolverInfrastructureError(
                `Trusted published-solver check failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
                { cause: error },
              ),
      };
    }
  }
  try {
    await rm(checkRoot, { recursive: true, force: true });
  } catch (error) {
    const cause =
      operationFailure === undefined
        ? error
        : new AggregateError(
            [operationFailure.error, error],
            "Published-solver operation and cleanup both failed.",
          );
    throw new PublishedSolverInfrastructureError(
      `Unable to clean published-solver check root: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause },
    );
  }
  if (operationFailure !== undefined) throw operationFailure.error;
  return outcome;
}

function activitySummary(event: ActivityEvent): string {
  switch (event.kind) {
    case "stage-released":
      return "new private evidence is available";
    case "git-changed":
      return "Git activity is available";
    case "team-message":
      return "new team discussion is available";
  }
}

export function createAgentTools(options: {
  agentId: AgentId;
  sandbox: AgentSandboxLease;
  solverSandbox: CommandSandbox;
  repositoryPath: string;
  attempt: AgentAttemptHandle;
  checker: CheckerHook;
  getActivityCursor: () => number;
  setActivityCursor?: (sequence: number) => void;
  commandTimeoutMs?: number;
}): AgentToolSet {
  const definitions =
    options.attempt.teamChannel === undefined
      ? TOOL_DEFINITIONS
      : [
          ...TOOL_DEFINITIONS.map((definition) =>
            definition.name === "wait_for_activity"
              ? {
                  ...definition,
                  description:
                    "Wait until new private evidence, Git activity, or team discussion is available.",
                }
              : definition,
          ),
          ...TEAM_CHANNEL_TOOL_DEFINITIONS,
        ];
  return {
    definitions,
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
            repositoryPath: options.repositoryPath,
            solverSandbox: options.solverSandbox,
            checker: options.checker,
            commandTimeoutMs: options.commandTimeoutMs ?? 30_000,
          },
          options.attempt.captureReleasedStages(),
          signal,
        );
      }
      if (name === "wait_for_activity") {
        if (!Number.isSafeInteger(input.afterSequence) || (input.afterSequence as number) < 0) {
          throw new Error("wait_for_activity afterSequence must be a non-negative safe integer.");
        }
        const afterSequence = Math.max(input.afterSequence as number, options.getActivityCursor());
        const result = await options.attempt.waitForActivity(afterSequence, signal);
        if ("ended" in result) return result;
        options.setActivityCursor?.(result.sequence);
        return {
          sequence: result.sequence,
          kind: result.kind,
          summary: activitySummary(result),
        };
      }
      if (name === "post_team_message") {
        if (options.attempt.teamChannel === undefined) {
          throw new Error("Team channel is unavailable in this attempt.");
        }
        if (Object.keys(input).some((key) => key !== "message")) {
          throw new Error("post_team_message accepts only message.");
        }
        if (typeof input.message !== "string") {
          throw new Error("post_team_message requires message text.");
        }
        return options.attempt.teamChannel.post(input.message, signal);
      }
      if (name === "read_team_messages") {
        if (options.attempt.teamChannel === undefined) {
          throw new Error("Team channel is unavailable in this attempt.");
        }
        if (
          Object.keys(input).some((key) => key !== "afterSequence") ||
          !Number.isSafeInteger(input.afterSequence) ||
          (input.afterSequence as number) < 0
        ) {
          throw new Error("read_team_messages requires a non-negative afterSequence.");
        }
        return options.attempt.teamChannel.read(input.afterSequence as number);
      }
      throw new Error(`Unknown agent tool: ${name}`);
    },
  };
}
