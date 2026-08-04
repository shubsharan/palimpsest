import { describe, expect, it } from "vitest";

import {
  generateAgentIds,
  isAgentId,
  type ModelBinding,
  type ModelTurn,
  type TokenUsage,
} from "./contracts.js";

describe("dynamic model contracts", () => {
  it("generates canonical agent IDs for the declared cardinality", () => {
    expect(generateAgentIds(2)).toEqual(["agent-1", "agent-2"]);
    expect(generateAgentIds(5)).toEqual(["agent-1", "agent-2", "agent-3", "agent-4", "agent-5"]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid agent cardinality %s",
    (count) => {
      expect(() => generateAgentIds(count)).toThrow(/positive safe integer/i);
    },
  );

  it.each([
    ["agent-1", true],
    ["agent-25", true],
    ["agent-0", false],
    ["agent-01", false],
    ["agent--1", false],
    ["Agent-1", false],
    ["agent-1 ", false],
  ])("recognizes canonical agent ID %s", (value, expected) => {
    expect(isAgentId(value)).toBe(expected);
  });

  it("represents requested bindings separately from per-turn response identity", () => {
    const binding: ModelBinding = {
      profile: "gpt",
      provider: "openai",
      driver: "openai",
      requestedModel: "gpt-5.2",
      settings: { temperature: 0.2 },
      providerOptions: {},
    };
    const usage: TokenUsage = {
      inputTokens: 12,
      outputTokens: 4,
      inputTokenDetails: {
        noCacheTokens: 10,
        cacheReadTokens: 2,
      },
      outputTokenDetails: {
        textTokens: 3,
        reasoningTokens: 1,
      },
    };
    const turn: ModelTurn = {
      toolCalls: [],
      usage,
      responseIdentity: {
        actualProvider: "openai.responses",
        actualModel: "gpt-5.2-2026-07-01",
      },
      responseText: "",
      finishReason: "length",
      rawFinishReason: "max_output_tokens",
      responseId: "response-1",
      structuredOutputValidation: {
        status: "not-validated",
        error: "Structured output did not complete (finish reason length).",
      },
    };

    expect(binding).not.toHaveProperty("actualModel");
    expect(turn.responseIdentity).toEqual({
      actualProvider: "openai.responses",
      actualModel: "gpt-5.2-2026-07-01",
    });
    expect(turn.usage?.inputTokenDetails?.cacheReadTokens).toBe(2);
    expect(turn.structuredOutputValidation?.status).toBe("not-validated");
  });
});
