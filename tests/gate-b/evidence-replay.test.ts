import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { referenceBundle } from "../../tools/gate-b/artifacts.js";

const execFileAsync = promisify(execFile);

describe("Gate B deterministic instance evidence", () => {
  it("rebuilds every instance byte-for-byte", async () => {
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
  }, 60_000);
});
