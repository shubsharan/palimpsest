import { describe, expect, it, vi } from "vitest";

import type { ModelAdapter, ModelSession, ModelTurn } from "./model.js";
import { runAgentSession } from "./session.js";
import type { AgentToolSet } from "./tools.js";

function createTools(): AgentToolSet {
  return {
    definitions: [],
    execute: vi.fn(async (_name: string, input: unknown) => ({ input })),
  };
}

function adapterWith(session: ModelSession): ModelAdapter {
  return {
    openSession: () => session,
  };
}

describe("model session lifecycle", () => {
  it("keeps one model session across tool activity and a voluntary final response", async () => {
    const tools = createTools();
    const requests: unknown[] = [];
    const turns: ModelTurn[] = [
      {
        toolCalls: [{ id: "call-1", name: "wait_for_activity", arguments: { afterSequence: 0 } }],
        usage: { inputTokens: 3, outputTokens: 2 },
      },
      {
        toolCalls: [],
        finalResponse: "finished",
        usage: { inputTokens: 2, outputTokens: 1 },
      },
    ];
    const observe = vi.fn();
    const session: ModelSession = {
      async respond(request) {
        requests.push(request);
        const turn = turns.shift();
        if (turn === undefined) throw new Error("Unexpected model turn.");
        return turn;
      },
    };

    await expect(
      runAgentSession({
        agentId: "agent-1",
        prompt: "solve",
        adapter: adapterWith(session),
        tools,
        tokenBudget: 20,
        signal: new AbortController().signal,
        getActivityCursor: () => 7,
        observe,
      }),
    ).resolves.toEqual({
      agentId: "agent-1",
      state: "finished",
      inputTokens: 5,
      outputTokens: 3,
      activityCursor: 7,
      finalResponse: "finished",
      terminationReason: "voluntary final response",
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ prompt: "solve", toolResults: [] });
    expect(requests[1]).toMatchObject({
      toolResults: [{ callId: "call-1", output: { input: { afterSequence: 0 } } }],
    });
    expect(observe).toHaveBeenCalledWith(
      "session.state",
      { previous: "working", state: "waiting", reason: undefined },
      "agent-1",
    );
    expect(observe).toHaveBeenCalledWith(
      "session.state",
      { previous: "waiting", state: "working", reason: undefined },
      "agent-1",
    );
    expect(observe).toHaveBeenCalledWith(
      "session.state",
      { previous: "working", state: "finished", reason: "voluntary final response" },
      "agent-1",
    );
  });

  it("stops at the cumulative model-token boundary and cancels the session", async () => {
    const tools = createTools();
    const cancel = vi.fn();
    const session: ModelSession = {
      respond: async () => ({
        toolCalls: [{ id: "unused", name: "inspect", arguments: {} }],
        usage: { inputTokens: 6, outputTokens: 4 },
      }),
      cancel,
    };

    await expect(
      runAgentSession({
        agentId: "agent-2",
        prompt: "solve",
        adapter: adapterWith(session),
        tools,
        tokenBudget: 10,
        signal: new AbortController().signal,
        getActivityCursor: () => 0,
      }),
    ).resolves.toMatchObject({
      state: "token-exhausted",
      inputTokens: 6,
      outputTokens: 4,
      terminationReason: "cumulative model-token cutoff",
    });
    expect(tools.execute).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith("token-exhausted");
  });

  it("aborts a pending model response at the wall-time boundary", async () => {
    const tools = createTools();
    const controller = new AbortController();
    const cancel = vi.fn();
    let markResponding: (() => void) | undefined;
    const responding = new Promise<void>((resolve) => {
      markResponding = resolve;
    });
    const session: ModelSession = {
      respond: async () => {
        markResponding?.();
        return new Promise<ModelTurn>(() => undefined);
      },
      cancel,
    };
    const result = runAgentSession({
      agentId: "agent-3",
      prompt: "solve",
      adapter: adapterWith(session),
      tools,
      tokenBudget: 20,
      signal: controller.signal,
      getActivityCursor: () => 2,
    });

    await responding;
    controller.abort();

    await expect(result).resolves.toMatchObject({
      state: "time-exhausted",
      inputTokens: 0,
      outputTokens: 0,
      activityCursor: 2,
      terminationReason: "global wall-time cutoff",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith("time-exhausted");
  });

  it("classifies model-session construction failures as infrastructure errors", async () => {
    const tools = createTools();
    const adapter: ModelAdapter = {
      openSession() {
        throw new Error("provider unavailable");
      },
    };

    await expect(
      runAgentSession({
        agentId: "agent-1",
        prompt: "solve",
        adapter,
        tools,
        tokenBudget: 20,
        signal: new AbortController().signal,
        getActivityCursor: () => 0,
      }),
    ).resolves.toMatchObject({
      state: "infrastructure-error",
      terminationReason: "provider unavailable",
    });
  });
});
