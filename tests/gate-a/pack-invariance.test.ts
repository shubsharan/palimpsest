import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { createNativeGitFixture, framesAcrossPackProfiles } from "../../tools/gate-a/native-git.js";

describe("native Git representation invariance", () => {
  test("produces one accounting frame across loose and varied pack encodings", async () => {
    const fixture = await createNativeGitFixture();
    try {
      const results = await framesAcrossPackProfiles(fixture);
      expect(results.map(({ profileId }) => profileId)).toEqual([
        "loose",
        "undeltified-compression-0",
        "shallow-delta-compression-1",
        "deep-delta-compression-9",
        "supported-client-clone",
        "thin-pack-receiver",
      ]);
      const frameDigests = new Set(
        results.map(({ frame }) => createHash("sha256").update(frame).digest("hex")),
      );
      expect(frameDigests).toHaveLength(1);
    } finally {
      await rm(fixture.repository, { force: true, recursive: true });
    }
  });
});
