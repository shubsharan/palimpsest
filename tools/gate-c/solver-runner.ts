import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { canonicalJsonBytes, sha256Hex, validateValue } from "@palimpsest/contracts";

import {
  FRONTIER_MAX_OUTPUT_TOKENS,
  FRONTIER_MODEL,
  FRONTIER_REASONING_EFFORT,
  FRONTIER_REASONING_SUMMARY,
  FRONTIER_RESPONSE_TIMEOUT_MS,
  REVEAL_INTERVAL_MS,
  REVEAL_SLOT_COUNT,
  type GateCAttemptIdentity,
} from "./config.js";

export interface SolverRelease {
  content: Uint8Array;
  filename: string;
  ordinal: number;
  observedMonotonicMs: number;
}

export interface ContainerReceipt {
  id: string;
  networkPolicy: "disabled";
}

export interface UploadReceipt {
  bytes: number;
  containerId: string;
  id: string;
  path: string;
}

export interface ResponseRequest {
  containerId: string;
  input: string;
  model: string;
  previousResponseId: string | null;
}

export interface SolverApiClient {
  createContainer(name: string): Promise<ContainerReceipt>;
  deleteContainer?(containerId: string): Promise<void>;
  downloadFile(containerId: string, fileId: string): Promise<Uint8Array>;
  streamResponse(request: ResponseRequest): AsyncIterable<Record<string, unknown>>;
  uploadFile(containerId: string, filename: string, content: Uint8Array): Promise<UploadReceipt>;
}

export class OpenAIRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

export function errorFromStreamEvent(event: Record<string, unknown>): OpenAIRequestError {
  const nested =
    event.error !== null && typeof event.error === "object" && !Array.isArray(event.error)
      ? (event.error as Record<string, unknown>)
      : {};
  const code =
    typeof event.code === "string"
      ? event.code
      : typeof nested.code === "string"
        ? nested.code
        : null;
  const message =
    typeof event.message === "string"
      ? event.message
      : typeof nested.message === "string"
        ? nested.message
        : "Responses stream emitted an error event.";
  return new OpenAIRequestError(message, 200, code);
}

function attemptId(identity: GateCAttemptIdentity): string {
  return `gate-c/${identity.declarationDigest}/${identity.runId}`;
}

function checkpointPrompt(identity: GateCAttemptIdentity, revealOrdinal: number): string {
  return [
    `Gate C attempt: ${attemptId(identity)}.`,
    `Reveal ${revealOrdinal} is now available in the container.`,
    `The experiment has ${REVEAL_SLOT_COUNT} total chapter releases on a fixed ${REVEAL_INTERVAL_MS}-millisecond monotonic schedule.`,
    "Analyze the progressively released ciphertext as a deterministic word-type substitution puzzle.",
    "Continue your executable analysis using all released files.",
    "Preserve useful mappings unless evidence contradicts them.",
    "Do not use network access or infer unreleased evidence.",
    "End with exactly one JSON object containing mappings, switchHypotheses, and reconstructionRefs.",
    "Each mapping must include cipherType, plainType, confidence, status, supportingRevealOrdinals, and rationale.",
    "Each switch hypothesis must include afterChapter, confidence, and evidence.",
    "Each reconstructionRefs entry must describe a cited solver-created file with artifactType solver-created-file plus its exact byteLength and sha256.",
  ].join("\n");
}

function eventType(event: Record<string, unknown>): string {
  return typeof event.type === "string" ? event.type : "unknown";
}

function responseFromCompleted(event: Record<string, unknown>): Record<string, unknown> {
  const response = event.response;
  if (response === null || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Completed response event is missing its response object.");
  }
  return response as Record<string, unknown>;
}

function usageFromResponse(response: Record<string, unknown>): {
  inputTokens: number;
  outputTokens: number;
} {
  const usage = response.usage;
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
    throw new Error("Completed response is missing usage.");
  }
  const input = (usage as Record<string, unknown>).input_tokens;
  const output = (usage as Record<string, unknown>).output_tokens;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output)) {
    throw new Error("Completed response usage is malformed.");
  }
  return { inputTokens: input as number, outputTokens: output as number };
}

function parseSolverPayload(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Solver response did not end in valid JSON.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Solver checkpoint payload must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.mappings) ||
    !Array.isArray(record.switchHypotheses) ||
    !Array.isArray(record.reconstructionRefs) ||
    Object.keys(record).some(
      (key) => !["mappings", "switchHypotheses", "reconstructionRefs"].includes(key),
    )
  ) {
    throw new Error("Solver checkpoint payload has missing or undeclared fields.");
  }
  return record;
}

function containerFileCitations(
  value: unknown,
): Array<{ containerId: string; fileId: string; filename: string }> {
  const citations: Array<{ containerId: string; fileId: string; filename: string }> = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (item === null || typeof item !== "object") {
      return;
    }
    const record = item as Record<string, unknown>;
    if (
      record.type === "container_file_citation" &&
      typeof record.container_id === "string" &&
      typeof record.file_id === "string" &&
      typeof record.filename === "string"
    ) {
      citations.push({
        containerId: record.container_id,
        fileId: record.file_id,
        filename: record.filename,
      });
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return citations;
}

async function persistLiveEvent(
  attemptPath: string,
  value: Record<string, unknown>,
): Promise<void> {
  await appendFile(join(attemptPath, "live.jsonl"), canonicalJsonBytes(value));
  await appendFile(join(attemptPath, "live.jsonl"), "\n");
}

export async function runSolverAttempt(options: {
  attemptPath: string;
  client: SolverApiClient;
  identity: GateCAttemptIdentity;
  releases: Iterable<SolverRelease> | AsyncIterable<SolverRelease>;
}): Promise<Record<string, unknown>[]> {
  const { attemptPath, client, identity, releases } = options;
  await mkdir(join(attemptPath, "raw-events"), { recursive: false });
  await mkdir(join(attemptPath, "uploads"), { recursive: false });
  await mkdir(join(attemptPath, "checkpoints"), { recursive: false });
  await mkdir(join(attemptPath, "responses"), { recursive: false });
  await mkdir(join(attemptPath, "solver-files"), { recursive: false });
  const container = await client.createContainer(`palimpsest-${identity.runId}`);
  if (container.networkPolicy !== "disabled") {
    throw new Error("Solver container must have network disabled.");
  }
  await writeFile(
    join(attemptPath, "container.json"),
    canonicalJsonBytes({ schemaVersion: 1, ...container }),
  );

  let previousResponseId: string | null = null;
  const checkpoints: Record<string, unknown>[] = [];
  for await (const release of releases) {
    if (basename(release.filename) !== release.filename) {
      throw new Error("Release filename must not contain a path.");
    }
    const upload = await client.uploadFile(container.id, release.filename, release.content);
    if (
      upload.containerId !== container.id ||
      upload.bytes !== release.content.byteLength ||
      upload.path !== `/mnt/data/${release.filename}`
    ) {
      throw new Error("Container upload receipt does not match the released file.");
    }
    await writeFile(
      join(attemptPath, "uploads", `${release.ordinal}.json`),
      canonicalJsonBytes({ schemaVersion: 1, ...upload }),
    );
    await persistLiveEvent(attemptPath, {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      revealOrdinal: release.ordinal,
      type: "container.file.uploaded",
      upload,
    });

    let responseText = "";
    let completed: Record<string, unknown> | null = null;
    let toolCalls = 0;
    let eventOrdinal = 0;
    try {
      for await (const event of client.streamResponse({
        containerId: container.id,
        input: checkpointPrompt(identity, release.ordinal),
        model: FRONTIER_MODEL,
        previousResponseId,
      })) {
        eventOrdinal += 1;
        await writeFile(
          join(attemptPath, "raw-events", `${release.ordinal}-${eventOrdinal}.json`),
          canonicalJsonBytes(event),
        );
        await persistLiveEvent(attemptPath, {
          schemaVersion: 1,
          recordedAt: new Date().toISOString(),
          revealOrdinal: release.ordinal,
          eventOrdinal,
          type: eventType(event),
          event,
        });
        if (eventType(event) === "response.output_text.delta") {
          if (typeof event.delta !== "string") {
            throw new Error("Text delta event is malformed.");
          }
          responseText += event.delta;
        } else if (eventType(event) === "response.output_item.added") {
          const item = event.item;
          if (
            item !== null &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            (item as Record<string, unknown>).type === "code_interpreter_call"
          ) {
            toolCalls += 1;
          }
        } else if (eventType(event) === "response.completed") {
          completed = responseFromCompleted(event);
        } else if (eventType(event) === "error") {
          throw errorFromStreamEvent(event);
        }
      }
    } catch (error) {
      await persistLiveEvent(attemptPath, {
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        revealOrdinal: release.ordinal,
        type: "attempt.error",
        errorCode: error instanceof OpenAIRequestError ? error.code : null,
      });
      throw error;
    }
    if (completed === null || typeof completed.id !== "string") {
      throw new Error("Responses stream ended without a completed response.");
    }
    await writeFile(
      join(attemptPath, "responses", `${release.ordinal}.json`),
      canonicalJsonBytes(completed),
    );
    const downloadedReferences: Array<{
      artifactType: string;
      byteLength: number;
      sha256: string;
    }> = [];
    for (const citation of containerFileCitations(completed)) {
      if (
        citation.containerId !== container.id ||
        basename(citation.fileId) !== citation.fileId ||
        basename(citation.filename) !== citation.filename
      ) {
        throw new Error("Container file citation does not match the isolated solver container.");
      }
      const content = await client.downloadFile(container.id, citation.fileId);
      const outputPath = join(
        attemptPath,
        "solver-files",
        `${release.ordinal}-${citation.fileId}-${citation.filename}`,
      );
      await writeFile(outputPath, content);
      const reference = {
        artifactType: "solver-created-file",
        byteLength: content.byteLength,
        sha256: sha256Hex(content),
      };
      downloadedReferences.push(reference);
      await persistLiveEvent(attemptPath, {
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        revealOrdinal: release.ordinal,
        type: "container.file.downloaded",
        filename: citation.filename,
        reference,
      });
    }
    const payload = parseSolverPayload(responseText);
    for (const reference of payload.reconstructionRefs as unknown[]) {
      if (
        reference === null ||
        typeof reference !== "object" ||
        Array.isArray(reference) ||
        !downloadedReferences.some(
          (downloaded) =>
            downloaded.artifactType === (reference as Record<string, unknown>).artifactType &&
            downloaded.byteLength === (reference as Record<string, unknown>).byteLength &&
            downloaded.sha256 === (reference as Record<string, unknown>).sha256,
        )
      ) {
        throw new Error("Solver reconstruction reference has no matching downloaded file.");
      }
    }
    const usage = usageFromResponse(completed);
    const checkpoint = {
      schemaVersion: 1,
      contractId: "solver-checkpoint",
      attemptId: attemptId(identity),
      ordinal: checkpoints.length + 1,
      revealOrdinal: release.ordinal,
      observedMonotonicMs: release.observedMonotonicMs,
      responseId: completed.id,
      previousResponseId,
      containerId: container.id,
      mappings: payload.mappings,
      switchHypotheses: payload.switchHypotheses,
      reconstructionRefs: payload.reconstructionRefs,
      usage: { ...usage, toolCalls },
    };
    const verdict = validateValue("solver-checkpoint", checkpoint);
    if (!verdict.accepted) {
      throw new Error(`Solver checkpoint rejected: ${verdict.reason} at ${verdict.pointer}.`);
    }
    const checkpointBytes = canonicalJsonBytes(checkpoint);
    await writeFile(
      join(attemptPath, "checkpoints", `${checkpoint.ordinal}.json`),
      checkpointBytes,
    );
    await persistLiveEvent(attemptPath, {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      revealOrdinal: release.ordinal,
      type: "checkpoint.accepted",
      reference: {
        artifactType: "solver-checkpoint",
        byteLength: checkpointBytes.length,
        sha256: sha256Hex(checkpointBytes),
      },
    });
    checkpoints.push(checkpoint);
    previousResponseId = completed.id;
  }
  await writeFile(join(attemptPath, "checkpoints.json"), canonicalJsonBytes(checkpoints));
  return checkpoints;
}

export class OpenAIHttpClient implements SolverApiClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}

  async createContainer(name: string): Promise<ContainerReceipt> {
    const response = await this.request("/containers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        memory_limit: "4g",
        network_policy: { type: "disabled" },
      }),
    });
    const value = (await response.json()) as { id: string };
    return { id: value.id, networkPolicy: "disabled" };
  }

  async downloadFile(containerId: string, fileId: string): Promise<Uint8Array> {
    const response = await this.request(`/containers/${containerId}/files/${fileId}/content`, {
      method: "GET",
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  async deleteContainer(containerId: string): Promise<void> {
    await this.request(`/containers/${containerId}`, { method: "DELETE" });
  }

  async uploadFile(
    containerId: string,
    filename: string,
    content: Uint8Array,
  ): Promise<UploadReceipt> {
    const form = new FormData();
    const copied = Uint8Array.from(content);
    form.set("file", new Blob([copied.buffer]), filename);
    const response = await this.request(`/containers/${containerId}/files`, {
      method: "POST",
      body: form,
    });
    const value = (await response.json()) as {
      bytes: number;
      container_id: string;
      id: string;
      path: string;
    };
    return {
      bytes: value.bytes,
      containerId: value.container_id,
      id: value.id,
      path: value.path,
    };
  }

  async *streamResponse(request: ResponseRequest): AsyncIterable<Record<string, unknown>> {
    const response = await this.request("/responses", {
      method: "POST",
      signal: AbortSignal.timeout(FRONTIER_RESPONSE_TIMEOUT_MS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        previous_response_id: request.previousResponseId,
        input: request.input,
        reasoning: {
          effort: FRONTIER_REASONING_EFFORT,
          summary: FRONTIER_REASONING_SUMMARY,
        },
        tools: [{ type: "code_interpreter", container: request.containerId }],
        tool_choice: "required",
        max_output_tokens: FRONTIER_MAX_OUTPUT_TOKENS,
        stream: true,
        store: true,
      }),
    });
    if (response.body === null) {
      throw new Error("Responses stream has no body.");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      buffer = buffer.replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (data && data !== "[DONE]") {
          yield JSON.parse(data) as Record<string, unknown>;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    buffer = buffer.replaceAll("\r\n", "\n");
    const trailing = buffer.trim();
    if (trailing) {
      const data = trailing
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (data && data !== "[DONE]") {
        yield JSON.parse(data) as Record<string, unknown>;
      }
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      let code: string | null = null;
      try {
        const value = (await response.json()) as { error?: { code?: string } };
        code = value.error?.code ?? null;
      } catch {
        // The status remains sufficient for a safe error classification.
      }
      throw new OpenAIRequestError(
        `OpenAI request failed with status ${response.status}.`,
        response.status,
        code,
      );
    }
    return response;
  }
}
