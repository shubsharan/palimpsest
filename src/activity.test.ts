import { describe, expect, it } from "vitest";

import { ActivityBus } from "./activity.js";

describe("activity", () => {
  it("wakes only agents that can see a private stage and wakes all agents for Git", async () => {
    const bus = new ActivityBus();
    const agent1 = bus.waitForVisible("agent-1", 0);
    const agent2 = bus.waitForVisible("agent-2", 0);

    bus.publish({ kind: "stage-released", agentId: "agent-1", detail: { ordinal: 2 } });
    await expect(agent1).resolves.toMatchObject({ kind: "stage-released", sequence: 1 });
    expect(bus.visibleAfter("agent-2", 0)).toEqual([]);

    bus.publish({ kind: "git-changed", detail: { refs: ["refs/heads/main"] } });
    await expect(agent2).resolves.toMatchObject({ kind: "git-changed", sequence: 2 });
  });

  it("returns unseen activity immediately and reports attempt end to later waiters", async () => {
    const bus = new ActivityBus();
    bus.publish({ kind: "git-changed", detail: {} });
    await expect(bus.waitForVisible("agent-3", 0)).resolves.toMatchObject({ sequence: 1 });
    bus.end("time-exhausted");
    await expect(bus.waitForVisible("agent-3", 1)).resolves.toEqual({
      ended: true,
      reason: "time-exhausted",
    });
  });
});
