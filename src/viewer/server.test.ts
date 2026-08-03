import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DecodeStreamEvent, ViewerRun, ViewerToolDetail } from "./contracts.js";
import { startViewerServer } from "./server.js";

function run(): ViewerRun {
  return {
    runId: "viewer-test",
    status: "completed",
    startedAt: "2026-01-01T00:00:00.000Z",
    frozenAt: "2026-01-01T00:01:00.000Z",
    durationMs: 60_000,
    communicationMode: "shared",
    fixtureId: "fixture-test",
    variantId: "stationary",
    rekeyAtStage: null,
    agents: [
      {
        agentId: "agent-1",
        profile: "fake",
        requestedModel: "fake-model",
      },
    ],
    origins: [{ originId: "shared", agentIds: ["agent-1"], finalCommit: null }],
    finalScores: [],
    ciphertext: "cipher text",
    events: [],
    toolCalls: [
      {
        id: "call-1",
        agentId: "agent-1",
        name: "run_command",
        startedSequence: 2,
        startedAtMs: 20,
        completedSequence: 3,
        completedAtMs: 30,
        status: "completed",
      },
    ],
    teamMessages: [],
  };
}

function toolDetails(): ReadonlyMap<number, ViewerToolDetail> {
  return new Map([[2, { arguments: { command: "pwd" }, output: { stdout: "/workspace" } }]]);
}

async function* replay(): AsyncGenerator<DecodeStreamEvent> {
  yield { type: "started", origins: [{ originId: "shared", checkpointCount: 0 }] };
  yield { type: "complete" };
}

describe("viewer server", () => {
  it("serves a local run API, protected assets, and one replay stream", async () => {
    const assets = await mkdtemp(join(tmpdir(), "palimpsest-viewer-assets-test-"));
    await writeFile(join(assets, "index.html"), "<!doctype html><title>viewer</title>", "utf8");
    const viewer = await startViewerServer({
      root: assets,
      runRoot: assets,
      port: 0,
      assetRoot: assets,
      viewerRun: run(),
      viewerToolDetails: toolDetails(),
      replayEvents: replay,
    });
    try {
      expect(viewer.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const runResponse = await fetch(`${viewer.url}/api/run`);
      expect(runResponse.status).toBe(200);
      expect(runResponse.headers.get("content-security-policy")).toContain("default-src 'self'");
      const runBody = (await runResponse.json()) as ViewerRun;
      expect(runBody).toMatchObject({ runId: "viewer-test" });
      expect(runBody.toolCalls[0]).not.toHaveProperty("arguments");
      expect(runBody.toolCalls[0]).not.toHaveProperty("output");

      const detailResponse = await fetch(`${viewer.url}/api/tool/2`);
      expect(detailResponse.status).toBe(200);
      expect(await detailResponse.json()).toEqual({
        arguments: { command: "pwd" },
        output: { stdout: "/workspace" },
      });
      expect((await fetch(`${viewer.url}/api/tool/999`)).status).toBe(404);
      expect((await fetch(`${viewer.url}/api/tool/not-a-sequence`)).status).toBe(404);

      const streamResponse = await fetch(`${viewer.url}/api/decode/events`);
      const stream = await streamResponse.text();
      expect(stream).toContain('"type":"started"');
      expect(stream).toContain('"type":"complete"');

      const traversal = await fetch(`${viewer.url}/%2e%2e%2fpackage.json`);
      expect(traversal.status).toBe(404);
      const method = await fetch(`${viewer.url}/api/run`, { method: "POST" });
      expect(method.status).toBe(405);
    } finally {
      await viewer.close();
    }
  });
});
