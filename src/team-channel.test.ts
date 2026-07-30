import { describe, expect, it } from "vitest";

import { ActivityBus } from "./activity.js";
import {
  TeamChannel,
  TEAM_MESSAGE_MAX_CHARACTERS,
  TEAM_MESSAGE_PAGE_SIZE,
} from "./team-channel.js";

function fixture(nowMs = 25) {
  const activities = {
    "agent-1": new ActivityBus(),
    "agent-2": new ActivityBus(),
    "agent-3": new ActivityBus(),
  };
  const observed: unknown[] = [];
  const channel = new TeamChannel({
    activities,
    nowMs: () => nowMs,
    observe: (message) => {
      observed.push(message);
    },
  });
  return { activities, observed, channel };
}

describe("team channel", () => {
  it("orders accepted posts, derives authorship, and wakes every peer stream", async () => {
    const { activities, observed, channel } = fixture();

    await expect(channel.post("agent-2", "  Compare the repeated tokens.  ")).resolves.toEqual({
      sequence: 1,
      author: "agent-2",
      message: "Compare the repeated tokens.",
      occurredAtMs: 25,
    });
    await channel.post("agent-1", "I will test that mapping.");

    expect(channel.read(0).messages.map(({ sequence, author }) => [sequence, author])).toEqual([
      [1, "agent-2"],
      [2, "agent-1"],
    ]);
    expect(observed).toHaveLength(2);
    for (const activity of Object.values(activities)) {
      expect(activity.events).toEqual([
        expect.objectContaining({
          kind: "team-message",
          detail: { messageSequence: 1, author: "agent-2" },
        }),
        expect.objectContaining({
          kind: "team-message",
          detail: { messageSequence: 2, author: "agent-1" },
        }),
      ]);
    }
  });

  it("serializes concurrent posts and accepts nothing if durable observation fails", async () => {
    const { channel } = fixture();
    const posts = await Promise.all([
      channel.post("agent-1", "first"),
      channel.post("agent-2", "second"),
      channel.post("agent-3", "third"),
    ]);
    expect(posts.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);

    const activities = {
      "agent-1": new ActivityBus(),
      "agent-2": new ActivityBus(),
      "agent-3": new ActivityBus(),
    };
    const unavailableTrace = new TeamChannel({
      activities,
      nowMs: () => 25,
      observe: () => {
        throw new Error("trace unavailable");
      },
    });
    await expect(unavailableTrace.post("agent-1", "not accepted")).rejects.toThrow(
      "trace unavailable",
    );
    expect(unavailableTrace.latestSequence).toBe(0);
    expect(activities["agent-2"].events).toEqual([]);
  });

  it("returns fixed pages with explicit cursors", async () => {
    const { channel } = fixture();
    for (let index = 0; index < TEAM_MESSAGE_PAGE_SIZE + 1; index += 1) {
      await channel.post("agent-3", `message ${String(index + 1)}`);
    }

    expect(channel.read(0)).toMatchObject({
      messages: expect.any(Array),
      latestSequence: TEAM_MESSAGE_PAGE_SIZE + 1,
      nextSequence: TEAM_MESSAGE_PAGE_SIZE,
      hasMore: true,
    });
    expect(channel.read(TEAM_MESSAGE_PAGE_SIZE)).toMatchObject({
      messages: [expect.objectContaining({ sequence: TEAM_MESSAGE_PAGE_SIZE + 1 })],
      nextSequence: TEAM_MESSAGE_PAGE_SIZE + 1,
      hasMore: false,
    });
    expect(channel.read(100)).toEqual({
      messages: [],
      latestSequence: TEAM_MESSAGE_PAGE_SIZE + 1,
      nextSequence: 100,
      hasMore: false,
    });
  });

  it("rejects invalid content, cursors, and time without accepting a message", async () => {
    const { channel, observed } = fixture();
    await expect(channel.post("agent-1", " \n ")).rejects.toThrow("non-whitespace");
    await expect(
      channel.post("agent-1", "x".repeat(TEAM_MESSAGE_MAX_CHARACTERS + 1)),
    ).rejects.toThrow("at most 4000");
    expect(() => channel.read(-1)).toThrow("non-negative safe integer");
    expect(channel.latestSequence).toBe(0);
    expect(observed).toEqual([]);

    const invalidTime = fixture(Number.NaN);
    await expect(invalidTime.channel.post("agent-1", "hello")).rejects.toThrow(
      "finite non-negative",
    );
  });
});
