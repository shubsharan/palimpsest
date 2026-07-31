import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  EXPECTED_TOOL_VERSIONS,
  readActualToolVersions,
  verifyDeclaredPins,
  verifyVersionMap,
} from "../../tools/verify-versions.js";

const REMOVED_RUNTIME_PATHS = [
  "src/artifacts.ts",
  "src/condition.ts",
  "src/configured-run.ts",
  "src/offline.ts",
  "src/preflight.ts",
  "src/study.ts",
] as const;

const REMOVED_SPEC_ROOTS = [
  "specs/009-refactor-puzzle-architecture",
  "specs/010-agent-sandbox-lifecycle",
  "specs/011-configurable-research-runs",
  "specs/012-simple-research-ci",
  "specs/013-engineered-paired-blocks",
  "specs/014-four-team-conditions",
  "specs/015-frozen-five-block-protocol",
  "specs/016-optional-team-channel",
  "specs/019-configurable-run-controls",
] as const;

async function activeRepositoryPaths(): Promise<string[]> {
  const candidates = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const paths = await Promise.all(
    candidates.map(async (path) => {
      try {
        return (await stat(path)).isFile() ? path : undefined;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return undefined;
        }
        throw error;
      }
    }),
  );
  return paths.filter((path): path is string => path !== undefined).sort();
}

describe("lean research boundary", () => {
  test("pins the language toolchain", async () => {
    expect(Object.keys(EXPECTED_TOOL_VERSIONS).sort()).toEqual(["node", "pnpm", "python", "uv"]);
    await expect(readActualToolVersions()).resolves.toEqual(EXPECTED_TOOL_VERSIONS);
    await expect(verifyDeclaredPins()).resolves.toBeUndefined();
    expect(() => verifyVersionMap({ ...EXPECTED_TOOL_VERSIONS, node: "0.0.0" })).toThrow(
      /node.*expected 26\.5\.0.*received 0\.0\.0/i,
    );
  });

  test("keeps one TypeScript application and one Python package", async () => {
    const paths = await activeRepositoryPaths();
    expect(paths.filter((path) => path.endsWith("package.json"))).toEqual(["package.json"]);
    expect(paths).toContain("src/cli.ts");
    expect(
      paths
        .filter((path) => path.endsWith(".py") && !path.startsWith("python/tests/"))
        .every((path) => path.startsWith("python/palimpsest/")),
    ).toBe(true);
  });

  test("exposes fixture build, validation, execution, and evaluation", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      "puzzle:build": "tsx src/cli.ts build",
      "puzzle:validate": "tsx src/cli.ts validate",
      "puzzle:experiment": "tsx src/cli.ts experiment",
      "puzzle:evaluate": "tsx src/cli.ts evaluate",
    });
    expect(packageJson.scripts).not.toHaveProperty("puzzle:run");
    expect(packageJson.scripts).not.toHaveProperty("puzzle:offline");
    expect(packageJson.scripts).not.toHaveProperty("preflight");
  });

  test("keeps one explicit run-list manifest", async () => {
    const [schemaSource, manifestSource] = await Promise.all([
      readFile("experiments/schema.json", "utf8"),
      readFile("experiments/config.yaml", "utf8"),
    ]);
    const schema = JSON.parse(schemaSource) as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).toHaveProperty("providers");
    expect(schema.properties).toHaveProperty("models");
    expect(schema.properties).toHaveProperty("runs");
    expect(schema.properties).not.toHaveProperty("phases");
    expect(schema.properties).not.toHaveProperty("conditions");
    expect(manifestSource).toContain("schemaVersion: 1");
    expect(manifestSource).toContain("runs:");
    expect(manifestSource).toContain("capabilities:");
  });

  test("has no active fixed-condition or study-state runtime", async () => {
    await Promise.all(
      [...REMOVED_RUNTIME_PATHS, ...REMOVED_SPEC_ROOTS].map((path) =>
        expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" }),
      ),
    );
    const runtime = (
      await Promise.all(
        (
          await activeRepositoryPaths()
        )
          .filter(
            (path) => path.startsWith("src/") && path.endsWith(".ts") && !path.endsWith(".test.ts"),
          )
          .map((path) => readFile(path, "utf8")),
      )
    ).join("\n");
    expect(runtime).not.toMatch(/\b(?:CS|CR|IS|IR)\b/);
    expect(runtime).not.toMatch(/StudyPhase|PhaseSummary|DesignReceipt|PreflightReceipt/);
    expect(runtime).not.toMatch(/\b(?:interface|type|class|function)\s+[A-Za-z0-9_]*V1\b/);
  });

  test("keeps current guidance on the Feature 021 scientific flow", async () => {
    const [proposal, quickstart, agents] = await Promise.all([
      readFile("docs/proposal.md", "utf8"),
      readFile("specs/021-lean-experiment-engine/quickstart.md", "utf8"),
      readFile("AGENTS.md", "utf8"),
    ]);
    expect(proposal).toMatch(/FixtureDefinition.*FixturePackage.*ExperimentManifest.*RunRecord/s);
    expect(quickstart).toContain("pnpm puzzle:validate");
    expect(quickstart).toContain("--allow-spend true");
    expect(agents).toContain("specs/021-lean-experiment-engine/plan.md");
  });

  test("ignores caches and empty generated directories", async () => {
    const baseline = await activeRepositoryPaths();
    const cacheRoot = "src/__pycache__";
    const emptyRoot = "src/verification-empty";
    try {
      await mkdir(cacheRoot, { recursive: true });
      await writeFile(`${cacheRoot}/probe.pyc`, "ignored\n", "utf8");
      await mkdir(emptyRoot);
      expect(await activeRepositoryPaths()).toEqual(baseline);
    } finally {
      await Promise.all([
        rm(cacheRoot, { recursive: true, force: true }),
        rm(emptyRoot, { recursive: true, force: true }),
      ]);
    }
  });
});
