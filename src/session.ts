import type { AgentId } from "./model.js";
import type { ModelAdapter, ModelRequest, ModelToolResult, TokenUsage } from "./model.js";
import { SandboxInfrastructureError } from "./sandbox/contracts.js";
import type { AgentToolSet } from "./tools.js";

export type SessionState =
  | "working"
  | "waiting"
  | "finished"
  | "token-exhausted"
  | "time-exhausted"
  | "infrastructure-error";

export interface AgentSessionResult {
  agentId: AgentId;
  state: SessionState;
  inputTokens: number;
  outputTokens: number;
  activityCursor: number;
  finalResponse?: string;
  terminationReason: string;
}

export type SessionObserver = (
  kind: string,
  data: unknown,
  agentId: AgentId,
) => void | Promise<void>;

function validateUsage(usage: TokenUsage): void {
  for (const [key, value] of Object.entries(usage)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Adapter ${key} must be a non-negative safe integer.`);
    }
  }
}

class SessionAbortedError extends Error {}

function awaitWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new SessionAbortedError("Session aborted."));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new SessionAbortedError("Session aborted."));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function runAgentSession(options: {
  agentId: AgentId;
  prompt: string;
  adapter: ModelAdapter;
  tools: AgentToolSet;
  tokenBudget: number;
  signal: AbortSignal;
  getActivityCursor: () => number;
  observe?: SessionObserver;
}): Promise<AgentSessionResult> {
  let state: SessionState = "working";
  let inputTokens = 0;
  let outputTokens = 0;
  let finalResponse: string | undefined;
  let terminationReason = "";

  const observe = async (kind: string, data: unknown) => {
    await options.observe?.(kind, data, options.agentId);
  };
  const transition = async (next: SessionState, reason?: string) => {
    if (state !== next) {
      const previous = state;
      state = next;
      await observe("session.state", { previous, state: next, reason });
    }
    if (reason !== undefined) terminationReason = reason;
  };
  const currentState = (): SessionState => state;

  await observe("session.started", { tokenBudget: options.tokenBudget });
  let model;
  try {
    model = await options.adapter.openSession({
      agentId: options.agentId,
      tools: options.tools.definitions,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await transition("infrastructure-error", detail);
    return {
      agentId: options.agentId,
      state,
      inputTokens,
      outputTokens,
      activityCursor: options.getActivityCursor(),
      terminationReason,
    };
  }

  let request: ModelRequest = {
    prompt: options.prompt,
    toolResults: [],
    signal: options.signal,
  };
  while (state === "working") {
    if (options.signal.aborted) {
      await transition("time-exhausted", "global wall-time cutoff");
      break;
    }
    let turn;
    try {
      turn = await awaitWithAbort(model.respond(request), options.signal);
      validateUsage(turn.usage);
    } catch (error) {
      if (options.signal.aborted) {
        await transition("time-exhausted", "global wall-time cutoff");
      } else {
        const detail = error instanceof Error ? error.message : String(error);
        await transition("infrastructure-error", detail);
      }
      break;
    }

    inputTokens += turn.usage.inputTokens;
    outputTokens += turn.usage.outputTokens;
    await observe("model.response", {
      usage: turn.usage,
      cumulativeUsage: { inputTokens, outputTokens },
      toolCalls: turn.toolCalls.map((call) => ({ id: call.id, name: call.name })),
      finalResponse: turn.finalResponse,
    });

    if (inputTokens + outputTokens >= options.tokenBudget) {
      await transition("token-exhausted", "cumulative model-token cutoff");
      await model.cancel?.("token-exhausted");
      break;
    }
    if (turn.toolCalls.length === 0) {
      finalResponse = turn.finalResponse;
      await transition("finished", "voluntary final response");
      break;
    }

    const toolResults: ModelToolResult[] = [];
    for (const call of turn.toolCalls) {
      if (options.signal.aborted) {
        await transition("time-exhausted", "global wall-time cutoff");
        break;
      }
      const waiting = call.name === "wait_for_activity";
      if (waiting) await transition("waiting");
      await observe("tool.started", { id: call.id, name: call.name, arguments: call.arguments });
      let output: unknown;
      try {
        output = await awaitWithAbort(
          options.tools.execute(call.name, call.arguments, options.signal),
          options.signal,
        );
      } catch (error) {
        if (options.signal.aborted) {
          await transition("time-exhausted", "global wall-time cutoff");
          break;
        }
        const detail = error instanceof Error ? error.message : String(error);
        if (error instanceof SandboxInfrastructureError) {
          await observe("infrastructure.error", {
            component: "command-sandbox",
            error: detail,
          });
          await transition("infrastructure-error", detail);
          break;
        }
        output = { error: detail };
        await observe("tool.error", { id: call.id, name: call.name, error: detail });
      }
      if (
        waiting &&
        typeof output === "object" &&
        output !== null &&
        "ended" in output &&
        output.ended === true
      ) {
        await transition("time-exhausted", "global wall-time cutoff");
        break;
      }
      if (waiting) await transition("working");
      await observe("tool.completed", { id: call.id, name: call.name, output });
      toolResults.push({ callId: call.id, output });
    }
    if (currentState() !== "working") break;
    request = {
      toolResults,
      signal: options.signal,
    };
  }

  if (currentState() === "time-exhausted") await model.cancel?.("time-exhausted");
  const common = {
    agentId: options.agentId,
    state,
    inputTokens,
    outputTokens,
    activityCursor: options.getActivityCursor(),
    terminationReason,
  };
  return finalResponse === undefined ? common : { ...common, finalResponse };
}
