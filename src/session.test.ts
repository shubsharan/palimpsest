import { describe, expect, it, vi } from "vitest";

import type { ModelAdapter, ModelBinding, ModelSession, ModelTurn } from "./model.js";
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

function binding(profile = "research-model"): ModelBinding {
  return {
    profile,
    provider: "research-provider",
    driver: "openai-compatible",
    requestedModel: "requested-model",
    settings: { temperature: 0.2 },
    providerOptions: {},
  };
}

describe("model session lifecycle", () => {
  it("keeps one session and records normalized usage plus actual response identity", async () => {
    const tools = createTools();
    const requests: unknown[] = [];
    const turns: ModelTurn[] = [
      {
        toolCalls: [{ id: "call-1", name: "wait_for_activity", arguments: { afterSequence: 0 } }],
        reasoningSummary: "I should inspect new activity before proceeding.",
        returnedReasoningSummary: {
          status: "captured",
          items: [
            {
              id: "rs_1",
              summary: [
                {
                  type: "summary_text",
                  text: "I should inspect new activity before proceeding.",
                },
              ],
            },
          ],
        },
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          inputTokenDetails: { cacheReadTokens: 2, noCacheTokens: 1 },
          outputTokenDetails: { reasoningTokens: 1, textTokens: 1 },
        },
        responseIdentity: {
          actualProvider: "compatible-cloud",
          actualModel: "routed-model-2026-07",
        },
      },
      {
        toolCalls: [],
        finalResponse: "finished",
        usage: { inputTokens: 2, outputTokens: 1 },
        responseIdentity: {
          actualProvider: "compatible-cloud",
          actualModel: "routed-model-2026-07",
        },
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
        model: binding(),
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
      model: {
        ...binding(),
        actualProvider: "compatible-cloud",
        actualModel: "routed-model-2026-07",
      },
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
      "model.response",
      expect.objectContaining({
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          inputTokenDetails: { cacheReadTokens: 2, noCacheTokens: 1 },
          outputTokenDetails: { reasoningTokens: 1, textTokens: 1 },
        },
        responseIdentity: {
          actualProvider: "compatible-cloud",
          actualModel: "routed-model-2026-07",
        },
        reasoningSummary: "I should inspect new activity before proceeding.",
        returnedReasoningSummary: {
          status: "captured",
          items: [
            {
              id: "rs_1",
              summary: [
                {
                  type: "summary_text",
                  text: "I should inspect new activity before proceeding.",
                },
              ],
            },
          ],
        },
      }),
      "agent-1",
    );
  });

  it("keeps absent final text absent in the session result", async () => {
    const result = await runAgentSession({
      agentId: "agent-1",
      model: binding(),
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

    expect(result).not.toHaveProperty("finalResponse");
    expect(result).not.toHaveProperty("finalResponse");
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
        model: binding(),
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
    expect(cancel).toHaveBeenCalledWith("token-exhausted");
  });

  it("observes token usage without terminating when the token budget is disabled", async () => {
    const tools = createTools();
    const turns: ModelTurn[] = [
      {
        toolCalls: [{ id: "inspect-1", name: "inspect", arguments: {} }],
        usage: { inputTokens: 600_000, outputTokens: 400_000 },
      },
      {
        toolCalls: [],
        finalResponse: "finished after the observed high-usage turn",
        usage: { inputTokens: 2, outputTokens: 1 },
      },
    ];
    const cancel = vi.fn();

    await expect(
      runAgentSession({
        agentId: "agent-2",
        model: binding(),
        prompt: "solve",
        adapter: adapterWith({
          respond: async () => {
            const turn = turns.shift();
            if (turn === undefined) throw new Error("Unexpected model turn.");
            return turn;
          },
          cancel,
        }),
        tools,
        tokenBudget: null,
        signal: new AbortController().signal,
        getActivityCursor: () => 0,
      }),
    ).resolves.toMatchObject({
      state: "finished",
      inputTokens: 600_002,
      outputTokens: 400_001,
      terminationReason: "voluntary final response",
    });
    expect(tools.execute).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("aborts a pending model response at the wall-time boundary", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    let markResponding: (() => void) | undefined;
    const responding = new Promise<void>((resolve) => {
      markResponding = resolve;
    });
    const result = runAgentSession({
      agentId: "agent-3",
      model: binding(),
      prompt: "solve",
      adapter: adapterWith({
        respond: async () => {
          markResponding?.();
          return new Promise<ModelTurn>(() => undefined);
        },
        cancel,
      }),
      tools: createTools(),
      tokenBudget: 20,
      signal: controller.signal,
      getActivityCursor: () => 2,
    });

    await responding;
    controller.abort();

    await expect(result).resolves.toMatchObject({
      state: "time-exhausted",
      activityCursor: 2,
      terminationReason: "global wall-time cutoff",
    });
    expect(cancel).toHaveBeenCalledWith("time-exhausted");
  });

  it("traces a recovered indeterminate command and lets the model continue", async () => {
    const turns: ModelTurn[] = [
      {
        toolCalls: [{ id: "command-1", name: "run_command", arguments: { command: "work" } }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        toolCalls: [],
        finalResponse: "inspected and recovered",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ];
    const observe = vi.fn();
    const tools: AgentToolSet = {
      definitions: [],
      execute: async () => ({
        exitCode: null,
        stdout: "",
        stderr: "The interrupted command was not replayed.",
        timedOut: false,
        outputExceeded: false,
        indeterminate: true,
        sandboxGeneration: 2,
      }),
    };

    await expect(
      runAgentSession({
        agentId: "agent-1",
        model: binding(),
        prompt: "solve",
        adapter: adapterWith({
          async respond() {
            const turn = turns.shift();
            if (turn === undefined) throw new Error("Unexpected model turn.");
            return turn;
          },
        }),
        tools,
        tokenBudget: 20,
        signal: new AbortController().signal,
        getActivityCursor: () => 0,
        observe,
      }),
    ).resolves.toMatchObject({
      state: "finished",
      finalResponse: "inspected and recovered",
    });
    expect(observe).toHaveBeenCalledWith(
      "sandbox.recovered",
      { callId: "command-1", sandboxGeneration: 2 },
      "agent-1",
    );
  });

  it("returns provider construction failures with requested model metadata intact", async () => {
    const model = binding("unavailable-provider-model");
    const adapter: ModelAdapter = {
      openSession() {
        throw new Error("provider unavailable");
      },
    };

    await expect(
      runAgentSession({
        agentId: "agent-1",
        model,
        prompt: "solve",
        adapter,
        tools: createTools(),
        tokenBudget: 20,
        signal: new AbortController().signal,
        getActivityCursor: () => 0,
      }),
    ).resolves.toMatchObject({
      model,
      state: "infrastructure-error",
      terminationReason: "provider unavailable",
    });
  });

  it("classifies missing provider usage as an infrastructure failure", async () => {
    await expect(
      runAgentSession({
        agentId: "agent-1",
        model: binding(),
        prompt: "solve",
        adapter: adapterWith({
          respond: async () => ({
            toolCalls: [],
            usage: { inputTokens: undefined, outputTokens: 1 },
          }),
        } as never),
        tools: createTools(),
        tokenBudget: 20,
        signal: new AbortController().signal,
        getActivityCursor: () => 0,
      }),
    ).resolves.toMatchObject({
      state: "infrastructure-error",
      terminationReason: "Adapter inputTokens must be a non-negative safe integer.",
    });
  });
});
