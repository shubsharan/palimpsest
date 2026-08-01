import { describe, expect, it } from "vitest";

import { buildFixtureFromFlags, sandboxDockerBuildArguments } from "./build.js";

describe("fixture build boundary", () => {
  it("builds one locally runnable image without an attestation index", () => {
    const sourceDigest = "d".repeat(64);
    expect(sandboxDockerBuildArguments(sourceDigest)).toEqual([
      "build",
      "--provenance=false",
      "--tag",
      "palimpsest-puzzle-sandbox:0.1.0",
      "--build-arg",
      `PALIMPSEST_SANDBOX_SOURCE_DIGEST=${sourceDigest}`,
      "containers/puzzle-sandbox",
    ]);
  });

  it("requires a fixture declaration and output root", () => {
    expect(() => buildFixtureFromFlags(new Map([["--output", "out"]]))).toThrow(
      "--fixture is required.",
    );
    expect(() => buildFixtureFromFlags(new Map([["--fixture", "fixture"]]))).toThrow(
      "--output is required.",
    );
  });

  it("rejects build controls outside the fixture contract", () => {
    expect(() =>
      buildFixtureFromFlags(
        new Map([
          ["--fixture", "fixture"],
          ["--output", "out"],
          ["--condition", "CR"],
        ]),
      ),
    ).toThrow("Unknown build option --condition.");
  });
});
