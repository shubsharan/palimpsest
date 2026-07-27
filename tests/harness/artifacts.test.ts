import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  createAttempt,
  sealCurrentAttemptFailure,
  sealFailedAttempt,
  sealAttempt,
  verifyTerminalAttempt,
} from "../../tools/harness/artifacts.js";

const declarationDigest = "a".repeat(64);

describe("offline harness attempts", () => {
  test("seals an exact output set and rejects post-terminal mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-harness-artifacts-"));
    const identity = { declarationDigest, runId: "run-001" };
    const path = await createAttempt({
      root,
      identity,
      startedAt: "2026-07-26T00:00:00.000Z",
    });
    await writeFile(join(path, "result.txt"), "fixture result\n");
    await sealAttempt({ root, identity, classification: "completed" });
    await expect(verifyTerminalAttempt({ root, identity })).resolves.toMatchObject({
      classification: "completed",
      runId: "run-001",
    });
    await expect(sealAttempt({ root, identity, classification: "completed" })).rejects.toThrow(
      /terminal/i,
    );
    await writeFile(join(path, "late.txt"), "undeclared\n");
    await expect(verifyTerminalAttempt({ root, identity })).rejects.toThrow(/exact output set/i);
  });

  test("ignores a mutable pointer and leaves prior attempts byte-identical", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-harness-isolation-"));
    const first = { declarationDigest, runId: "run-001" };
    const second = { declarationDigest, runId: "run-002" };
    const firstPath = await createAttempt({
      root,
      identity: first,
      startedAt: "2026-07-26T00:00:00.000Z",
    });
    await writeFile(join(firstPath, "result.txt"), "first\n");
    await sealAttempt({ root, identity: first, classification: "completed" });
    const before = await readFile(join(firstPath, "terminal.json"));

    const secondPath = await createAttempt({
      root,
      identity: second,
      startedAt: "2026-07-26T00:01:00.000Z",
    });
    await writeFile(join(secondPath, "result.txt"), "second\n");
    await sealAttempt({ root, identity: second, classification: "failed" });
    await writeFile(
      join(root, "current.json"),
      JSON.stringify({ evidence: false, attemptPath: "/wrong/path" }),
    );

    await expect(verifyTerminalAttempt({ root, identity: first })).resolves.toMatchObject({
      runId: "run-001",
    });
    expect(await readFile(join(firstPath, "terminal.json"))).toEqual(before);
  });

  test("records deterministic failure evidence and repairs a stale running pointer", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-harness-failure-"));
    const identity = { declarationDigest, runId: "run-failed" };
    const path = await createAttempt({
      root,
      identity,
      startedAt: "2026-07-26T00:00:00.000Z",
    });
    await writeFile(join(path, "partial.txt"), "partial output\n");

    const terminal = await sealFailedAttempt({
      root,
      identity,
      phase: "grade",
      error: new Error("grading failed"),
    });
    expect(terminal.classification).toBe("failed");
    expect(JSON.parse(await readFile(join(path, "failure.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      declarationDigest,
      runId: "run-failed",
      phase: "grade",
      errorName: "Error",
      message: "grading failed",
    });
    const terminalBytes = await readFile(join(path, "terminal.json"));

    await writeFile(
      join(root, "current.json"),
      JSON.stringify({
        schemaVersion: 1,
        attemptId: `harness/${declarationDigest}/run-failed`,
        declarationDigest,
        runId: "run-failed",
        attemptPath: path,
        status: "running",
        evidence: false,
      }),
    );
    await expect(
      sealCurrentAttemptFailure({
        root,
        runId: "run-failed",
        phase: "grade",
        error: new Error("grading failed"),
      }),
    ).resolves.toMatchObject({ classification: "failed" });
    expect(await readFile(join(path, "terminal.json"))).toEqual(terminalBytes);
    expect(JSON.parse(await readFile(join(root, "current.json"), "utf8"))).toMatchObject({
      runId: "run-failed",
      status: "failed",
      evidence: false,
    });
    await expect(verifyTerminalAttempt({ root, identity })).resolves.toMatchObject({
      classification: "failed",
    });
  });
});
