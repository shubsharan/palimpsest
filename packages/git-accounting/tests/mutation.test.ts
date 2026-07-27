import { describe, expect, test } from "vitest";

import {
  ACCOUNTING_VERSION,
  GIT_SHA256_OBJECT_FORMAT,
  encodeGitAccountingFrame,
  gitObjectOid,
  gitObjectTypes,
  refOperations,
  type GitAccountingFrameV1,
} from "../src/index.js";

function frame(content = "belief checkpoint\n"): GitAccountingFrameV1 {
  const bytes = Buffer.from(content);
  const oid = gitObjectOid(gitObjectTypes.blob, bytes);
  return {
    accountingVersion: ACCOUNTING_VERSION,
    authenticatedAgent: 1,
    newOid: oid,
    objectFormat: GIT_SHA256_OBJECT_FORMAT,
    objects: [{ content: bytes, oid, type: gitObjectTypes.blob }],
    oldOid: Buffer.alloc(32),
    operation: refOperations.create,
    publicationSlot: 1,
    refName: "refs/heads/agents/agent-1/evidence",
  };
}

describe("peer-visible accounting mutations", () => {
  test("changes frame bytes for every accepted header mutation", () => {
    const initial = frame();
    const baseline = encodeGitAccountingFrame(initial);
    for (const mutation of [
      { ...initial, authenticatedAgent: 2 },
      { ...initial, publicationSlot: 2 },
      { ...initial, refName: "refs/heads/agents/agent-1/alternate" },
    ]) {
      expect(encodeGitAccountingFrame(mutation)).not.toEqual(baseline);
    }
  });

  test("changes object and frame identity for every logical-content mutation", () => {
    const baseline = encodeGitAccountingFrame(frame());
    for (const content of [
      "belief checkpoint changed\n",
      "belief checkpoint\n\n",
      "author Evidence <changed@palimpsest.invalid>\n",
      "parent ".concat("1".repeat(64), "\n"),
    ]) {
      expect(encodeGitAccountingFrame(frame(content))).not.toEqual(baseline);
    }
  });
});
