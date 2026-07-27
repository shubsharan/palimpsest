import { describe, expect, it } from "vitest";

import { OpenAIAgentAdapter, type OpenAIResponsesClient } from "../src/adapters.js";
import { TOOL_DEFINITIONS } from "../src/tools.js";

describe("OpenAI adapter boundary", () => {
  it("maintains provider context and reports usage without prescribing model behavior", async () => {
    const calls: Readonly<Record<string, unknown>>[] = [];
    const responses: unknown[] = [
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
    ];
    const client: OpenAIResponsesClient = {
      responses: {
        create: async (body) => {
          calls.push(body);
          const response = responses.shift();
          if (response === undefined) throw new Error("Unexpected request.");
          return response;
        },
      },
    };
    const session = new OpenAIAgentAdapter({ client, model: "frontier-model" }).openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });
    const controller = new AbortController();
    const first = await session.respond({
      prompt: "solve",
      toolResults: [],
      signal: controller.signal,
    });
    const second = await session.respond({
      toolResults: [{ callId: "call-1", output: { exitCode: 0 } }],
      signal: controller.signal,
    });

    expect(first).toMatchObject({
      toolCalls: [{ name: "run_command", arguments: { command: "git status" } }],
      usage: { inputTokens: 5, outputTokens: 2 },
    });
    expect(second.finalResponse).toBe("done");
    expect(calls[1]).toMatchObject({ previous_response_id: "response-1" });
  });
});
