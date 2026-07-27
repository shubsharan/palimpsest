import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  CLEAN_SOLVER_IMAGE_TAG,
  CONTAINER_BASE_IMAGE,
  FIXTURE_IMAGE_TAG,
} from "../../tools/harness/config.js";

describe("container isolation declarations", () => {
  test("pins the immutable base and non-root fixture and solver images", async () => {
    expect(CONTAINER_BASE_IMAGE).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(FIXTURE_IMAGE_TAG).toBe("palimpsest-fixture-agent:0.1.0");
    expect(CLEAN_SOLVER_IMAGE_TAG).toBe("palimpsest-clean-solver:0.1.0");
    const fixture = await readFile("containers/fixture-agent/Dockerfile", "utf8");
    const solver = await readFile("containers/clean-solver/Dockerfile", "utf8");
    for (const dockerfile of [fixture, solver]) {
      expect(dockerfile).toContain(CONTAINER_BASE_IMAGE);
      expect(dockerfile).toMatch(/\nUSER [1-9]/);
    }
  });

  test("keeps credentials and oracle material outside image build instructions", async () => {
    const source = [
      await readFile("containers/fixture-agent/Dockerfile", "utf8"),
      await readFile("containers/clean-solver/Dockerfile", "utf8"),
    ].join("\n");
    expect(source).not.toMatch(/OPENAI_API_KEY|\.env|sealed\/|prepared\.txt|oracle/i);
  });
});
