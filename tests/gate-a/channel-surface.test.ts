import { describe, expect, test } from "vitest";

import {
  refOperations,
  validateRefName,
  validateRefTransition,
  validateTreeEntries,
} from "@palimpsest/git-accounting";

describe("peer-visible channel closure", () => {
  test.each([
    "refs/tags/unmetered",
    "refs/notes/unmetered",
    "refs/replace/unmetered",
    "refs/heads/other/work",
    "refs/heads/agents/agent-1/work.lock",
  ])("rejects non-accounted ref surface %s", (refName) => {
    expect(() => validateRefName(refName)).toThrow();
  });

  test.each([
    { mode: "120000", path: "symlink", type: "blob" },
    { mode: "160000", path: "submodule", type: "commit" },
    { mode: "100644", path: ".gitattributes", type: "blob" },
    { mode: "100644", path: ".gitmodules", type: "blob" },
  ])("rejects unsafe tree surface $path", ({ mode, path, type }) => {
    expect(() => validateTreeEntries([{ mode, oid: "1".repeat(64), path, type }])).toThrow();
  });

  test("forbids deletion and no-op update transitions", () => {
    const zero = Buffer.alloc(32);
    const oid = Buffer.alloc(32, 1);
    expect(() => validateRefTransition(refOperations.update, oid, zero)).toThrow();
    expect(() => validateRefTransition(refOperations.update, oid, oid)).toThrow();
  });
});
