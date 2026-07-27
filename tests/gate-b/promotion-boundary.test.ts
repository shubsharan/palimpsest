import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("Gate B solver promotion boundary", () => {
  it("rejects undeclared manifest fields before promotion", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-gate-b-"));
    try {
      await writeFile(
        join(root, "manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          instanceId: "instance-amber",
          condition: "frontier-agent-tools",
          solverIdentity: "test",
          checkpoints: [],
          oraclePath: "forbidden.json",
        }),
      );
      await expect(
        execFileAsync("uv", [
          "run",
          "--offline",
          "--frozen",
          "--project",
          "python",
          "python",
          "-m",
          "palimpsest.gate_b.solver_import",
          "--input",
          root,
        ]),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("rejects paths that escape a checkpoint bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-gate-b-"));
    try {
      await writeFile(
        join(root, "manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          instanceId: "instance-amber",
          condition: "frontier-agent-tools",
          solverIdentity: "test",
          checkpoints: [
            {
              sequence: 0,
              trustedElapsedSeconds: 1,
              reconstructionPath: "../outside.txt",
              mappingPath: "mapping.json",
              toolEventsPath: "tools.json",
              identificationClaimsPath: "claims.json",
              usagePath: "usage.json",
            },
          ],
        }),
      );
      await expect(
        execFileAsync("uv", [
          "run",
          "--offline",
          "--frozen",
          "--project",
          "python",
          "python",
          "-m",
          "palimpsest.gate_b.solver_import",
          "--input",
          root,
        ]),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
