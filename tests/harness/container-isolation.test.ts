import { readFile } from "node:fs/promises";

import { sha256Hex } from "@palimpsest/contracts";
import { describe, expect, test } from "vitest";

import {
  CLEAN_SOLVER_IMAGE_TAG,
  CONTAINER_BASE_IMAGE,
  FIXTURE_IMAGE_TAG,
} from "../../tools/harness/config.js";

describe("container isolation declarations", () => {
  test("pins image content, immutable bases, packages, and non-root users", async () => {
    expect(CONTAINER_BASE_IMAGE).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(FIXTURE_IMAGE_TAG).toBe("palimpsest-fixture-agent:0.1.0");
    expect(CLEAN_SOLVER_IMAGE_TAG).toBe("palimpsest-clean-solver:0.1.0");
    const fixture = await readFile("containers/fixture-agent/Dockerfile", "utf8");
    const solver = await readFile("containers/clean-solver/Dockerfile", "utf8");
    const lock = JSON.parse(await readFile("containers/images.lock.json", "utf8"));
    expect(lock.baseImage).toBe(CONTAINER_BASE_IMAGE);
    expect(lock.fixtureAgent).toMatchObject({
      tag: FIXTURE_IMAGE_TAG,
      dockerfileSha256: sha256Hex(Buffer.from(fixture)),
    });
    expect(lock.cleanSolver).toMatchObject({
      tag: CLEAN_SOLVER_IMAGE_TAG,
      dockerfileSha256: sha256Hex(Buffer.from(solver)),
    });
    for (const dockerfile of [fixture, solver]) {
      expect(dockerfile).toContain(CONTAINER_BASE_IMAGE);
      expect(dockerfile).toMatch(/\nUSER [1-9]/);
    }
    expect(fixture).toContain("pnpm install --frozen-lockfile");
    expect(solver).not.toContain("COPY ");
  });

  test("keeps credentials, source material, and oracle data outside image builds", async () => {
    const source = [
      await readFile("containers/fixture-agent/Dockerfile", "utf8"),
      await readFile("containers/clean-solver/Dockerfile", "utf8"),
    ].join("\n");
    expect(source).not.toMatch(
      /OPENAI_API_KEY|\.env|artifacts\/|docs\/|sealed\/|prepared\.txt|oracle|private\//i,
    );
  });

  test("declares least-privilege mounts, capabilities, users, and networks", async () => {
    const runtime = await readFile("tools/harness/container-runtime.ts", "utf8");
    const run = await readFile("tools/harness/run.ts", "utf8");
    const solver = await readFile("python/src/palimpsest/solver/executor.py", "utf8");
    for (const source of [runtime, run, solver]) {
      expect(source).toContain('"--read-only"');
      expect(source).toContain('"--cap-drop"');
      expect(source).toContain('"no-new-privileges"');
      expect(source).toContain('"--pids-limit"');
      expect(source).toContain('"--memory"');
      expect(source).toContain('"--cpus"');
    }
    expect(runtime).toContain('"--internal"');
    expect(runtime).toContain('"--user"');
    expect(run).toContain(":/request/invocation.json:ro");
    expect(run).toContain(":/input:ro");
    expect(run).toContain(":/workspace:rw");
    expect(run).toContain(":/output:rw");
    expect(run).not.toContain("sealed/prepared.txt");
    expect(solver).toContain('"none"');
    expect(solver).toContain(":/submission/solver.sh:ro");
    expect(solver).toContain(":/input:ro");
    expect(solver).toContain(":/output:rw");
  });
});
