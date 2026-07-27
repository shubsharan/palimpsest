import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runOfflinePuzzle } from "../../tools/puzzle/offline.js";

describe("offline behavior-neutral runner", () => {
  it("builds, runs three agents, observes Git/checker behavior, freezes, and scores", async () => {
    const parent = await mkdtemp(join(tmpdir(), "palimpsest-offline-cli-"));
    const output = join(parent, "result");
    const result = await runOfflinePuzzle({ output, root: process.cwd() });

    expect(result.run.sessions).toHaveLength(3);
    expect(result.run.sessions.every((session) => session.state !== "infrastructure-error")).toBe(
      true,
    );
    expect(result.evaluation.status).toBe("scored");
    await access(join(output, "attempt", "trace.jsonl"));
    await access(join(output, "attempt", "overlap.json"));
    await access(join(output, "attempt", "frozen", "shared.git"));
    const trace = await readFile(join(output, "attempt", "trace.jsonl"), "utf8");
    expect(trace).toContain('"kind":"stage.released"');
    expect(trace).toContain('"kind":"tool.started"');
    expect(trace).toContain('"kind":"reviewer.selection"');
    expect(trace).toContain('"kind":"evaluation.scored"');
  }, 30_000);
});
