import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { JsonlObservationLog } from "../src/observations.js";

describe("observation log", () => {
  it("serializes concurrent appends monotonically and redacts host secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-observations-"));
    const path = join(root, "trace.jsonl");
    const log = new JsonlObservationLog(path, () => 25);

    await Promise.all([
      log.append("model.response", { credential: "secret", outputTokens: 3 }, "agent-1"),
      log.append("tool.completed", { nested: { plaintext: "hidden" } }, "agent-2"),
    ]);

    const records = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.map((record) => record.sequence)).toEqual([1, 2]);
    expect(JSON.stringify(records)).not.toContain("secret");
    expect(JSON.stringify(records)).not.toContain("hidden");
    expect(JSON.stringify(records)).toContain("outputTokens");
  });
});
