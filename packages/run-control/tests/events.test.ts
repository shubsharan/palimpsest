import { describe, expect, test } from "vitest";

import { EventChain } from "../src/events.js";

const input = {
  producer: "test",
  effectId: "effect-1",
  eventType: "test.event",
  monotonicElapsedNs: "1",
  payload: { accepted: true },
};

describe("run event chain", () => {
  test("is hash chained and idempotent by effect", async () => {
    const chain = new EventChain("run-1");
    const first = await chain.append(input);
    expect(await chain.append(input)).toEqual(first);
    await chain.append({ ...input, effectId: "effect-2", monotonicElapsedNs: "2" });
    expect(() => EventChain.verify(chain.events)).not.toThrow();
  });

  test("rejects conflicting duplicates and tampering", async () => {
    const chain = new EventChain("run-1");
    await chain.append(input);
    await expect(chain.append({ ...input, payload: { accepted: false } })).rejects.toThrow(
      /Conflicting duplicate/,
    );
    const tampered = [{ ...chain.events[0]!, digest: "0".repeat(64) }];
    expect(() => EventChain.verify(tampered)).toThrow(/digest mismatch/);
  });
});
