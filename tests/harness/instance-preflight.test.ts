import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { preflightBundle } from "../../tools/harness/preflight.js";

describe("instance bundle preflight", () => {
  test("accepts the Python-produced bundle without puzzle conversion", async () => {
    await expect(preflightBundle("artifacts/harness/declared")).resolves.toMatchObject({
      schemaVersion: 1,
    });
  });

  test("rejects a tampered declared artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-preflight-"));
    const bundle = join(root, "bundle");
    await cp("artifacts/harness/declared", bundle, { recursive: true });
    await writeFile(join(bundle, "public/scaffold/README.md"), "tampered\n");
    await expect(preflightBundle(bundle)).rejects.toThrow(/digest mismatch/);
  });
});
