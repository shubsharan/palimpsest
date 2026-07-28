import type {
  ModelAdapter,
  ModelSession,
  ModelSessionContext,
  ModelToolCall,
  ModelTurn,
} from "./model.js";

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

function decodeToolArguments(value: unknown): Readonly<Record<string, unknown>> {
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

function decodeOpenAIResponse(value: unknown): { id: string; turn: ModelTurn } {
  const response = requireRecord(value, "body");
  if (typeof response.id !== "string" || response.id.length === 0) {
    throw new Error("OpenAI response id must be a non-empty string.");
  }
  const usage = requireRecord(response.usage, "usage");
  if (!Array.isArray(response.output)) {
    throw new Error("OpenAI response output must be an array.");
  }
  const toolCalls: ModelToolCall[] = [];
  for (const itemValue of response.output) {
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
      arguments: decodeToolArguments(item.arguments),
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

export class OpenAIModelAdapter implements ModelAdapter {
  readonly #client: OpenAIResponsesClient;
  readonly #model: string;

  constructor(options: { client: OpenAIResponsesClient; model: string }) {
    if (options.model.trim().length === 0) throw new Error("OpenAI model must not be empty.");
    this.#client = options.client;
    this.#model = options.model;
  }

  openSession(context: ModelSessionContext): ModelSession {
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
        if (previousResponseId !== undefined) body.previous_response_id = previousResponseId;
        const parsed = decodeOpenAIResponse(
          await this.#client.responses.create(body, { signal: request.signal }),
        );
        previousResponseId = parsed.id;
        return parsed.turn;
      },
    };
  }
}

export function createOpenAIModelAdapter(model: string): OpenAIModelAdapter {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for the live OpenAI adapter.");
  const client: OpenAIResponsesClient = {
    responses: {
      async create(body, options) {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        });
        if (!response.ok) {
          throw new Error(
            `OpenAI Responses request failed with ${response.status}: ${await response.text()}`,
          );
        }
        return response.json();
      },
    },
  };
  return new OpenAIModelAdapter({ client, model });
}
