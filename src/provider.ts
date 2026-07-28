import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  generateText,
  jsonSchema,
  tool,
  type JSONValue as AiJsonValue,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";

import {
  validateProviderOptions,
  type CommonModelSettings,
  type JsonValue,
  type ProviderConnection,
} from "./config.js";
import type {
  ModelAdapter,
  ModelSession,
  ModelSessionContext,
  ModelToolCall,
  ModelTurn,
} from "./model.js";

export interface AiSdkModelAdapterOptions {
  model: LanguageModel;
  settings?: CommonModelSettings;
  providerOptions?: Readonly<Record<string, JsonValue>>;
  secrets?: readonly string[];
}

export interface CreateAiSdkModelAdapterOptions {
  providerId: string;
  provider: ProviderConnection;
  model: string;
  settings?: CommonModelSettings;
  providerOptions?: Readonly<Record<string, JsonValue>>;
  env?: NodeJS.ProcessEnv;
}

type AiProviderOptions = Record<string, { [key: string]: AiJsonValue | undefined }>;

function requireTokenCount(value: number | undefined, name: string): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 0) {
    throw new Error(`AI SDK ${name} token usage must be a non-negative safe integer.`);
  }
  return value;
}

function optionalTokenCount(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0 ? value : undefined;
}

function inputTokenDetails(value: {
  noCacheTokens: number | undefined;
  cacheReadTokens: number | undefined;
  cacheWriteTokens: number | undefined;
}) {
  const noCacheTokens = optionalTokenCount(value.noCacheTokens);
  const cacheReadTokens = optionalTokenCount(value.cacheReadTokens);
  const cacheWriteTokens = optionalTokenCount(value.cacheWriteTokens);
  return {
    ...(noCacheTokens === undefined ? {} : { noCacheTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  };
}

function outputTokenDetails(value: {
  textTokens: number | undefined;
  reasoningTokens: number | undefined;
}) {
  const textTokens = optionalTokenCount(value.textTokens);
  const reasoningTokens = optionalTokenCount(value.reasoningTokens);
  return {
    ...(textTokens === undefined ? {} : { textTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  };
}

function languageModelProvider(model: LanguageModel): string | undefined {
  if (
    typeof model === "object" &&
    model !== null &&
    "provider" in model &&
    typeof model.provider === "string"
  ) {
    return model.provider;
  }
  return undefined;
}

function requireToolArguments(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`AI SDK tool ${name} input must be an object.`);
  }
  return value as Record<string, unknown>;
}

function jsonValue(value: unknown, path: string, seen = new WeakSet<object>()): AiJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error(`${path} must be JSON-compatible and acyclic.`);
    seen.add(value);
    const result = value.map((child, index) => jsonValue(child, `${path}[${String(index)}]`, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value !== "object") {
    throw new Error(`${path} must be JSON-compatible.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must be JSON-compatible.`);
  }
  if (seen.has(value)) throw new Error(`${path} must be JSON-compatible and acyclic.`);
  seen.add(value);
  const result: Record<string, AiJsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = jsonValue(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
  return result;
}

function providerOptions(
  value: Readonly<Record<string, JsonValue>> | undefined,
): AiProviderOptions | undefined {
  if (value === undefined || Object.keys(value).length === 0) return undefined;
  validateProviderOptions(value, "providerOptions");
  const result: AiProviderOptions = {};
  for (const [provider, options] of Object.entries(value)) {
    const cloned = jsonValue(options, `providerOptions.${provider}`);
    if (typeof cloned !== "object" || cloned === null || Array.isArray(cloned)) {
      throw new Error(`providerOptions.${provider} must be an object.`);
    }
    result[provider] = cloned;
  }
  return result;
}

function toolSet(context: ModelSessionContext): ToolSet {
  return Object.fromEntries(
    context.tools.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema({ ...definition.inputSchema }),
      }),
    ]),
  );
}

function scrubError(error: unknown, secrets: readonly string[]): Error {
  const source = error instanceof Error ? error.message : String(error);
  const message = [...new Set(secrets)]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((current, secret) => current.replaceAll(secret, "[REDACTED]"), source);
  const scrubbed = new Error(message);
  if (error instanceof Error) scrubbed.name = error.name;
  return scrubbed;
}

function appendToolResults(
  messages: readonly ModelMessage[],
  pending: ReadonlyMap<string, string>,
  results: readonly { callId: string; output: unknown }[],
): ModelMessage[] {
  const seen = new Set<string>();
  const content = results.map((result) => {
    if (seen.has(result.callId)) {
      throw new Error(`Duplicate tool result ${result.callId}.`);
    }
    seen.add(result.callId);
    const toolName = pending.get(result.callId);
    if (toolName === undefined) {
      throw new Error(`Unknown tool result ${result.callId}.`);
    }
    return {
      type: "tool-result" as const,
      toolCallId: result.callId,
      toolName,
      output: {
        type: "json" as const,
        value: jsonValue(result.output, `Tool result ${result.callId}`),
      },
    };
  });
  for (const callId of pending.keys()) {
    if (!seen.has(callId)) throw new Error(`Missing tool result for ${callId}.`);
  }
  return [...messages, { role: "tool", content }];
}

export class AiSdkModelAdapter implements ModelAdapter {
  readonly #model: LanguageModel;
  readonly #settings: CommonModelSettings;
  readonly #providerOptions: AiProviderOptions | undefined;
  readonly #secrets: readonly string[];

  constructor(options: AiSdkModelAdapterOptions) {
    this.#model = options.model;
    this.#settings = { ...options.settings };
    this.#providerOptions = providerOptions(options.providerOptions);
    this.#secrets = [...(options.secrets ?? [])];
  }

  openSession(context: ModelSessionContext): ModelSession {
    const tools = toolSet(context);
    let messages: ModelMessage[] = [];
    let pending = new Map<string, string>();
    let started = false;

    return {
      respond: async (request): Promise<ModelTurn> => {
        let requestMessages: ModelMessage[];
        if (!started) {
          if (request.prompt === undefined || request.prompt.length === 0) {
            throw new Error("The first model request must contain a prompt.");
          }
          if (request.toolResults.length > 0) {
            throw new Error("The first model request cannot contain tool results.");
          }
          requestMessages = [...messages, { role: "user", content: request.prompt }];
        } else {
          if (request.prompt !== undefined) {
            throw new Error("A continuation model request cannot contain a new prompt.");
          }
          if (pending.size === 0) {
            throw new Error("The model session has no pending tool calls.");
          }
          requestMessages = appendToolResults(messages, pending, request.toolResults);
        }

        try {
          const result = await generateText({
            model: this.#model,
            messages: requestMessages,
            tools,
            maxRetries: 0,
            abortSignal: request.signal,
            ...(this.#settings.maxOutputTokens === undefined
              ? {}
              : { maxOutputTokens: this.#settings.maxOutputTokens }),
            ...(this.#settings.temperature === undefined
              ? {}
              : { temperature: this.#settings.temperature }),
            ...(this.#settings.topP === undefined ? {} : { topP: this.#settings.topP }),
            ...(this.#settings.seed === undefined ? {} : { seed: this.#settings.seed }),
            ...(this.#providerOptions === undefined
              ? {}
              : { providerOptions: this.#providerOptions }),
          });
          const nextPending = new Map<string, string>();
          const toolCalls: ModelToolCall[] = result.toolCalls.map((call) => {
            if (nextPending.has(call.toolCallId)) {
              throw new Error(`AI SDK returned duplicate tool call ${call.toolCallId}.`);
            }
            nextPending.set(call.toolCallId, call.toolName);
            return {
              id: call.toolCallId,
              name: call.toolName,
              arguments: requireToolArguments(call.input, call.toolName),
            };
          });
          const usage = {
            inputTokens: requireTokenCount(result.usage.inputTokens, "input"),
            outputTokens: requireTokenCount(result.usage.outputTokens, "output"),
            inputTokenDetails: inputTokenDetails(result.usage.inputTokenDetails),
            outputTokenDetails: outputTokenDetails(result.usage.outputTokenDetails),
          };
          messages = [...requestMessages, ...result.responseMessages];
          pending = nextPending;
          started = true;
          const actualProvider = languageModelProvider(this.#model);
          const common = {
            toolCalls,
            usage,
            responseIdentity: {
              ...(actualProvider === undefined ? {} : { actualProvider }),
              actualModel: result.response.modelId,
            },
          };
          return result.text.length === 0 ? common : { ...common, finalResponse: result.text };
        } catch (error) {
          throw scrubError(error, this.#secrets);
        }
      },
    };
  }
}

function environmentValue(env: NodeJS.ProcessEnv, variable: string, path: string): string {
  const value = env[variable];
  if (value === undefined || value.length === 0) {
    throw new Error(`${path} requires environment variable ${variable}.`);
  }
  return value;
}

export function createAiSdkModelAdapter(
  options: CreateAiSdkModelAdapterOptions,
): AiSdkModelAdapter {
  if (options.providerId.trim().length === 0) {
    throw new Error("Provider identifier must not be empty.");
  }
  if (options.model.trim().length === 0) {
    throw new Error("Provider model identifier must not be empty.");
  }
  const env = options.env ?? process.env;
  const secrets: string[] = [];
  let model: LanguageModel;

  switch (options.provider.driver) {
    case "openai": {
      const apiKey = environmentValue(
        env,
        options.provider.apiKeyEnv,
        `providers.${options.providerId}.apiKeyEnv`,
      );
      secrets.push(apiKey);
      model = createOpenAI({ apiKey })(options.model);
      break;
    }
    case "anthropic": {
      const apiKey = environmentValue(
        env,
        options.provider.apiKeyEnv,
        `providers.${options.providerId}.apiKeyEnv`,
      );
      secrets.push(apiKey);
      model = createAnthropic({ apiKey })(options.model);
      break;
    }
    case "google": {
      const apiKey = environmentValue(
        env,
        options.provider.apiKeyEnv,
        `providers.${options.providerId}.apiKeyEnv`,
      );
      secrets.push(apiKey);
      model = createGoogle({ apiKey })(options.model);
      break;
    }
    case "openai-compatible": {
      const apiKey =
        options.provider.apiKeyEnv === undefined
          ? undefined
          : environmentValue(
              env,
              options.provider.apiKeyEnv,
              `providers.${options.providerId}.apiKeyEnv`,
            );
      if (apiKey !== undefined) secrets.push(apiKey);
      const headers = Object.fromEntries(
        Object.entries(options.provider.headersEnv ?? {}).map(([header, variable]) => {
          const value = environmentValue(
            env,
            variable,
            `providers.${options.providerId}.headersEnv.${header}`,
          );
          secrets.push(value);
          return [header, value];
        }),
      );
      model = createOpenAICompatible({
        name: options.providerId,
        baseURL: options.provider.baseURL,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(Object.keys(headers).length === 0 ? {} : { headers }),
      }).chatModel(options.model);
      break;
    }
  }

  return new AiSdkModelAdapter({
    model,
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    ...(options.providerOptions === undefined ? {} : { providerOptions: options.providerOptions }),
    secrets,
  });
}
