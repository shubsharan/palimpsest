import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  createAttempt,
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
});
