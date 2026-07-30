import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { JsonlObservationLog } from "./trace.js";

describe("trace log", () => {
  it("serializes concurrent appends monotonically and redacts host secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-observations-"));
    const path = join(root, "trace.jsonl");
    const log = await JsonlObservationLog.create(path, {
      startedAtMs: 1_000,
      nowMs: () => 25,
    });

    await Promise.all([
      log.append("model.response", { credential: "secret", outputTokens: 3 }, "agent-1"),
      log.append("tool.completed", { nested: { plaintext: "hidden" } }, "agent-2"),
    ]);

    const records = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.map((record) => record.sequence)).toEqual([1, 2]);
    expect(records.map((record) => record.atMs)).toEqual([25, 25]);
    expect(JSON.stringify(records)).not.toContain("secret");
    expect(JSON.stringify(records)).not.toContain("hidden");
    expect(JSON.stringify(records)).toContain("outputTokens");
    const text = await readFile(join(root, "trace.log"), "utf8");
    expect(text).toContain("Palimpsest trace");
    expect(text).toContain("[000001 +00:00:00.025] agent-1 · model.response");
    expect(text).toContain('"credential": "[REDACTED]"');
    expect(text).not.toContain("secret");
    await expect(readFile(join(root, "trace.meta.json"), "utf8")).resolves.toContain(
      '"schemaVersion":1',
    );
  });

  it("reopens a completed trace and clamps a backward wall clock", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-observations-resume-"));
    const path = join(root, "trace.jsonl");
    const live = await JsonlObservationLog.create(path, {
      startedAtMs: 1_000,
      nowMs: () => 50,
    });
    await live.append("attempt.frozen", { ok: true });
    await live.flush();
    await writeFile(join(root, "trace.log"), "stale text\n", "utf8");

    const resumed = await JsonlObservationLog.open(path, { nowEpochMs: () => 900 });
    await resumed.append("evaluation.started", { credential: "hidden" });
    await resumed.append("evaluation.completed", { exitCode: 0 });

    const records = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { sequence: number; atMs: number });
    expect(records.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(records.map((record) => record.atMs)).toEqual([50, 50, 50]);
    expect(await readFile(path, "utf8")).not.toContain("hidden");
    const text = await readFile(join(root, "trace.log"), "utf8");
    expect(text).toContain("[000001 +00:00:00.050] runner · attempt.frozen");
    expect(text).toContain("[000003 +00:00:00.050] runner · evaluation.completed");
    expect(text).not.toContain("hidden");
  });

  it("accepts canonical dynamic agent identities", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-observations-dynamic-"));
    const path = join(root, "trace.jsonl");
    const log = await JsonlObservationLog.create(path, { nowMs: () => 1 });
    await log.append("model.response", { outputTokens: 1 }, "agent-5");
    await log.flush();

    await expect(JsonlObservationLog.open(path)).resolves.toBeDefined();
  });

  it("refuses to append to malformed, nonsequential, or regressing traces", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-observations-invalid-"));
    const path = join(root, "trace.jsonl");
    await JsonlObservationLog.create(path, { startedAtMs: 1_000 });
    await writeFile(
      path,
      [
        JSON.stringify({ sequence: 1, atMs: 20, kind: "first", data: {} }),
        JSON.stringify({ sequence: 3, atMs: 10, kind: "third", data: {} }),
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(JsonlObservationLog.open(path)).rejects.toThrow(/sequence 3 instead of 2/i);
  });

  it.each([
    ["invalid JSON", "{not-json\n", /not valid JSON/i],
    ["non-object root", `${JSON.stringify([])}\n`, /must be an object/i],
    [
      "non-integer sequence",
      `${JSON.stringify({ sequence: 1.5, atMs: 0, kind: "event", data: {} })}\n`,
      /sequence/i,
    ],
    [
      "negative elapsed counter",
      `${JSON.stringify({ sequence: 1, atMs: -1, kind: "event", data: {} })}\n`,
      /invalid atMs/i,
    ],
    [
      "non-finite elapsed counter",
      '{"sequence":1,"atMs":1e999,"kind":"event","data":{}}\n',
      /invalid atMs/i,
    ],
    [
      "empty event kind",
      `${JSON.stringify({ sequence: 1, atMs: 0, kind: "", data: {} })}\n`,
      /missing kind or data/i,
    ],
    [
      "invalid agent enum",
      `${JSON.stringify({
        sequence: 1,
        atMs: 0,
        kind: "event",
        agentId: "agent-zero",
        data: {},
      })}\n`,
      /invalid agentId/i,
    ],
    [
      "missing event data",
      `${JSON.stringify({ sequence: 1, atMs: 0, kind: "event" })}\n`,
      /missing kind or data/i,
    ],
  ])("rejects a trace containing %s", async (_name, source, message) => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-trace-record-invalid-"));
    const path = join(root, "trace.jsonl");
    await JsonlObservationLog.create(path, { startedAtMs: 1_000 });
    await writeFile(path, source, "utf8");

    await expect(JsonlObservationLog.open(path)).rejects.toThrow(message);
  });

  it.each([
    ["invalid JSON", "{not-json\n"],
    ["unsupported version", `${JSON.stringify({ schemaVersion: 2, startedAt: new Date(0) })}\n`],
    ["wrong timestamp type", `${JSON.stringify({ schemaVersion: 1, startedAt: 0 })}\n`],
    [
      "invalid timestamp",
      `${JSON.stringify({ schemaVersion: 1, startedAt: "not-a-timestamp" })}\n`,
    ],
  ])("rejects trace metadata with %s", async (_name, metadata) => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-trace-metadata-invalid-"));
    const path = join(root, "trace.jsonl");
    await writeFile(path, "", "utf8");
    await writeFile(join(root, "trace.meta.json"), metadata, "utf8");

    await expect(JsonlObservationLog.open(path)).rejects.toThrow();
  });
});
