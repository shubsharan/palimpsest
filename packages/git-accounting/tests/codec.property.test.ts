import { describe, expect, test } from "vitest";

import {
  ACCOUNTING_VERSION,
  GIT_SHA256_OBJECT_FORMAT,
  decodeGitAccountingFrame,
  encodeGitAccountingFrame,
  gitObjectOid,
  gitObjectTypes,
  refOperations,
  type GitAccountingFrameV1,
} from "../src/index.js";

function frameFor(seed: number): GitAccountingFrameV1 {
  const contents = Array.from({ length: 1 + (seed % 17) }, (_, index) =>
    Buffer.from(`seed=${seed};object=${index};payload=${"x".repeat((seed * 31 + index) % 257)}\n`),
  );
  const objects = contents.map((content) => ({
    content,
    oid: gitObjectOid(gitObjectTypes.blob, content),
    type: gitObjectTypes.blob,
  }));
  return {
    accountingVersion: ACCOUNTING_VERSION,
    authenticatedAgent: seed % 65_536,
    newOid: objects[0]!.oid,
    objectFormat: GIT_SHA256_OBJECT_FORMAT,
    objects,
    oldOid: Buffer.alloc(32),
    operation: refOperations.create,
    publicationSlot: seed * 17,
    refName: `refs/heads/agents/agent-${seed % 32}/property-${seed}`,
  };
}

describe("GitAccountingFrameV1 deterministic properties", () => {
  test("preserves decode/re-encode identity over varied bounded frames", () => {
    for (let seed = 0; seed < 128; seed += 1) {
      const encoded = encodeGitAccountingFrame(frameFor(seed));
      expect(encodeGitAccountingFrame(decodeGitAccountingFrame(encoded))).toEqual(encoded);
    }
  });

  test("rejects every single-byte truncation near each structural boundary", () => {
    const encoded = encodeGitAccountingFrame(frameFor(9));
    for (const length of [0, 1, 7, 8, 15, 16, 17, 24, 63, encoded.length - 1]) {
      expect(() => decodeGitAccountingFrame(encoded.subarray(0, length))).toThrow();
    }
  });
});
