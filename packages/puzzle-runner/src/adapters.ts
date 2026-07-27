import type { AgentId } from "./config.js";
import type { ToolDefinition } from "./tools.js";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Readonly<Record<string, unknown>>;
}

export interface AgentToolResult {
  callId: string;
  output: unknown;
}

export interface AgentTurn {
  toolCalls: readonly AgentToolCall[];
  finalResponse?: string;
  usage: TokenUsage;
}

export interface AgentModelRequest {
  prompt?: string;
  toolResults: readonly AgentToolResult[];
  signal: AbortSignal;
}

export interface AgentAdapterContext {
  agentId: AgentId;
  tools: readonly ToolDefinition[];
}

export interface AgentModelSession {
  respond(request: AgentModelRequest): Promise<AgentTurn>;
  cancel?(reason: string): Promise<void> | void;
}

export interface AgentAdapter {
  openSession(context: AgentAdapterContext): Promise<AgentModelSession> | AgentModelSession;
}

type FixtureScripts = Partial<Record<AgentId, readonly AgentTurn[]>>;

function copyTurn(turn: AgentTurn): AgentTurn {
  const common = {
    toolCalls: turn.toolCalls.map((call) => ({ ...call, arguments: { ...call.arguments } })),
    usage: { ...turn.usage },
  };
  return turn.finalResponse === undefined
    ? common
    : { ...common, finalResponse: turn.finalResponse };
}

export class FixtureAgentAdapter implements AgentAdapter {
  readonly #scripts: FixtureScripts;
  readonly #repeatWait: boolean;

  constructor(scripts: FixtureScripts, repeatWait = false) {
    this.#scripts = scripts;
    this.#repeatWait = repeatWait;
  }

  static repeatingWait(): FixtureAgentAdapter {
    return new FixtureAgentAdapter({}, true);
  }

  openSession(context: AgentAdapterContext): AgentModelSession {
    const script = this.#scripts[context.agentId] ?? [];
    let index = 0;
    return {
      respond: async () => {
        const turn = script[index];
        index += 1;
        if (turn !== undefined) return copyTurn(turn);
        if (this.#repeatWait) {
          return {
            toolCalls: [
              {
                id: `wait-${context.agentId}-${index}`,
                name: "wait_for_activity",
                arguments: { afterSequence: 0 },
              },
            ],
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        return {
          toolCalls: [],
          finalResponse: "Fixture script complete.",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    };
  }
}

export interface OpenAIResponsesClient {
  responses: {
    create(
      body: Readonly<Record<string, unknown>>,
      options?: { signal?: AbortSignal },
    ): Promise<unknown>;
  };
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`OpenAI response ${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireTokenCount(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`OpenAI response usage.${name} must be a non-negative safe integer.`);
  }
  return value as number;
}

function parseToolArguments(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "string") {
    throw new Error("OpenAI function call arguments must be a JSON string.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAI function call arguments are invalid JSON: ${detail}`);
  }
  return requireRecord(parsed, "function call arguments");
}

function parseOpenAIResponse(value: unknown): {
  id: string;
  turn: AgentTurn;
} {
  const response = requireRecord(value, "body");
  if (typeof response.id !== "string" || response.id.length === 0) {
    throw new Error("OpenAI response id must be a non-empty string.");
  }
  const usage = requireRecord(response.usage, "usage");
  const output = response.output;
  if (!Array.isArray(output)) {
    throw new Error("OpenAI response output must be an array.");
  }
  const toolCalls: AgentToolCall[] = [];
  for (const itemValue of output) {
    const item = requireRecord(itemValue, "output item");
    if (item.type !== "function_call") continue;
    if (
      typeof item.call_id !== "string" ||
      item.call_id.length === 0 ||
      typeof item.name !== "string" ||
      item.name.length === 0
    ) {
      throw new Error("OpenAI function call requires call_id and name.");
    }
    toolCalls.push({
      id: item.call_id,
      name: item.name,
      arguments: parseToolArguments(item.arguments),
    });
  }
  const finalResponse = typeof response.output_text === "string" ? response.output_text : undefined;
  const common = {
    toolCalls,
    usage: {
      inputTokens: requireTokenCount(usage.input_tokens, "input_tokens"),
      outputTokens: requireTokenCount(usage.output_tokens, "output_tokens"),
    },
  };
  return {
    id: response.id,
    turn: finalResponse === undefined ? common : { ...common, finalResponse },
  };
}

export class OpenAIAgentAdapter implements AgentAdapter {
  readonly #client: OpenAIResponsesClient;
  readonly #model: string;

  constructor(options: { client: OpenAIResponsesClient; model: string }) {
    if (options.model.trim().length === 0) throw new Error("OpenAI model must not be empty.");
    this.#client = options.client;
    this.#model = options.model;
  }

  openSession(context: AgentAdapterContext): AgentModelSession {
    let previousResponseId: string | undefined;
    return {
      respond: async (request) => {
        const input =
          request.prompt !== undefined
            ? request.prompt
            : request.toolResults.map((result) => ({
                type: "function_call_output",
                call_id: result.callId,
                output: JSON.stringify(result.output),
              }));
        const body: Record<string, unknown> = {
          model: this.#model,
          input,
          tools: context.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: false,
          })),
        };
        if (previousResponseId !== undefined) {
          body.previous_response_id = previousResponseId;
        }
        const parsed = parseOpenAIResponse(
          await this.#client.responses.create(body, { signal: request.signal }),
        );
        previousResponseId = parsed.id;
        return parsed.turn;
      },
    };
  }
}
