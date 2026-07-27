import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, test } from "vitest";

import { buildRuntimeVerdicts } from "../../tools/evidence/compare-runtimes.js";
import { predeclarationDigest } from "@palimpsest/contracts";

const execFileAsync = promisify(execFile);

describe("cross-runtime contract authority", () => {
  test("TypeScript and Python emit identical verdicts and canonical bytes", async () => {
    const typeScriptVerdicts = await buildRuntimeVerdicts("typescript");
    const { stdout } = await execFileAsync(
      "uv",
      [
        "run",
        "--project",
        "python",
        "python",
        "-m",
        "palimpsest.contracts.validation",
        "--fixture-verdicts",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const pythonVerdicts = JSON.parse(stdout);
    expect(typeScriptVerdicts).toEqual(pythonVerdicts);
  });

  test("the gate report predeclaration digest is runtime-independent", async () => {
    const report = {
      schemaVersion: 1,
      gateId: "fixture-gate",
      question: "Does the fixture pass?",
      frozenInputs: [
        {
          artifactType: "fixture",
          byteLength: 1,
          sha256: "a".repeat(64),
        },
      ],
      thresholds: [
        {
          name: "zero errors",
          metric: "fixture.errors",
          operator: "eq",
          value: "0",
          unit: "count",
        },
      ],
      criteria: {
        pass: "Zero errors.",
        rework: "Any error.",
        stop: "Not applicable.",
      },
    };
    const { stdout } = await execFileAsync(
      "uv",
      [
        "run",
        "--project",
        "python",
        "python",
        "-m",
        "palimpsest.contracts.gate_report",
        "--predeclaration-digest",
        JSON.stringify(report),
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(predeclarationDigest(report)).toBe(stdout.trim());
  });
});
