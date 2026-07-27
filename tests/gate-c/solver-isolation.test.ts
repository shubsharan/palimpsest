import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  runSolverAttempt,
  type ContainerReceipt,
  type ResponseRequest,
  type SolverApiClient,
  type UploadReceipt,
} from "../../tools/gate-c/solver-runner.js";

const identity = { declarationDigest: "b".repeat(64), runId: "run-1" };

async function path(): Promise<string> {
  return mkdtemp(join(tmpdir(), "palimpsest-gate-c-isolation-"));
}

class Client implements SolverApiClient {
  constructor(
    private readonly policy: "disabled" | "allowlist" = "disabled",
    private readonly payload: unknown = {
      mappings: [],
      switchHypotheses: [],
      reconstructionRefs: [],
    },
  ) {}

  async createContainer(): Promise<ContainerReceipt> {
    return { id: "cntr_1", networkPolicy: this.policy as "disabled" };
  }

  async downloadFile(): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async uploadFile(
    containerId: string,
    filename: string,
    content: Uint8Array,
  ): Promise<UploadReceipt> {
    return {
      bytes: content.byteLength,
      containerId,
      id: "file_1",
      path: `/mnt/data/${filename}`,
    };
  }

  async *streamResponse(_request: ResponseRequest) {
    yield { type: "response.output_text.delta", delta: JSON.stringify(this.payload) };
    yield {
      type: "response.completed",
      response: {
        id: "resp_1",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    };
  }
}

const release = {
  content: new TextEncoder().encode("chapter"),
  filename: "01.txt",
  ordinal: 1,
  observedMonotonicMs: 0,
};

describe("Gate C solver isolation", () => {
  test("rejects a container unless network is disabled", async () => {
    await expect(
      runSolverAttempt({
        attemptPath: await path(),
        client: new Client("allowlist"),
        identity,
        releases: [release],
      }),
    ).rejects.toThrow("network disabled");
  });

  test("rejects release paths that could escape the upload namespace", async () => {
    await expect(
      runSolverAttempt({
        attemptPath: await path(),
        client: new Client(),
        identity,
        releases: [{ ...release, filename: "../oracle.json" }],
      }),
    ).rejects.toThrow("must not contain a path");
  });

  test("rejects undeclared checkpoint fields without repairing them", async () => {
    await expect(
      runSolverAttempt({
        attemptPath: await path(),
        client: new Client("disabled", {
          mappings: [],
          switchHypotheses: [],
          reconstructionRefs: [],
          oracleSwitch: 3,
        }),
        identity,
        releases: [release],
      }),
    ).rejects.toThrow("missing or undeclared fields");
  });

  test("rejects reconstruction references without a downloaded container file", async () => {
    await expect(
      runSolverAttempt({
        attemptPath: await path(),
        client: new Client("disabled", {
          mappings: [],
          switchHypotheses: [],
          reconstructionRefs: [
            {
              artifactType: "solver-created-file",
              byteLength: 1,
              sha256: "a".repeat(64),
            },
          ],
        }),
        identity,
        releases: [release],
      }),
    ).rejects.toThrow("no matching downloaded file");
  });
});
