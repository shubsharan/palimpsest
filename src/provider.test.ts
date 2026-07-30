import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import {
  AiSdkModelAdapter,
  createAiSdkModelAdapter,
  type AiSdkModelAdapterOptions,
} from "./provider.js";
import { TOOL_DEFINITIONS } from "./tools.js";

function usage(inputTokens: number | undefined, outputTokens: number | undefined) {
  return {
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens,
      reasoning: undefined,
    },
  };
}

function adapterWith(
  model: MockLanguageModelV4,
  options: Partial<AiSdkModelAdapterOptions> = {},
): AiSdkModelAdapter {
  return new AiSdkModelAdapter({
    model,
    ...options,
  });
}

describe("AI SDK provider", () => {
  it("normalizes one tool turn and continues with provider-preserving message history", async () => {
    const model = new MockLanguageModelV4({
      provider: "mock-provider",
      modelId: "requested-model",
      doGenerate: [
        {
          content: [
            {
              type: "reasoning",
              text: "Inspect the repository before changing it.",
            },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "run_command",
              input: '{"command":"git status"}',
              providerMetadata: { mock: { opaque: "preserve-me" } },
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage: usage(5, 2),
          warnings: [],
          response: { id: "response-1", modelId: "served-model", timestamp: new Date(0) },
        },
        {
          content: [{ type: "text", text: "done" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: usage(4, 1),
          warnings: [],
          response: { id: "response-2", modelId: "served-model", timestamp: new Date(1) },
        },
      ],
    });
    const session = adapterWith(model).openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });
    const signal = new AbortController().signal;

    await expect(session.respond({ prompt: "solve", toolResults: [], signal })).resolves.toEqual({
      toolCalls: [
        {
          id: "call-1",
          name: "run_command",
          arguments: { command: "git status" },
        },
      ],
      usage: {
        inputTokens: 5,
        outputTokens: 2,
        inputTokenDetails: { noCacheTokens: 5 },
        outputTokenDetails: { textTokens: 2 },
      },
      responseIdentity: {
        actualProvider: "mock-provider",
        actualModel: "served-model",
      },
      reasoningSummary: "Inspect the repository before changing it.",
    });
    await expect(
      session.respond({
        toolResults: [{ callId: "call-1", output: { exitCode: 0 } }],
        signal,
      }),
    ).resolves.toEqual({
      finalResponse: "done",
      toolCalls: [],
      usage: {
        inputTokens: 4,
        outputTokens: 1,
        inputTokenDetails: { noCacheTokens: 4 },
        outputTokenDetails: { textTokens: 1 },
      },
      responseIdentity: {
        actualProvider: "mock-provider",
        actualModel: "served-model",
      },
    });

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[1]?.prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "tool-call",
              toolCallId: "call-1",
              providerOptions: { mock: { opaque: "preserve-me" } },
            }),
          ]),
        }),
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "run_command",
              output: { type: "json", value: { exitCode: 0 } },
            },
          ],
        },
      ]),
    );
  });

  it("requires one JSON result for every pending tool call", async () => {
    const result = {
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "call-1",
          toolName: "run_command",
          input: '{"command":"true"}',
        },
        {
          type: "tool-call" as const,
          toolCallId: "call-2",
          toolName: "wait_for_activity",
          input: '{"afterSequence":0}',
        },
      ],
      finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
      usage: usage(2, 1),
      warnings: [],
    };
    const model = new MockLanguageModelV4({ doGenerate: [result] });
    const session = adapterWith(model).openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });
    const signal = new AbortController().signal;
    await session.respond({ prompt: "solve", toolResults: [], signal });

    await expect(
      session.respond({
        toolResults: [{ callId: "call-1", output: { ok: true } }],
        signal,
      }),
    ).rejects.toThrow(/missing tool result.*call-2/i);
    await expect(
      session.respond({
        toolResults: [
          { callId: "call-1", output: { ok: true } },
          { callId: "call-1", output: { ok: true } },
        ],
        signal,
      }),
    ).rejects.toThrow(/duplicate tool result.*call-1/i);
    await expect(
      session.respond({
        toolResults: [
          { callId: "call-1", output: { ok: true } },
          { callId: "unknown", output: { ok: true } },
        ],
        signal,
      }),
    ).rejects.toThrow(/unknown tool result.*unknown/i);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await expect(
      session.respond({
        toolResults: [
          { callId: "call-1", output: cyclic },
          { callId: "call-2", output: { ok: true } },
        ],
        signal,
      }),
    ).rejects.toThrow(/JSON-compatible/i);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("forwards settings and abort while disabling retries", async () => {
    const failure = vi.fn(async () => {
      throw new Error("rate limited");
    });
    const model = new MockLanguageModelV4({ doGenerate: failure });
    const signal = new AbortController().signal;
    const session = adapterWith(model, {
      settings: { maxOutputTokens: 123, temperature: 0.3, topP: 0.8, seed: 9 },
      providerOptions: { mock: { mode: "research" } },
    }).openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });

    await expect(session.respond({ prompt: "solve", toolResults: [], signal })).rejects.toThrow(
      "rate limited",
    );
    expect(failure).toHaveBeenCalledOnce();
    expect(model.doGenerateCalls[0]).toMatchObject({
      abortSignal: signal,
      maxOutputTokens: 123,
      temperature: 0.3,
      topP: 0.8,
      seed: 9,
      providerOptions: { mock: { mode: "research" } },
    });
  });

  it.each([
    { input: undefined, output: 1 },
    { input: 1, output: undefined },
  ])("rejects missing normalized usage: %j", async ({ input, output }) => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: "done" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usage(input, output),
        warnings: [],
      },
    });
    const session = adapterWith(model).openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });

    await expect(
      session.respond({
        prompt: "solve",
        toolResults: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/token usage/i);
  });

  it("scrubs credential values from provider failures", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("request using provider-secret was rejected");
      },
    });
    const session = adapterWith(model, { secrets: ["provider-secret"] }).openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });

    await expect(
      session.respond({
        prompt: "solve",
        toolResults: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("request using [REDACTED] was rejected");
  });

  it("rejects provider fallback options defensively", () => {
    expect(
      () =>
        new AiSdkModelAdapter({
          model: new MockLanguageModelV4(),
          providerOptions: { anthropic: { fallbacks: [{ model: "other" }] } },
        }),
    ).toThrow(/fallbacks/i);
  });

  it("constructs all direct drivers and preflights named credentials", () => {
    const env = {
      OPENAI_EXPERIMENT_KEY: "openai-value",
      ANTHROPIC_EXPERIMENT_KEY: "anthropic-value",
      GOOGLE_EXPERIMENT_KEY: "google-value",
      COMPAT_EXPERIMENT_KEY: "compat-value",
      COMPAT_HEADER: "header-value",
    };
    const cases = [
      {
        providerId: "openai",
        provider: { driver: "openai" as const, apiKeyEnv: "OPENAI_EXPERIMENT_KEY" },
      },
      {
        providerId: "anthropic",
        provider: { driver: "anthropic" as const, apiKeyEnv: "ANTHROPIC_EXPERIMENT_KEY" },
      },
      {
        providerId: "google",
        provider: { driver: "google" as const, apiKeyEnv: "GOOGLE_EXPERIMENT_KEY" },
      },
      {
        providerId: "compat",
        provider: {
          driver: "openai-compatible" as const,
          baseURL: "http://127.0.0.1:4000/v1",
          apiKeyEnv: "COMPAT_EXPERIMENT_KEY",
          headersEnv: { "x-research": "COMPAT_HEADER" },
        },
      },
      {
        providerId: "local",
        provider: {
          driver: "openai-compatible" as const,
          baseURL: "http://127.0.0.1:4000/v1",
        },
      },
    ];

    for (const item of cases) {
      expect(
        createAiSdkModelAdapter({
          ...item,
          model: "research-model",
          env,
        }),
      ).toBeInstanceOf(AiSdkModelAdapter);
    }
    expect(() =>
      createAiSdkModelAdapter({
        providerId: "openai",
        provider: { driver: "openai", apiKeyEnv: "MISSING_KEY" },
        model: "research-model",
        env,
      }),
    ).toThrow(/MISSING_KEY/);
  });
});
