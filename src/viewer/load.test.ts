import { describe, expect, it } from "vitest";

import type { ObservationEvent } from "../trace.js";
import { normalizeViewerTrace } from "./load.js";

describe("viewer trace normalization", () => {
  it("pairs tool activity and keeps observable model and team events", () => {
    const events: ObservationEvent[] = [
      {
        sequence: 1,
        atMs: 10,
        kind: "model.response",
        agentId: "agent-1",
        data: { finalResponse: "I found a pattern." },
      },
      {
        sequence: 2,
        atMs: 20,
        kind: "tool.started",
        agentId: "agent-1",
        data: { id: "call-1", name: "run_command", arguments: { command: "pwd" } },
      },
      {
        sequence: 3,
        atMs: 25,
        kind: "team.message",
        data: {
          sequence: 1,
          author: "agent-2",
          message: "Check the repeated token.",
          occurredAtMs: 25,
        },
      },
      {
        sequence: 4,
        atMs: 40,
        kind: "tool.completed",
        agentId: "agent-1",
        data: { id: "call-1", name: "run_command", output: { stdout: "/workspace" } },
      },
    ];

    const normalized = normalizeViewerTrace(events);

    expect(normalized.events.map(({ category }) => category)).toEqual([
      "model",
      "tool",
      "team",
      "tool",
    ]);
    expect(normalized.toolCalls).toEqual([
      expect.objectContaining({
        id: "call-1",
        agentId: "agent-1",
        status: "completed",
        startedAtMs: 20,
        completedAtMs: 40,
      }),
    ]);
    expect(normalized.toolDetails.get(2)).toEqual({
      arguments: { command: "pwd" },
      output: { stdout: "/workspace" },
    });
    expect(normalized.events[0]).toMatchObject({
      display: { type: "model-response", finalResponse: "I found a pattern." },
    });
    expect(normalized.teamMessages).toEqual([
      expect.objectContaining({ author: "agent-2", message: "Check the repeated token." }),
    ]);
  });

  it("keeps unknown timeline markers lightweight and ignores malformed projections", () => {
    const normalized = normalizeViewerTrace([
      { sequence: 1, atMs: 0, kind: "future.event", data: { retained: true } },
      { sequence: 2, atMs: 1, kind: "team.message", data: { author: "invalid" } },
      { sequence: 3, atMs: 2, kind: "tool.completed", agentId: "agent-1", data: {} },
    ]);

    expect(normalized.events[0]).toEqual({
      sequence: 1,
      atMs: 0,
      kind: "future.event",
      category: "other",
    });
    expect(normalized.teamMessages).toEqual([]);
    expect(normalized.toolCalls).toEqual([]);
  });
});
