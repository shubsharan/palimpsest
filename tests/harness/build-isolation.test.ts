import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { buildHarnessBundle } from "../../tools/harness/build.js";

describe("deterministic harness build", () => {
  test("a repeated build leaves the declared bundle byte-identical", async () => {
    const before = await readFile("artifacts/harness/declared/bundle-manifest.json");
    await buildHarnessBundle();
    const after = await readFile("artifacts/harness/declared/bundle-manifest.json");
    expect(after).toEqual(before);
  }, 30_000);
});
