import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { lifecyclePathFor } from "./lifecycle.js";
import { superviseExperiment } from "./supervisor.js";

describe("experiment supervisor", () => {
  it("records the child process exit beside a previously absent output directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-supervisor-"));
    const worker = join(root, "worker.mjs");
    const output = join(root, "experiment-output");
    await writeFile(worker, "process.exitCode = 7;\n", "utf8");

    await expect(
      superviseExperiment({
        root,
        flags: new Map([["--output", "experiment-output"]]),
        argv: ["experiment", "--output", "experiment-output"],
        workerScript: worker,
        execArgv: [],
      }),
    ).resolves.toBe(7);

    const events = (await readFile(lifecyclePathFor(output), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string; exitCode?: number; runId?: unknown });
    expect(events).toEqual([
      expect.objectContaining({ kind: "started", runId: null }),
      expect.objectContaining({ kind: "exited", exitCode: 7 }),
    ]);
  });
});
