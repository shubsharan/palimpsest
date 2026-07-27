import { describe, expect, test } from "vitest";

import { runBridgeProcess } from "../src/model-bridge.js";

describe("fixture model bridge", () => {
  test("parses ordered observable NDJSON with a terminal event", async () => {
    const event = {
      schemaVersion: 1,
      runId: "run-1",
      agentId: "agent-1",
      invocationId: "invocation-1",
      ordinal: 1,
      type: "worker.completed",
      payload: { classification: "completed" },
    };
    const result = await runBridgeProcess({
      command: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(`${JSON.stringify(event)}\n`)})`],
      adapterId: "fixture-agent-v1",
      runId: "run-1",
      agentId: "agent-1",
      invocationId: "invocation-1",
      timeoutMs: 1_000,
    });
    expect(result.events).toEqual([event]);
  });

  test("rejects provider adapters without a passing harness report", async () => {
    await expect(
      runBridgeProcess({
        command: process.execPath,
        args: ["-e", ""],
        adapterId: "provider-adapter",
        runId: "run-1",
        agentId: "agent-1",
        invocationId: "invocation-1",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/requires a passing offline harness/);
  });
});
