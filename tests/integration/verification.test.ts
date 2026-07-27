import { access, readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  EXPECTED_TOOL_VERSIONS,
  readActualToolVersions,
  verifyDeclaredPins,
  verifyVersionMap,
} from "../../tools/evidence/verify-versions.js";

describe("pinned verification entry point", () => {
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

  test("pnpm and uv retain independent committed locks", async () => {
    await expect(access("pnpm-lock.yaml")).resolves.toBeUndefined();
    await expect(access("python/uv.lock")).resolves.toBeUndefined();
    const packageManifest = JSON.parse(await readFile("package.json", "utf8"));
    expect(packageManifest.scripts.verify).toContain("test:py");
    expect(packageManifest.scripts.verify).toContain("contracts:compare");
  });
});
