import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createCompletedRunFixture,
  createSharedRunFixture,
} from "../../tests/support/grading-fixture.js";
import { contentDigest } from "../canonical.js";
import { decodeRunRecord } from "../run/record.js";
import { EVIDENCE_WINDOW_BYTES } from "./evidence.js";
import { gradeRun } from "./grade.js";

describe("provider-free performance grading", () => {
  it("publishes immutable digested details and appends one performance analysis", async () => {
    const fixture = await createSharedRunFixture();
    const traceBefore = await readFile(fixture.tracePath);
    const recordBefore = decodeRunRecord(
      JSON.parse(await readFile(join(fixture.runRoot, "run.json"), "utf8")),
    );

    const analysis = await gradeRun({
      root: fixture.root,
      projectRoot: process.cwd(),
      runRoot: fixture.runRoot,
      now: () => new Date("2026-08-03T00:00:00.000Z"),
    });

    const recordAfter = decodeRunRecord(
      JSON.parse(await readFile(join(fixture.runRoot, "run.json"), "utf8")),
    );
    const detailsRoot = join(fixture.runRoot, "grading", analysis.analysisId);
    const manifest = JSON.parse(
      await readFile(join(detailsRoot, "manifest.json"), "utf8"),
    ) as unknown;
    expect(analysis.detailsPath).toBe(`grading/${analysis.analysisId}/manifest.json`);
    expect(analysis.detailsDigest).toBe(contentDigest(manifest));
    expect(recordAfter.analyses.at(-1)).toEqual(analysis);
    expect(recordAfter.evaluations).toEqual(recordBefore.evaluations);
    expect(recordAfter.status).toBe(recordBefore.status);
    expect(await readFile(fixture.tracePath)).toEqual(traceBefore);
    await expect(access(join(detailsRoot, "evidence.json"))).resolves.toBeUndefined();
    await expect(access(join(detailsRoot, "metrics.json"))).resolves.toBeUndefined();
    expect(
      (await readdir(join(fixture.runRoot, "grading"))).filter((path) => path.startsWith(".")),
    ).toEqual([]);
  });

  it("rejects duplicate source/configuration identities without replacing details", async () => {
    const fixture = await createCompletedRunFixture();
    const first = await gradeRun({
      root: fixture.root,
      projectRoot: process.cwd(),
      runRoot: fixture.runRoot,
    });
    const evidencePath = join(fixture.runRoot, "grading", first.analysisId, "evidence.json");
    const before = await readFile(evidencePath);

    await expect(
      gradeRun({ root: fixture.root, projectRoot: process.cwd(), runRoot: fixture.runRoot }),
    ).rejects.toThrow(/already exists/);

    expect(await readFile(evidencePath)).toEqual(before);
    expect(await readdir(join(fixture.runRoot, "grading"))).toEqual([first.analysisId]);
  });

  it("cleans an atomically published directory when record append fails", async () => {
    const fixture = await createCompletedRunFixture();

    await expect(
      gradeRun(
        { root: fixture.root, projectRoot: process.cwd(), runRoot: fixture.runRoot },
        {
          appendAnalysis: async () => {
            throw new Error("synthetic append failure");
          },
        },
      ),
    ).rejects.toThrow("synthetic append failure");

    expect(await readdir(join(fixture.runRoot, "grading"))).toEqual([]);
    const record = decodeRunRecord(
      JSON.parse(await readFile(join(fixture.runRoot, "run.json"), "utf8")),
    );
    expect(record.analyses).toEqual([]);
  });

  it("grades thousands of events with complete bounded windows and explicit excerpts", async () => {
    const fixture = await createCompletedRunFixture({
      observations: Array.from({ length: 3_000 }, (_, index) => ({
        kind: index % 5 === 0 ? "model.response" : "tool.started",
        agentId: index % 2 === 0 ? ("agent-1" as const) : ("agent-2" as const),
        atMs: index + 1,
        data:
          index % 100 === 0
            ? { reasoningSummary: "x".repeat(9_000) }
            : {
                id: `call-${String(index)}`,
                name: "execute_shell",
                arguments: { command: "true" },
              },
      })),
    });

    const analysis = await gradeRun({
      root: fixture.root,
      projectRoot: process.cwd(),
      runRoot: fixture.runRoot,
    });
    const evidence = JSON.parse(
      await readFile(
        join(fixture.runRoot, "grading", analysis.analysisId, "evidence.json"),
        "utf8",
      ),
    ) as {
      items: { evidenceId: string }[];
      windows: { evidenceIds: string[]; byteCount: number }[];
      omissions: { reason: string }[];
    };
    const covered = evidence.windows.flatMap(({ evidenceIds }) => evidenceIds);

    expect(evidence.items.length).toBeGreaterThanOrEqual(3_000);
    expect(covered).toEqual(evidence.items.map(({ evidenceId }) => evidenceId));
    expect(evidence.windows.every(({ byteCount }) => byteCount <= EVIDENCE_WINDOW_BYTES)).toBe(
      true,
    );
    expect(evidence.omissions.some(({ reason }) => reason.includes("excerpted"))).toBe(true);
    expect(
      (await readdir(join(fixture.runRoot, "grading"))).filter((path) => path.startsWith(".")),
    ).toEqual([]);
  }, 30_000);
});
