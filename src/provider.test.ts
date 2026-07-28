import { describe, expect, it } from "vitest";

import { OpenAIModelAdapter, type OpenAIResponsesClient } from "./provider.js";
import { TOOL_DEFINITIONS } from "./tools.js";

function clientReturning(...responses: unknown[]): {
  client: OpenAIResponsesClient;
  calls: Readonly<Record<string, unknown>>[];
} {
  const calls: Readonly<Record<string, unknown>>[] = [];
  return {
    calls,
    client: {
      responses: {
        create: async (body) => {
          calls.push(body);
          const response = responses.shift();
          if (response === undefined) throw new Error("Unexpected OpenAI request.");
          return response;
        },
      },
    },
  };
}

describe("OpenAI provider", () => {
  it("decodes tool calls and continues the provider response chain", async () => {
    const { client, calls } = clientReturning(
      {
        id: "response-1",
        output: [
          {
            type: "function_call",
            call_id: "call-1",
            name: "run_command",
            arguments: '{"command":"git status"}',
          },
        ],
        output_text: "",
        usage: { input_tokens: 5, output_tokens: 2 },
      },
      {
        id: "response-2",
        output: [],
        output_text: "done",
        usage: { input_tokens: 4, output_tokens: 1 },
      },
    );
    const session = new OpenAIModelAdapter({ client, model: "frontier-model" }).openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });
    const signal = new AbortController().signal;

    await expect(
      session.respond({ prompt: "solve", toolResults: [], signal }),
    ).resolves.toMatchObject({
      toolCalls: [
        {
          id: "call-1",
          name: "run_command",
          arguments: { command: "git status" },
        },
      ],
      usage: { inputTokens: 5, outputTokens: 2 },
    });
    await expect(
      session.respond({
        toolResults: [{ callId: "call-1", output: { exitCode: 0 } }],
        signal,
      }),
    ).resolves.toMatchObject({
      finalResponse: "done",
      toolCalls: [],
      usage: { inputTokens: 4, outputTokens: 1 },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ model: "frontier-model", input: "solve" });
    expect(calls[1]).toMatchObject({
      previous_response_id: "response-1",
      input: [
        {
          type: "function_call_output",
          call_id: "call-1",
          output: '{"exitCode":0}',
        },
      ],
    });
  });

  it.each([
    {
      name: "missing response id",
      response: { output: [], output_text: "", usage: { input_tokens: 1, output_tokens: 1 } },
      error: /response id must be a non-empty string/i,
    },
    {
      name: "non-array output",
      response: {
        id: "response-1",
        output: {},
        output_text: "",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      error: /response output must be an array/i,
    },
    {
      name: "negative token count",
      response: {
        id: "response-1",
        output: [],
        output_text: "",
        usage: { input_tokens: -1, output_tokens: 1 },
      },
      error: /input_tokens must be a non-negative safe integer/i,
    },
    {
      name: "invalid function arguments",
      response: {
        id: "response-1",
        output: [
          {
            type: "function_call",
            call_id: "call-1",
            name: "run_command",
            arguments: "not json",
          },
        ],
        output_text: "",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      error: /function call arguments are invalid JSON/i,
    },
  ])("rejects $name", async ({ response, error }) => {
    const { client } = clientReturning(response);
    const session = new OpenAIModelAdapter({ client, model: "frontier-model" }).openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });

    await expect(
      session.respond({
        prompt: "solve",
        toolResults: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(error);
  });
});
