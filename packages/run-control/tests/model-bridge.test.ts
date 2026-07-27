import { describe, expect, test } from "vitest";

import { authorizeAdapter, runBridgeProcess } from "../src/model-bridge.js";

describe("fixture model bridge", () => {
  const identity = {
    adapterId: "fixture-agent-v1",
    runId: "run-1",
    agentId: "agent-1",
    invocationId: "invocation-1",
    timeoutMs: 1_000,
  };

  function script(events: unknown[], stderr = ""): string {
    const stdout = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
    return `process.stdout.write(${JSON.stringify(stdout)});process.stderr.write(${JSON.stringify(stderr)})`;
  }

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
      ...identity,
    });
    expect(result.events).toEqual([event]);
  });

  test("rejects provider adapters without a passing harness report", async () => {
    await expect(
      runBridgeProcess({
        command: process.execPath,
        args: ["-e", ""],
        ...identity,
        adapterId: "provider-adapter",
      }),
    ).rejects.toThrow(/requires a passing offline harness/);

    expect(() =>
      authorizeAdapter({
        adapterId: "provider-adapter",
        authorization: {
          schemaVersion: 1,
          contractId: "offline-harness-report",
          declarationDigest: "a".repeat(64),
          runId: "authorized-run",
          reportDigest: "b".repeat(64),
          result: "pass",
          liveModelValidationAuthorized: true,
          allowedAdapterIds: ["provider-adapter"],
        },
      }),
    ).not.toThrow();
  });

  test("enforces stdout, stderr, event-count, and timeout quotas", async () => {
    const terminal = {
      schemaVersion: 1,
      runId: "run-1",
      agentId: "agent-1",
      invocationId: "invocation-1",
      ordinal: 1,
      type: "worker.completed",
      payload: { classification: "completed" },
    };
    await expect(
      runBridgeProcess({
        command: process.execPath,
        args: ["-e", script([terminal])],
        ...identity,
        limits: { maxStdoutBytes: 8 },
      }),
    ).rejects.toThrow(/stdout quota/);
    await expect(
      runBridgeProcess({
        command: process.execPath,
        args: ["-e", script([terminal], "too much")],
        ...identity,
        limits: { maxStderrBytes: 4 },
      }),
    ).rejects.toThrow(/stderr quota/);
    await expect(
      runBridgeProcess({
        command: process.execPath,
        args: ["-e", script([terminal])],
        ...identity,
        limits: { maxEvents: 0 },
      }),
    ).rejects.toThrow(/event quota/);
    await expect(
      runBridgeProcess({
        command: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
        ...identity,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out/);
  });

  test("rejects unknown fields, private reasoning, duplicate terminals, and undeclared writes", async () => {
    const base = {
      schemaVersion: 1,
      runId: "run-1",
      agentId: "agent-1",
      invocationId: "invocation-1",
    };
    for (const events of [
      [
        {
          ...base,
          ordinal: 1,
          type: "worker.completed",
          payload: {},
          surprise: true,
        },
      ],
      [{ ...base, ordinal: 1, type: "worker.completed", payload: {}, reasoning: "private" }],
      [
        { ...base, ordinal: 1, type: "worker.completed", payload: {} },
        { ...base, ordinal: 2, type: "worker.completed", payload: {} },
      ],
      [
        { ...base, ordinal: 1, type: "file.written", payload: { path: "result.txt" } },
        { ...base, ordinal: 2, type: "worker.completed", payload: {} },
      ],
    ]) {
      await expect(
        runBridgeProcess({
          command: process.execPath,
          args: ["-e", script(events)],
          ...identity,
        }),
      ).rejects.toThrow();
    }
  });

  test("accepts declared writes and separates measured I/O from worker resource reports", async () => {
    const base = {
      schemaVersion: 1,
      runId: "run-1",
      agentId: "agent-1",
      invocationId: "invocation-1",
    };
    const events = [
      {
        ...base,
        ordinal: 1,
        type: "file.written",
        payload: { path: "result.txt" },
      },
      {
        ...base,
        ordinal: 2,
        type: "file.declared",
        payload: { paths: ["result.txt"] },
      },
      {
        ...base,
        ordinal: 3,
        type: "resource.usage",
        payload: { cpuMs: 12, memoryBytes: 32, diskBytes: 16 },
      },
      { ...base, ordinal: 4, type: "worker.completed", payload: {} },
    ];
    const result = await runBridgeProcess({
      command: process.execPath,
      args: ["-e", script(events)],
      ...identity,
      limits: { maxCpuMs: 12, maxMemoryBytes: 32, maxDiskBytes: 16 },
    });
    expect(result.declaredFiles).toEqual(["result.txt"]);
    expect(result.reportedResourceUsage).toEqual({
      cpuMs: 12,
      memoryBytes: 32,
      diskBytes: 16,
    });
    expect(result.measuredUsage).toMatchObject({
      eventCount: 4,
      stderrBytes: 0,
    });
    expect(result.measuredUsage.stdoutBytes).toBeGreaterThan(0);
    expect(result.measuredUsage.wallTimeMs).toBeGreaterThanOrEqual(0);

    await expect(
      runBridgeProcess({
        command: process.execPath,
        args: ["-e", script(events)],
        ...identity,
        limits: { maxCpuMs: 11 },
      }),
    ).rejects.toThrow(/CPU quota/);
  });
});
