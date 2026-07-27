import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { validateGateReport } from "@palimpsest/contracts";
import { describe, expect, test } from "vitest";

import { replayGateC } from "../../tools/gate-c/replay.js";
import { buildGateCPredeclaration } from "../../tools/gate-c/report.js";

const execFileAsync = promisify(execFile);
const digest = "a".repeat(64);
const runId = "run-1";
const attemptId = `gate-c/${digest}/${runId}`;

function mapping(cipherType: string, plainType: string) {
  return {
    cipherType,
    plainType,
    confidence: 0.9,
    status: "active",
    supportingRevealOrdinals: [1],
    rationale: "cross-runtime fixture",
  };
}

function checkpoint(
  ordinal: number,
  revealOrdinal: number,
  observedMonotonicMs: number,
  mappings: ReturnType<typeof mapping>[],
  detected = false,
) {
  return {
    schemaVersion: 1,
    contractId: "solver-checkpoint",
    attemptId,
    ordinal,
    revealOrdinal,
    observedMonotonicMs,
    responseId: `resp_${ordinal}`,
    previousResponseId: ordinal === 1 ? null : `resp_${ordinal - 1}`,
    containerId: "cntr_fixture",
    mappings,
    switchHypotheses: detected
      ? [{ afterChapter: 12, confidence: 0.9, evidence: "localized contradiction" }]
      : [],
    reconstructionRefs: [],
    usage: { inputTokens: 1, outputTokens: 1, toolCalls: 1 },
  };
}

describe("Gate C report and cross-runtime replay", () => {
  test("builds a digest-bound valid predeclaration", () => {
    const report = buildGateCPredeclaration([
      { artifactType: "fixture", byteLength: 1, sha256: "b".repeat(64) },
    ]);
    expect(validateGateReport(report)).toMatchObject({ accepted: true });
    expect(report.predeclarationDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("scores in Python and replays the same explicit attempt through TypeScript", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-gate-c-replay-"));
    const attemptsRoot = join(root, "attempts");
    const attempt = join(attemptsRoot, digest, runId);
    await mkdir(join(attempt, "inputs"), { recursive: true });
    await writeFile(
      join(attempt, "attempt.json"),
      JSON.stringify({
        attemptId,
        declarationDigest: digest,
        runId,
        startedAt: "2026-07-26T00:00:00Z",
        phase: "running",
        model: "gpt-5.6-sol",
        environment: {
          git: "2.48.1",
          node: "26.5.0",
          pnpm: "10.14.0",
          python: "3.12.4",
          uv: "0.11.14",
          platform: "fixture",
          revision: "d".repeat(40),
        },
      }),
    );
    for (const name of ["private-instance.json", "reveal-plan.json"]) {
      await writeFile(
        join(attempt, "inputs", name),
        await readFile(join("artifacts/gate-c/calibration", name)),
      );
    }
    const revealPlan = JSON.parse(
      await readFile(join(attempt, "inputs/reveal-plan.json"), "utf8"),
    ) as {
      slots: Array<{
        chapterIndex: number;
        ordinal: number;
        plannedOffsetMs: number;
        cipherChapterArtifact: Record<string, unknown>;
      }>;
    };
    await writeFile(
      join(attempt, "inputs/changed-entries.json"),
      JSON.stringify([{ plainType: "plain", priorCipherType: "old", revisedCipherType: "new" }]),
    );
    await writeFile(
      join(attempt, "inputs/matched-controls.json"),
      JSON.stringify([{ plainType: "stable", cipherType: "stable-cipher" }]),
    );
    const prior = [mapping("old", "plain"), mapping("stable-cipher", "stable")];
    const revised = [mapping("new", "plain"), mapping("stable-cipher", "stable")];
    await writeFile(
      join(attempt, "checkpoints.json"),
      JSON.stringify([
        checkpoint(1, 1, 0, []),
        checkpoint(2, 2, 120_000, prior),
        checkpoint(3, 3, 240_000, prior),
        checkpoint(4, 4, 360_000, prior),
        checkpoint(5, 5, 480_000, revised, true),
        checkpoint(6, 6, 600_000, revised),
      ]),
    );
    await writeFile(
      join(attempt, "reveal-events.json"),
      JSON.stringify(
        revealPlan.slots.map((slot) => ({
          schemaVersion: 1,
          contractId: "reveal-event",
          attemptId,
          ordinal: slot.ordinal,
          chapterIndex: slot.chapterIndex,
          plannedOffsetMs: slot.plannedOffsetMs,
          observedOffsetMs: slot.plannedOffsetMs,
          chapterArtifact: slot.cipherChapterArtifact,
        })),
      ),
    );
    await writeFile(
      join(attempt, "solver-completion.json"),
      JSON.stringify({
        schemaVersion: 1,
        attemptId,
        status: "solver-completed",
        model: "gpt-5.6-sol",
        containerId: "cntr_fixture",
        responseChain: Array.from({ length: 6 }, (_, index) => `resp_${index + 1}`),
        checkpointCount: 6,
      }),
    );
    await execFileAsync(
      "uv",
      [
        "run",
        "--offline",
        "--frozen",
        "--project",
        "python",
        "python",
        "-m",
        "palimpsest.gate_c.score_attempt",
        "--declaration-digest",
        digest,
        "--run-id",
        runId,
        "--attempts-root",
        attemptsRoot,
      ],
      { encoding: "utf8" },
    );
    const output = JSON.parse(
      await replayGateC([
        "--declaration-digest",
        digest,
        "--run-id",
        runId,
        "--attempts-root",
        attemptsRoot,
      ]),
    );
    expect(output).toEqual({
      attemptId,
      classification: "pass",
      checkpointCount: 6,
    });
  });
});
