import { createAnthropic } from "@ai-sdk/anthropic";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import {
  AiSdkModelAdapter,
  createAiSdkModelAdapter,
  type AiSdkModelAdapterOptions,
} from "./ai-sdk-adapter.js";
import { packetReviewerOutputSchema } from "../grading/packet-output.js";
import { TOOL_DEFINITIONS } from "../run/tools.js";

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
  it("uses provider-native structured output while retaining response text and usage", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: '{"schemaVersion":1,"value":"ok"}' }],
        finishReason: { unified: "stop", raw: "completed" },
        usage: usage(7, 3),
        warnings: [],
        response: {
          id: "response-structured",
          modelId: "served-model",
          timestamp: new Date(0),
        },
      },
    });
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { schemaVersion: { const: 1 }, value: { type: "string" } },
      required: ["schemaVersion", "value"],
    } as const;
    const session = adapterWith(model).openSession({ agentId: "agent-1", tools: [] });

    const turn = await session.respond({
      prompt: "return the object",
      toolResults: [],
      signal: new AbortController().signal,
      structuredOutput: {
        name: "structured_test",
        description: "Synthetic structured response.",
        schema,
      },
    });

    expect(turn.finalResponse).toBe('{"schemaVersion":1,"value":"ok"}');
    expect(turn.responseText).toBe('{"schemaVersion":1,"value":"ok"}');
    expect(turn.finishReason).toBe("stop");
    expect(turn.rawFinishReason).toBe("completed");
    expect(turn.responseId).toBe("response-structured");
    expect(turn.structuredOutputValidation).toEqual({ status: "validated" });
    expect(turn.usage).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    expect(model.doGenerateCalls[0]!.responseFormat).toEqual({
      type: "json",
      name: "structured_test",
      description: "Synthetic structured response.",
      schema,
    });
  });

  it("sends a strict zero-union output schema through the real Anthropic provider", async () => {
    const schema = packetReviewerOutputSchema();
    const responseValue = {
      schemaVersion: 1,
      dimensions: [
        {
          dimensionId: "epistemic.framing",
          assessment: "rated-3",
          rationale: "The retained evidence supports a strong observable frame.",
          evidenceIds: ["c001"],
          counterevidenceIds: [],
          confidence: "high",
        },
        {
          dimensionId: "epistemic.revision",
          assessment: "unobservable",
          rationale: "No retained revision opportunity was observable.",
          evidenceIds: [],
          counterevidenceIds: [],
          confidence: "medium",
        },
      ],
      episodes: [],
      cautions: [],
    };
    let requestBody: unknown;
    const model = createAnthropic({
      apiKey: "test-anthropic-key",
      fetch: async (input, init) => {
        const body =
          init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
        requestBody = JSON.parse(String(body));
        return new Response(
          JSON.stringify({
            type: "message",
            id: "msg_test_structured",
            model: "claude-opus-5",
            content: [{ type: "text", text: JSON.stringify(responseValue) }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: {
              input_tokens: 11,
              output_tokens: 7,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "request-id": "req_test_structured",
            },
          },
        );
      },
    })("claude-opus-5");
    const session = new AiSdkModelAdapter({ model }).openSession({
      agentId: "agent-1",
      tools: [],
    });

    const turn = await session.respond({
      prompt: "Review the retained evidence.",
      toolResults: [],
      signal: new AbortController().signal,
      structuredOutput: { name: "palimpsest_epistemic_packet_v4", schema },
    });

    const body = requestBody as Record<string, unknown>;
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    const outputConfig = body.output_config as Record<string, unknown>;
    const format = outputConfig.format as Record<string, unknown>;
    expect(format.type).toBe("json_schema");
    const sentSchema = format.schema as Record<string, unknown>;
    expect(Object.keys(sentSchema.properties as Record<string, unknown>)).toEqual([
      "schemaVersion",
      "dimensions",
      "episodes",
      "cautions",
    ]);
    expect(JSON.stringify(sentSchema)).not.toContain('"ledger"');
    expect(Buffer.byteLength(JSON.stringify(sentSchema), "utf8")).toBeLessThan(6 * 1024);
    let unionCount = 0;
    const inspectSchema = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => inspectSchema(item, `${path}[${String(index)}]`));
        return;
      }
      if (value === null || typeof value !== "object") return;
      const item = value as Record<string, unknown>;
      if (Array.isArray(item.anyOf)) unionCount += 1;
      if (Array.isArray(item.type)) unionCount += 1;
      if (item.type === "object") {
        const properties = item.properties as Record<string, unknown>;
        expect(item.additionalProperties, path).toBe(false);
        expect(item.required, path).toEqual(Object.keys(properties));
      }
      Object.entries(item).forEach(([key, child]) => inspectSchema(child, `${path}.${key}`));
    };
    inspectSchema(sentSchema, "$output_config.format.schema");
    expect(unionCount).toBe(0);
    expect(turn).toMatchObject({
      responseText: JSON.stringify(responseValue),
      finishReason: "stop",
      rawFinishReason: "end_turn",
      responseId: "msg_test_structured",
      responseIdentity: {
        actualProvider: "anthropic.messages",
        actualModel: "claude-opus-5",
      },
      structuredOutputValidation: { status: "validated" },
      usage: { inputTokens: 11, outputTokens: 7 },
    });
  });

  it.each([
    ["malformed JSON", [{ type: "text" as const, text: "not-json" }]],
    ["empty output", []],
    ["schema-invalid JSON", [{ type: "text" as const, text: '{"value":1}' }]],
  ])("retains %s and metadata when structured output cannot be parsed", async (_name, content) => {
    const model = new MockLanguageModelV4({
      provider: "mock-provider",
      modelId: "requested-model",
      doGenerate: {
        content,
        finishReason: { unified: "stop", raw: "completed" },
        usage: usage(1, 1),
        warnings: [],
        response: {
          id: "response-invalid",
          modelId: "served-model",
          timestamp: new Date(0),
        },
      },
    });
    const session = adapterWith(model).openSession({ agentId: "agent-1", tools: [] });

    const turn = await session.respond({
      prompt: "return the object",
      toolResults: [],
      signal: new AbortController().signal,
      structuredOutput: {
        name: "structured_test",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    });

    expect(turn.responseText).toBe(content[0]?.text ?? "");
    expect(turn.finishReason).toBe("stop");
    expect(turn.rawFinishReason).toBe("completed");
    expect(turn.responseId).toBe("response-invalid");
    expect(turn.responseIdentity).toEqual({
      actualProvider: "mock-provider",
      actualModel: "served-model",
    });
    expect(turn.usage).toMatchObject({ inputTokens: 1, outputTokens: 1 });
    expect(turn.structuredOutputValidation).toMatchObject({
      status: "invalid",
      error: expect.stringMatching(/no object generated|did not match schema/i),
    });
  });

  it("reports a structured-output length finish with retained usage", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [],
        finishReason: { unified: "length", raw: "max_output_tokens" },
        usage: usage(9, 8_000),
        warnings: [],
      },
    });
    const session = adapterWith(model).openSession({ agentId: "agent-1", tools: [] });

    const turn = await session.respond({
      prompt: "return the object",
      toolResults: [],
      signal: new AbortController().signal,
      structuredOutput: {
        name: "structured_test",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    });

    expect(turn).toMatchObject({
      responseText: "",
      finishReason: "length",
      rawFinishReason: "max_output_tokens",
      usage: { inputTokens: 9, outputTokens: 8_000 },
      structuredOutputValidation: {
        status: "not-validated",
        error: "Structured output did not complete (finish reason length).",
      },
    });
  });

  it("retains response diagnostics when provider usage is unavailable", async () => {
    const model = new MockLanguageModelV4({
      provider: "mock-provider",
      doGenerate: {
        content: [{ type: "text", text: '{"value":"ok"}' }],
        finishReason: { unified: "stop", raw: "completed" },
        usage: usage(undefined, undefined),
        warnings: [],
        response: {
          id: "response-without-usage",
          modelId: "served-model",
          timestamp: new Date(0),
        },
      },
    });
    const session = adapterWith(model).openSession({ agentId: "agent-1", tools: [] });

    const turn = await session.respond({
      prompt: "return the object",
      toolResults: [],
      signal: new AbortController().signal,
      structuredOutput: {
        name: "structured_test",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    });

    expect(turn).toMatchObject({
      responseText: '{"value":"ok"}',
      finishReason: "stop",
      rawFinishReason: "completed",
      responseId: "response-without-usage",
      usageUnavailable: true,
      structuredOutputValidation: { status: "validated" },
    });
    expect(turn.usage).toBeUndefined();
  });

  it("retains exact OpenAI Responses reasoning summary items separately from normalized text", async () => {
    const model = new MockLanguageModelV4({
      provider: "openai.responses",
      modelId: "gpt-5.6-sol",
      doGenerate: {
        content: [
          { type: "reasoning", text: "Inspect the repository." },
          { type: "reasoning", text: "Then test the solver." },
          { type: "text", text: "done" },
        ],
        finishReason: { unified: "stop", raw: "completed" },
        usage: usage(5, 4),
        warnings: [],
        response: {
          id: "response-1",
          modelId: "gpt-5.6-sol",
          timestamp: new Date(0),
          body: {
            id: "response-1",
            output: [
              {
                type: "reasoning",
                id: "rs_1",
                encrypted_content: "must-not-be-retained",
                summary: [
                  { type: "summary_text", text: "Inspect the repository." },
                  { type: "summary_text", text: "Then test the solver." },
                ],
              },
              { type: "message", id: "msg_1", content: [{ type: "output_text", text: "done" }] },
              {
                type: "reasoning",
                id: "rs_2",
                summary: [{ type: "summary_text", text: "" }],
              },
            ],
          },
        },
      },
    });
    const session = adapterWith(model).openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });

    const turn = await session.respond({
      prompt: "solve",
      toolResults: [],
      signal: new AbortController().signal,
    });

    expect(turn.reasoningSummary).toBe("Inspect the repository.Then test the solver.");
    expect(turn.returnedReasoningSummary).toEqual({
      status: "captured",
      items: [
        {
          id: "rs_1",
          summary: [
            { type: "summary_text", text: "Inspect the repository." },
            { type: "summary_text", text: "Then test the solver." },
          ],
        },
        {
          id: "rs_2",
          summary: [{ type: "summary_text", text: "" }],
        },
      ],
    });
    expect(JSON.stringify(turn.returnedReasoningSummary)).not.toContain("encrypted_content");
    expect(JSON.stringify(turn.returnedReasoningSummary)).not.toContain("must-not-be-retained");
    expect(turn.returnedReasoningSummary).not.toHaveProperty("body");
  });

  it("distinguishes an unavailable OpenAI response body from a captured empty list", async () => {
    const model = new MockLanguageModelV4({
      provider: "openai.responses",
      modelId: "gpt-5.6-sol",
      doGenerate: [
        {
          content: [{ type: "text", text: "first" }],
          finishReason: { unified: "stop", raw: "completed" },
          usage: usage(1, 1),
          warnings: [],
          response: { id: "response-1", modelId: "gpt-5.6-sol", timestamp: new Date(0) },
        },
        {
          content: [{ type: "text", text: "second" }],
          finishReason: { unified: "stop", raw: "completed" },
          usage: usage(1, 1),
          warnings: [],
          response: {
            id: "response-2",
            modelId: "gpt-5.6-sol",
            timestamp: new Date(1),
            body: { id: "response-2", output: [] },
          },
        },
      ],
    });
    const firstSession = adapterWith(model).openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });
    const secondSession = adapterWith(model).openSession({
      agentId: "agent-2",
      tools: TOOL_DEFINITIONS,
    });
    const signal = new AbortController().signal;

    await expect(
      firstSession.respond({ prompt: "solve", toolResults: [], signal }),
    ).resolves.toMatchObject({
      returnedReasoningSummary: { status: "response-body-unavailable" },
    });
    await expect(
      secondSession.respond({ prompt: "solve", toolResults: [], signal }),
    ).resolves.toMatchObject({
      returnedReasoningSummary: { status: "captured", items: [] },
    });
  });

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
      responseText: "",
      finishReason: "tool-calls",
      rawFinishReason: "tool_calls",
      responseId: "response-1",
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
      responseText: "done",
      finishReason: "stop",
      rawFinishReason: "stop",
      responseId: "response-2",
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
    expect(model.doGenerateCalls[0]!.responseFormat).toBeUndefined();
  });

  it.each([
    { input: undefined, output: 1 },
    { input: 1, output: undefined },
  ])("marks missing normalized usage unavailable: %j", async ({ input, output }) => {
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

    const turn = await session.respond({
      prompt: "solve",
      toolResults: [],
      signal: new AbortController().signal,
    });
    expect(turn.usage).toBeUndefined();
    expect(turn.usageUnavailable).toBe(true);
    expect(turn.responseText).toBe("done");
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
