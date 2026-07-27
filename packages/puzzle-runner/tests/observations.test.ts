import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { JsonlObservationLog } from "../src/observations.js";

describe("observation log", () => {
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
});
