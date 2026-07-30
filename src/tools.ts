import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ActivityBus, type ActivityEvent } from "./activity.js";
import type { AgentId } from "./model.js";
import {
  type AgentSandboxLease,
  type CommandSandbox,
  type SandboxCommandResult,
} from "./sandbox/contracts.js";
import {
  executePublishedSolver,
  PublishedSolverInfrastructureError,
  PublishedSolverSubmissionError,
  withPublishedMainSnapshot,
} from "./published-solver.js";
import { type ReleasedStage, writeCanonicalReleasedCiphertext } from "./released-stage.js";
import type { TeamChannel } from "./team-channel.js";

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

async function checkPublishedSolver(
  options: {
    agentId: AgentId;
    repositoryPath: string;
    solverSandbox: CommandSandbox;
    checker: CheckerHook;
    commandTimeoutMs: number;
  },
  releasedStages: readonly ReleasedStage[],
  signal?: AbortSignal,
): Promise<unknown> {
  const checkRoot = await mkdtemp(join(tmpdir(), "palimpsest-published-check-"));
  const snapshotPath = join(checkRoot, "submission");
  const outputRoot = join(checkRoot, "output");
  const ciphertextPath = join(checkRoot, "ciphertext.txt");
  const deadline = performance.now() + options.commandTimeoutMs;
  let outcome: unknown;
  let operationFailure: { error: unknown } | undefined;
  try {
    outcome = await withPublishedMainSnapshot(
      {
        repositoryPath: options.repositoryPath,
        snapshotPath,
        deadline,
        ...(signal === undefined ? {} : { signal }),
      },
      async (snapshot) => {
        await mkdir(outputRoot);
        await writeCanonicalReleasedCiphertext(releasedStages, ciphertextPath);
        const result = await executePublishedSolver({
          snapshot,
          ciphertextPath,
          outputRoot,
          sandbox: options.solverSandbox,
          timeoutMs: Math.max(1, Math.ceil(deadline - performance.now())),
          ...(signal === undefined ? {} : { signal }),
        });
        if (result.kind === "submission-error") {
          return {
            commit: snapshot.commit,
            error: result.error,
            execution: executionSummary(result.execution),
          };
        }
        const stageOrdinals = releasedStages.map(({ ordinal }) => ordinal);
        const score = await options.checker({
          agentId: options.agentId,
          candidatePath: result.outputPath,
          releasedStages: stageOrdinals,
          ...(signal === undefined ? {} : { signal }),
        });
        return { commit: snapshot.commit, ...score };
      },
    );
  } catch (error) {
    if (error instanceof PublishedSolverSubmissionError) {
      outcome = { error: error.message };
    } else {
      operationFailure = { error };
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
  activity: ActivityBus;
  teamChannel?: TeamChannel;
  checker: CheckerHook;
  getReleasedStages: () => readonly ReleasedStage[];
  getActivityCursor: () => number;
  setActivityCursor?: (sequence: number) => void;
  commandTimeoutMs?: number;
}): AgentToolSet {
  const definitions =
    options.teamChannel === undefined
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
            agentId: options.agentId,
            repositoryPath: options.repositoryPath,
            solverSandbox: options.solverSandbox,
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
      if (name === "post_team_message") {
        if (options.teamChannel === undefined) {
          throw new Error("Team channel is unavailable in this attempt.");
        }
        if (Object.keys(input).some((key) => key !== "message")) {
          throw new Error("post_team_message accepts only message.");
        }
        if (typeof input.message !== "string") {
          throw new Error("post_team_message requires message text.");
        }
        return options.teamChannel.post(options.agentId, input.message);
      }
      if (name === "read_team_messages") {
        if (options.teamChannel === undefined) {
          throw new Error("Team channel is unavailable in this attempt.");
        }
        if (
          Object.keys(input).some((key) => key !== "afterSequence") ||
          !Number.isSafeInteger(input.afterSequence) ||
          (input.afterSequence as number) < 0
        ) {
          throw new Error("read_team_messages requires a non-negative afterSequence.");
        }
        return options.teamChannel.read(input.afterSequence as number);
      }
      throw new Error(`Unknown agent tool: ${name}`);
    },
  };
}
