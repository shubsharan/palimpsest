import { describe, expect, it } from "vitest";

import { canonicalJson, contentDigest } from "./canonical.js";

describe("canonical JSON", () => {
  it("is stable across object key order", () => {
    expect(canonicalJson({ b: 2, a: [true, null] })).toBe('{"a":[true,null],"b":2}');
    expect(contentDigest({ b: 2, a: 1 })).toBe(contentDigest({ a: 1, b: 2 }));
  });

  it("rejects non-JSON values and cycles", () => {
    expect(() => canonicalJson({ value: undefined })).toThrow(/JSON-compatible/i);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow(/JSON-compatible/i);
  });
});
