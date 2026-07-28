import { describe, expect, it, vi } from "vitest";

import { decodeAttemptSummary } from "./artifacts.js";
import type { ModelAdapter, ModelSession, ModelTurn } from "./model.js";
import { SANDBOX_IMAGE_TAG, SANDBOX_POLICY } from "./sandbox/contracts.js";
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

  it("keeps an absent final response absent in the persisted session shape", async () => {
    const result = await runAgentSession({
      agentId: "agent-1",
      prompt: "solve",
      adapter: adapterWith({
        respond: async () => ({
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      }),
      tools: createTools(),
      tokenBudget: 20,
      signal: new AbortController().signal,
      getActivityCursor: () => 0,
    });

    expect(result).toEqual({
      agentId: "agent-1",
      state: "finished",
      inputTokens: 1,
      outputTokens: 1,
      activityCursor: 0,
      terminationReason: "voluntary final response",
    });
    expect(result).not.toHaveProperty("finalResponse");

    const summary = decodeAttemptSummary({
      attemptId: "attempt-no-text",
      buildRoot: "/tmp/build",
      tracePath: "/tmp/attempt/trace.jsonl",
      traceMetadataPath: "/tmp/attempt/trace.meta.json",
      frozenRoot: "/tmp/attempt/frozen",
      sandbox: {
        imageTag: SANDBOX_IMAGE_TAG,
        imageId: `sha256:${"1".repeat(64)}`,
        sourceDigest: "2".repeat(64),
        profileVersion: 1,
        ...SANDBOX_POLICY,
      },
      sessions: [result, { ...result, agentId: "agent-2" }, { ...result, agentId: "agent-3" }],
    });
    expect(summary.sessions[0]).not.toHaveProperty("finalResponse");
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
