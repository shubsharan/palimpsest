import { describe, expect, it } from "vitest";

import { buildFixtureFromFlags, sandboxDockerBuildArguments } from "./build.js";

describe("fixture build boundary", () => {
  it("builds one locally runnable image without an attestation index", () => {
    const sourceDigest = "d".repeat(64);
    expect(sandboxDockerBuildArguments(sourceDigest)).toEqual([
      "build",
      "--provenance=false",
      "--tag",
      `palimpsest-puzzle-sandbox:sha256-${sourceDigest}`,
      "--build-arg",
      `PALIMPSEST_SANDBOX_SOURCE_DIGEST=${sourceDigest}`,
      "containers/puzzle-sandbox",
    ]);
  });

  it("uses the canonical config by default and rejects legacy build flags", async () => {
    await expect(buildFixtureFromFlags(new Map([["--output", "out"]]))).rejects.toThrow(
      "Unknown build option --output.",
    );
    await expect(buildFixtureFromFlags(new Map([["--fixture", "fixture"]]))).rejects.toThrow(
      "Unknown build option --fixture.",
    );
  });

  it("rejects build controls outside the run contract", async () => {
    await expect(
      buildFixtureFromFlags(
        new Map([
          ["--fixture", "fixture"],
          ["--output", "out"],
          ["--condition", "CR"],
        ]),
      ),
    ).rejects.toThrow("Unknown build option --fixture.");
  });
});
