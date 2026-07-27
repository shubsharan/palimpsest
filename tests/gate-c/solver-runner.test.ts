import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  OpenAIRequestError,
  OpenAIHttpClient,
  runSolverAttempt,
  type ContainerReceipt,
  type ResponseRequest,
  type SolverApiClient,
  type UploadReceipt,
} from "../../tools/gate-c/solver-runner.js";

const identity = { declarationDigest: "a".repeat(64), runId: "run-1" };

class FakeClient implements SolverApiClient {
  requests: ResponseRequest[] = [];
  uploads: Array<{ containerId: string; filename: string }> = [];

  async createContainer(): Promise<ContainerReceipt> {
    return { id: "cntr_1", networkPolicy: "disabled" };
  }

  async downloadFile(): Promise<Uint8Array> {
    return new TextEncoder().encode("solver output");
  }

  async uploadFile(
    containerId: string,
    filename: string,
    content: Uint8Array,
  ): Promise<UploadReceipt> {
    this.uploads.push({ containerId, filename });
    return {
      bytes: content.byteLength,
      containerId,
      id: `file_${this.uploads.length}`,
      path: `/mnt/data/${filename}`,
    };
  }

  async *streamResponse(request: ResponseRequest) {
    this.requests.push(request);
    const ordinal = this.requests.length;
    yield {
      type: "response.output_item.added",
      item: { type: "code_interpreter_call" },
    };
    const payload = JSON.stringify({
      mappings: [
        {
          cipherType: `cipher-${ordinal}`,
          plainType: `plain-${ordinal}`,
          confidence: 0.8,
          status: "active",
          supportingRevealOrdinals: [ordinal],
          rationale: "fixture",
        },
      ],
      switchHypotheses: [],
      reconstructionRefs: [],
    });
    yield { type: "response.output_text.delta", delta: payload.slice(0, 20) };
    yield { type: "response.output_text.delta", delta: payload.slice(20) };
    yield {
      type: "response.completed",
      response: {
        id: `resp_${ordinal}`,
        usage: { input_tokens: ordinal * 10, output_tokens: ordinal * 5 },
        output: [
          {
            annotations: [
              {
                type: "container_file_citation",
                container_id: "cntr_1",
                file_id: `cfile_${ordinal}`,
                filename: `analysis-${ordinal}.json`,
              },
            ],
          },
        ],
      },
    };
  }
}

async function attemptPath(): Promise<string> {
  return mkdtemp(join(tmpdir(), "palimpsest-gate-c-solver-"));
}

describe("Gate C solver runner", () => {
  test("reuses one disabled container and chains every response", async () => {
    const client = new FakeClient();
    const path = await attemptPath();
    const checkpoints = await runSolverAttempt({
      attemptPath: path,
      client,
      identity,
      releases: [
        {
          content: new TextEncoder().encode("chapter one"),
          filename: "01.txt",
          ordinal: 1,
          observedMonotonicMs: 0,
        },
        {
          content: new TextEncoder().encode("chapter two"),
          filename: "02.txt",
          ordinal: 2,
          observedMonotonicMs: 120_000,
        },
      ],
    });
    expect(client.uploads).toEqual([
      { containerId: "cntr_1", filename: "01.txt" },
      { containerId: "cntr_1", filename: "02.txt" },
    ]);
    expect(client.requests.map((request) => request.previousResponseId)).toEqual([null, "resp_1"]);
    expect(client.requests.every((request) => request.containerId === "cntr_1")).toBe(true);
    expect(checkpoints.map((checkpoint) => checkpoint.responseId)).toEqual(["resp_1", "resp_2"]);
  });

  test("persists observable events and checkpoints while streaming", async () => {
    const path = await attemptPath();
    await runSolverAttempt({
      attemptPath: path,
      client: new FakeClient(),
      identity,
      releases: [
        {
          content: new TextEncoder().encode("chapter"),
          filename: "01.txt",
          ordinal: 1,
          observedMonotonicMs: 0,
        },
      ],
    });
    const live = (await readFile(join(path, "live.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(live.map((event) => event.type)).toEqual([
      "container.file.uploaded",
      "response.output_item.added",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.completed",
      "container.file.downloaded",
      "checkpoint.accepted",
    ]);
    expect(live.every((event) => typeof event.recordedAt === "string")).toBe(true);
    expect(JSON.parse(await readFile(join(path, "checkpoints", "1.json"), "utf8"))).toMatchObject({
      attemptId: `gate-c/${identity.declarationDigest}/${identity.runId}`,
      containerId: "cntr_1",
      responseId: "resp_1",
    });
    expect(await readFile(join(path, "solver-files", "1-cfile_1-analysis-1.json"), "utf8")).toBe(
      "solver output",
    );
  });

  test("propagates quota exhaustion without substituting a model", async () => {
    class QuotaClient extends FakeClient {
      override async createContainer(): Promise<ContainerReceipt> {
        throw new OpenAIRequestError("quota", 429, "insufficient_quota");
      }
    }
    await expect(
      runSolverAttempt({
        attemptPath: await attemptPath(),
        client: new QuotaClient(),
        identity,
        releases: [],
      }),
    ).rejects.toMatchObject({ status: 429, code: "insufficient_quota" });
  });

  test("parses chunk-split CRLF events and sends the frozen solver policy", async () => {
    let requestBody = "";
    const server = createServer((request, response) => {
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        requestBody += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write('data: {"type":"response.created"}\r');
        response.write("\n\r\n");
        response.end('data: {"type":"response.completed","response":{"id":"resp_http"}}\r\n\r\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("fixture server has no TCP address");
      }
      const client = new OpenAIHttpClient("fixture-key", `http://127.0.0.1:${address.port}`);
      const events = [];
      for await (const event of client.streamResponse({
        containerId: "cntr_fixture",
        input: "fixture",
        model: "gpt-5.6-sol",
        previousResponseId: "resp_previous",
      })) {
        events.push(event);
      }
      expect(events.map((event) => event.type)).toEqual(["response.created", "response.completed"]);
      expect(JSON.parse(requestBody)).toMatchObject({
        model: "gpt-5.6-sol",
        previous_response_id: "resp_previous",
        reasoning: { effort: "max", summary: "detailed" },
        max_output_tokens: 64_000,
        stream: true,
        store: true,
        tool_choice: "required",
        tools: [{ type: "code_interpreter", container: "cntr_fixture" }],
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
