import { describe, expect, it } from "vitest";

import { ActivityBus } from "./activity.js";

describe("activity", () => {
  it("keeps private agent streams contiguous without hidden peer sequence gaps", () => {
    const agent1 = new ActivityBus();
    const agent2 = new ActivityBus();

    agent1.publish({ kind: "stage-released", detail: { ordinal: 2 } });
    agent1.publish({ kind: "git-changed", detail: { refs: ["refs/heads/agent-1"] } });
    agent2.publish({ kind: "stage-released", detail: { ordinal: 2 } });

    expect(agent1.events.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(agent2.events).toEqual([
      expect.objectContaining({ kind: "stage-released", sequence: 1 }),
    ]);
  });

  it("returns unseen activity immediately and reports attempt end to later waiters", async () => {
    const bus = new ActivityBus();
    bus.publish({ kind: "git-changed", detail: {} });
    await expect(bus.waitFor(0)).resolves.toMatchObject({ sequence: 1 });
    bus.end("time-exhausted");
    await expect(bus.waitFor(1)).resolves.toEqual({
      ended: true,
      reason: "time-exhausted",
    });
  });
});
