import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { referenceBundle } from "../../tools/gate-b/artifacts.js";

const execFileAsync = promisify(execFile);
const modelAvailable = existsSync(
  "artifacts/gate-b/inputs/models/distilroberta-base/model.safetensors",
);

describe("Gate B deterministic instance evidence", () => {
  // The acquired model is digest-pinned but intentionally excluded from Git snapshots.
  it.runIf(modelAvailable)(
    "rebuilds every instance byte-for-byte",
    async () => {
      await execFileAsync("uv", [
        "run",
        "--offline",
        "--frozen",
        "--project",
        "python",
        "python",
        "-m",
        "palimpsest.gate_b.instance_producer",
        "--all",
      ]);
      const afterFirst = await referenceBundle("gate-b-instances", ["artifacts/gate-b/instances"]);
      await execFileAsync("uv", [
        "run",
        "--offline",
        "--frozen",
        "--project",
        "python",
        "python",
        "-m",
        "palimpsest.gate_b.instance_producer",
        "--all",
      ]);
      const afterSecond = await referenceBundle("gate-b-instances", ["artifacts/gate-b/instances"]);
      expect(afterSecond).toEqual(afterFirst);
    },
    60_000,
  );
});
