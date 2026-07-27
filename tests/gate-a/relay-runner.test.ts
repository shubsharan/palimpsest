import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { runRelayCodec } from "../../tools/gate-a/relay-runner.js";

describe("network-isolated relay codecs", () => {
  test.each(["deflate-9", "zstandard-22"])(
    "promotes an exact %s reconstruction from a fresh isolated subprocess",
    async (strategyId) => {
      const geometryId = "tokens-16384-vocab-4096";
      const result = await runRelayCodec({
        fixtureMetadataPath: resolve(`artifacts/gate-a/inputs/fixtures/${geometryId}.json`),
        opaquePath: resolve(`artifacts/gate-a/inputs/fixtures/${geometryId}.opaque.txt`),
        sourceRoot: resolve("artifacts/gate-a/inputs/sources"),
        strategyId,
      });
      expect(result.exactReconstruction).toBe(true);
      expect(result.encoded.length).toBe(result.encodedByteLength);
      expect(result.networkIsolation).toMatch(/network/);
    },
    30_000,
  );
});
