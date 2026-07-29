import { ActivityBus, type ActivityEvent } from "./activity.js";
import type { AgentId } from "./model.js";
import type { AgentSandboxLease, SandboxCommandResult } from "./sandbox/contracts.js";
import { resolveWorkspaceRegularFile } from "./sandbox/workspace.js";

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

async function resolveCandidate(workspacePath: string, candidatePath: unknown): Promise<string> {
  if (typeof candidatePath !== "string") {
    throw new Error("candidatePath must be a non-empty path relative to the workspace.");
  }
  return resolveWorkspaceRegularFile(workspacePath, candidatePath, "candidatePath");
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
