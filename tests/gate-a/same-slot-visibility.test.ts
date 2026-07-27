import { describe, expect, test } from "vitest";

import {
  VisibilityJournal,
  gitObjectOid,
  gitObjectTypes,
  type LogicalGitObject,
} from "@palimpsest/git-accounting";

function blob(content: string): LogicalGitObject {
  const bytes = Buffer.from(content);
  return {
    content: bytes,
    oid: gitObjectOid(gitObjectTypes.blob, bytes),
    type: gitObjectTypes.blob,
  };
}

describe("slot-start visibility journal", () => {
  test("charges duplicate same-slot exposure independently, then unions accepted state", () => {
    const shared = blob("same-slot shared object\n");
    const slotStart = new VisibilityJournal();
    const leftCandidate = [shared, blob("left\n")];
    const rightCandidate = [shared, blob("right\n")];

    expect(leftCandidate.filter((object) => !slotStart.has(object.oid))).toContain(shared);
    expect(rightCandidate.filter((object) => !slotStart.has(object.oid))).toContain(shared);
    expect(slotStart.has(shared.oid)).toBe(false);

    const nextSlot = slotStart.withAcceptedObjects([leftCandidate, rightCandidate]);
    expect(nextSlot.values()).toHaveLength(3);
    expect(nextSlot.has(shared.oid)).toBe(true);
    expect(slotStart.has(shared.oid)).toBe(false);
  });
});
