import { access, readFile, readdir } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  EXPECTED_TOOL_VERSIONS,
  readActualToolVersions,
  verifyDeclaredPins,
  verifyVersionMap,
} from "../../tools/verify-versions.js";

async function names(path: string): Promise<string[]> {
  return (await readdir(path)).sort();
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

  test("retains only the behavior-neutral runner, its current feature, and puzzle corpus", async () => {
    expect(await names("packages")).toEqual(["puzzle-runner"]);
    expect((await names("python/src/palimpsest")).filter((name) => name !== "__pycache__")).toEqual(
      ["__init__.py", "puzzle"],
    );
    expect(
      (await names("python/tests")).filter(
        (name) => !name.startsWith(".") && name !== "__pycache__",
      ),
    ).toEqual(["puzzle"]);
    expect(await names("specs")).toEqual([
      "006-behavior-neutral-runner",
      "008-runner-hardening-cleanup",
    ]);
    expect(await names("fixtures/corpus")).toEqual([
      "jane-eyre.txt",
      "middlemarch.txt",
      "moby-dick.txt",
      "provenance.json",
    ]);
    await expect(access("artifacts")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("keeps independent locks and removes legacy scripts, aliases, and dependencies", async () => {
    await expect(access("pnpm-lock.yaml")).resolves.toBeUndefined();
    await expect(access("python/uv.lock")).resolves.toBeUndefined();
    const [packageSource, tsconfig, vitest, pyproject] = await Promise.all([
      readFile("package.json", "utf8"),
      readFile("tsconfig.json", "utf8"),
      readFile("vitest.config.ts", "utf8"),
      readFile("python/pyproject.toml", "utf8"),
    ]);
    const packageManifest = JSON.parse(packageSource) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(packageManifest.scripts).sort()).toEqual([
      "build",
      "format",
      "format:check",
      "lint",
      "puzzle:build",
      "puzzle:evaluate",
      "puzzle:offline",
      "puzzle:run",
      "puzzle:sandbox:build",
      "test",
      "test:py",
      "test:ts",
      "typecheck",
      "verify",
      "verify:versions",
    ]);
    expect(Object.keys(packageManifest.devDependencies).sort()).toEqual([
      "@types/node",
      "oxfmt",
      "oxlint",
      "tsx",
      "typescript",
      "vitest",
    ]);
    expect(`${tsconfig}\n${vitest}`).not.toMatch(
      /@palimpsest\/(?:contracts|git-accounting|git-gateway|run-control)/,
    );
    expect(pyproject).toContain('dependencies = ["rfc8785==0.1.4"]');
    expect(pyproject).not.toMatch(/numpy|spacy|transformers|zstandard/);
  });
});
