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
    await access(join(output, "attempt", "trace.meta.json"));
    await access(join(output, "attempt", "overlap.json"));
    await access(join(output, "attempt", "frozen", "shared.git"));
    const trace = await readFile(join(output, "attempt", "trace.jsonl"), "utf8");
    const events = trace
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            sequence: number;
            atMs: number;
            kind: string;
            data: { ordinal?: number };
          },
      );
    const releases = events.filter((event) => event.kind === "stage.released");
    expect(releases).toHaveLength(18);
    expect(new Set(releases.map((event) => event.data.ordinal))).toEqual(
      new Set([1, 2, 3, 4, 5, 6]),
    );
    expect(
      releases.every(
        (event) => event.data.ordinal !== undefined && event.atMs >= (event.data.ordinal - 1) * 20,
      ),
    ).toBe(true);
    expect(trace).toContain('"kind":"tool.started"');
    expect(trace).toContain('"kind":"reviewer.selection"');
    expect(trace).toContain('"kind":"evaluation.scored"');
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(
      events.every((event, index) => index === 0 || event.atMs >= events[index - 1]!.atMs),
    ).toBe(true);
    const overlapSequence = events.find((event) => event.kind === "overlap.observed")?.sequence;
    const selectionSequence = events.find((event) => event.kind === "reviewer.selection")?.sequence;
    const scoreSequence = events.find((event) => event.kind === "evaluation.scored")?.sequence;
    expect(overlapSequence).toBeDefined();
    expect(selectionSequence).toBeGreaterThan(overlapSequence!);
    expect(scoreSequence).toBeGreaterThan(selectionSequence!);
    const initialRule = events.find((event) => JSON.stringify(event).includes("mapping=v1"));
    const revisedRule = events.find((event) => JSON.stringify(event).includes("mapping=v2"));
    const transitionEvidenceSequence = Math.max(
      ...releases.filter((event) => event.data.ordinal === 4).map((event) => event.sequence),
    );
    expect(initialRule?.sequence).toBeLessThan(transitionEvidenceSequence);
    expect(revisedRule?.sequence).toBeGreaterThan(transitionEvidenceSequence);
  }, 30_000);
});
