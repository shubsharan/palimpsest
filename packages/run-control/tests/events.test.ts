import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  test("serializes concurrent durable appends without gaps or reordering", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-events-"));
    const path = join(root, "events.jsonl");
    const chain = new EventChain("run-1", path);

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        chain.append({
          ...input,
          effectId: `effect-${index}`,
          monotonicElapsedNs: String(index + 1),
        }),
      ),
    );

    const recovered = await EventChain.read(path);
    expect(recovered.map((event) => event.sequence)).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
    expect(recovered).toEqual(chain.events);
  });

  test("recovers complete durable records and rejects a torn final append", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-events-"));
    const path = join(root, "events.jsonl");
    const chain = new EventChain("run-1", path);
    await chain.append(input);

    const complete = await readFile(path);
    await writeFile(path, Buffer.concat([complete, Buffer.from('{"schemaVersion":1')]));
    await expect(EventChain.resume("run-1", path)).rejects.toThrow(/torn final event/);

    await writeFile(path, complete);
    const recovered = await EventChain.resume("run-1", path);
    expect(recovered.events).toEqual(chain.events);
    expect(await recovered.append(input)).toEqual(chain.events[0]);
  });

  test("rejects gaps, reordering, duplicate effects, and clock regression", async () => {
    const chain = new EventChain("run-1");
    await chain.append(input);
    await chain.append({ ...input, effectId: "effect-2", monotonicElapsedNs: "2" });
    const [first, second] = chain.events;

    expect(() => EventChain.verify([{ ...first!, sequence: 2 }])).toThrow(/sequence/);
    expect(() => EventChain.verify([second!, first!])).toThrow(/sequence/);
    expect(() => EventChain.verify([first!, { ...second!, effectId: first!.effectId }])).toThrow(
      /effect identity/,
    );
    expect(() => EventChain.verify([first!, { ...second!, monotonicElapsedNs: "0" }])).toThrow(
      /monotonic time/,
    );
  });
});
