import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  EXPECTED_TOOL_VERSIONS,
  readActualToolVersions,
  verifyDeclaredPins,
  verifyVersionMap,
} from "../../tools/verify-versions.js";

const ROOT_CONFIGURATION_PATHS = new Set([
  "oxfmt.json",
  "oxlint.json",
  "package.json",
  "pnpm-lock.yaml",
  "python/pyproject.toml",
  "python/uv.lock",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.config.ts",
]);

const DELETED_LAYOUT_PATHS = [
  "packages/puzzle-runner/package.json",
  "packages/puzzle-runner/tsconfig.json",
  "pnpm-workspace.yaml",
  "src/index.ts",
  "src/adapters.test.ts",
  "src/adapters.ts",
  "src/evaluator.test.ts",
  "src/evaluator.ts",
  "src/observations.test.ts",
  "src/observations.ts",
  "src/sandbox.test.ts",
  "src/sandbox.ts",
  "src/supervisor.test.ts",
  "src/supervisor.ts",
  "python/palimpsest/puzzle/checker.py",
  "python/palimpsest/puzzle/model.py",
  "python/palimpsest/puzzle/overlap.py",
  "python/palimpsest/puzzle/score.py",
  "python/palimpsest/puzzle/serialization.py",
] as const;

const DELETED_REFERENCE_PATTERNS = [
  /@palimpsest\/puzzle-runner/g,
  /packages\/puzzle-runner/g,
  /tools\/puzzle/g,
  /python\/src\/palimpsest/g,
  /\b(?:AgentAdapter|FixtureAgentAdapter|OpenAIAgentAdapter)\b/g,
  /\bSupervisor\b/g,
  /\bparseAttemptConfig\b/g,
] as const;

async function activeRepositoryPaths(): Promise<string[]> {
  const candidates = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((path) => path.length > 0);

  const existingPaths = await Promise.all(
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

  return existingPaths.filter((path): path is string => path !== undefined).sort();
}

function isActiveReferenceScope(path: string): boolean {
  return (
    path !== "tests/integration/verification.test.ts" &&
    (ROOT_CONFIGURATION_PATHS.has(path) ||
      path.startsWith("src/") ||
      path.startsWith("python/palimpsest/") ||
      path.startsWith("python/tests/") ||
      path.startsWith("tests/puzzle/") ||
      path.startsWith("tools/"))
  );
}

async function deletedReferences(paths: string[]): Promise<string[]> {
  const findings = await Promise.all(
    paths.filter(isActiveReferenceScope).map(async (path) => {
      const source = await readFile(path, "utf8");
      return DELETED_REFERENCE_PATTERNS.flatMap((pattern) =>
        [...source.matchAll(pattern)].map((match) => {
          const line = source.slice(0, match.index).split("\n").length;
          return `${path}:${line}: ${match[0]}`;
        }),
      );
    }),
  );

  return findings.flat().sort();
}

describe("active repository boundary", () => {
  test("the active toolchain exactly matches every declared pin", async () => {
    await expect(readActualToolVersions()).resolves.toEqual(EXPECTED_TOOL_VERSIONS);
    await expect(verifyDeclaredPins()).resolves.toBeUndefined();
  });

  test("an unsupported runtime version is rejected explicitly", () => {
    expect(() =>
      verifyVersionMap({
        ...EXPECTED_TOOL_VERSIONS,
        node: "0.0.0",
      }),
    ).toThrow(/node.*expected 26\.5\.0.*received 0\.0\.0/i);
  });

  test("has one root TypeScript application and one Python distribution", async () => {
    const paths = await activeRepositoryPaths();
    const packageManifests = paths.filter((path) => path.endsWith("package.json"));
    const pythonSources = paths.filter(
      (path) => path.endsWith(".py") && !path.startsWith("python/tests/"),
    );

    expect(packageManifests).toEqual(["package.json"]);
    expect(paths).toContain("src/cli.ts");
    expect(pythonSources.length).toBeGreaterThan(0);
    expect(pythonSources.every((path) => path.startsWith("python/palimpsest/"))).toBe(true);
    expect(paths.filter((path) => path.startsWith("tools/"))).toEqual(["tools/verify-versions.ts"]);
  });

  test("has no workspace, alias, barrel, facade, or obsolete mixed owner", async () => {
    const paths = await activeRepositoryPaths();
    const [packageSource, tsconfigBase, tsconfig, vitest, oxlint, oxfmt, pyproject] =
      await Promise.all([
        readFile("package.json", "utf8"),
        readFile("tsconfig.base.json", "utf8"),
        readFile("tsconfig.json", "utf8"),
        readFile("vitest.config.ts", "utf8"),
        readFile("oxlint.json", "utf8"),
        readFile("oxfmt.json", "utf8"),
        readFile("python/pyproject.toml", "utf8"),
      ]);
    const packageManifest = JSON.parse(packageSource) as { workspaces?: unknown };
    const activeConfiguration = [
      packageSource,
      tsconfigBase,
      tsconfig,
      vitest,
      oxlint,
      oxfmt,
      pyproject,
    ].join("\n");

    expect(DELETED_LAYOUT_PATHS.filter((path) => paths.includes(path))).toEqual([]);
    expect(packageManifest.workspaces).toBeUndefined();
    expect(activeConfiguration).not.toMatch(
      /@palimpsest\/puzzle-runner|packages\/puzzle-runner|tools\/puzzle/,
    );
    expect(packageSource).toMatch(/oxfmt .* src tools tests specs docs /);
    expect(packageSource).toMatch(/oxlint --deny-warnings src tools tests vitest\.config\.ts/);
    expect(tsconfig).toContain('"src/**/*.ts"');
    expect(tsconfig).toContain('"tests/**/*.ts"');
    expect(vitest).toContain('"src/**/*.test.ts"');
    expect(vitest).toContain('"tests/**/*.test.ts"');
    expect(pyproject).toContain('packages = ["palimpsest"]');
    expect(pyproject).toContain('pythonpath = ["."]');
    expect(pyproject).toContain('testpaths = ["tests"]');
    expect(pyproject).toContain('src = ["."]');
    expect(pyproject).not.toMatch(/python\/src|src\/palimpsest/);
  });

  test("has no active references to deleted paths or names", async () => {
    expect(await deletedReferences(await activeRepositoryPaths())).toEqual([]);
  });

  test("is unchanged by ignored caches and empty legacy directories", async () => {
    const baseline = await activeRepositoryPaths();
    const cacheRoot = "artifacts/verification-cache/__pycache__";
    const emptyLegacyRoot = "packages/puzzle-runner/verification-empty";
    try {
      await mkdir(cacheRoot, { recursive: true });
      await writeFile(`${cacheRoot}/probe.pyc`, "ignored cache\n", "utf8");
      await mkdir(emptyLegacyRoot, { recursive: true });
      expect(await activeRepositoryPaths()).toEqual(baseline);
    } finally {
      await Promise.all([
        rm("artifacts/verification-cache", { recursive: true, force: true }),
        rm(emptyLegacyRoot, { recursive: true, force: true }),
      ]);
    }
  });

  test("treats an unstaged source move as one current path, not one cached deleted path", async () => {
    const paths = await activeRepositoryPaths();
    expect(paths).toContain("src/activity.ts");
    expect(paths).not.toContain("packages/puzzle-runner/src/activity.ts");
  });
});
