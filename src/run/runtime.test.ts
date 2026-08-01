import { describe, expect, it } from "vitest";

import {
  AttemptRuntime,
  AttemptRuntimeInfrastructureError,
  type AttemptRuntimeObservation,
} from "./runtime.js";
import type { ReleasedStage } from "./released-stage.js";
import type { InfrastructureError } from "../sandbox/contracts.js";
import { TEAM_MESSAGE_MAX_CHARACTERS, TEAM_MESSAGE_PAGE_SIZE } from "./team-channel.js";

const AGENTS = ["agent-1", "agent-2", "agent-3"] as const;

function stage(ordinal: number): ReleasedStage {
  return {
    ordinal,
    sourcePath: `/build/stage-${String(ordinal).padStart(2, "0")}.txt`,
    visiblePath: `/evidence/stage-${String(ordinal).padStart(2, "0")}.txt`,
  };
}

function fixture(
  options: {
    teamChannelEnabled?: boolean;
    observe?: (observation: AttemptRuntimeObservation) => void | Promise<void>;
    onFatal?: (error: InfrastructureError) => void;
    nowMs?: () => number;
  } = {},
) {
  const observations: AttemptRuntimeObservation[] = [];
  const runtime = new AttemptRuntime({
    agentIds: AGENTS,
    teamChannelEnabled: options.teamChannelEnabled ?? true,
    nowMs: options.nowMs ?? (() => 25),
    observe:
      options.observe ??
      ((observation) => {
        observations.push(observation);
      }),
    ...(options.onFatal === undefined ? {} : { onFatal: options.onFatal }),
  });
  return { runtime, observations };
}

describe("attempt runtime", () => {
  it("commits messages once before exposing identical ordered peer projections", async () => {
    const { runtime, observations } = fixture();
    const agent1 = runtime.forAgent("agent-1");
    const agent2 = runtime.forAgent("agent-2");
    const agent3 = runtime.forAgent("agent-3");

    await expect(agent2.teamChannel?.post("  Compare the repeated tokens.  ")).resolves.toEqual({
      sequence: 1,
      author: "agent-2",
      message: "Compare the repeated tokens.",
      occurredAtMs: 25,
    });
    await agent1.teamChannel?.post("I will test that mapping.");

    for (const handle of [agent1, agent2, agent3]) {
      expect(
        handle.teamChannel?.read(0).messages.map(({ sequence, author }) => [sequence, author]),
      ).toEqual([
        [1, "agent-2"],
        [2, "agent-1"],
      ]);
      await expect(handle.waitForActivity(0)).resolves.toMatchObject({
        sequence: 1,
        kind: "team-message",
      });
      expect(handle.latestActivitySequence).toBe(2);
      expect(Object.isFrozen(handle)).toBe(true);
      expect(Object.isFrozen(handle.teamChannel)).toBe(true);
    }
    expect(observations.filter(({ kind }) => kind === "team.message")).toHaveLength(2);
  });

  it("orders close after an in-flight post and rejects every later mutation", async () => {
    let releaseTrace: (() => void) | undefined;
    const traceBlocked = new Promise<void>((resolve) => {
      releaseTrace = resolve;
    });
    let traceStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      traceStarted = resolve;
    });
    const { runtime } = fixture({
      observe: async ({ kind }) => {
        if (kind === "team.message") {
          traceStarted?.();
          await traceBlocked;
        }
      },
    });
    const agent1 = runtime.forAgent("agent-1");
    const agent2 = runtime.forAgent("agent-2");

    const posting = agent1.teamChannel!.post("in flight");
    await started;
    const closing = runtime.close("time-exhausted");
    releaseTrace?.();

    await expect(posting).resolves.toMatchObject({ sequence: 1 });
    await expect(closing).resolves.toBeUndefined();
    await expect(agent2.waitForActivity(0)).resolves.toMatchObject({
      sequence: 1,
      kind: "team-message",
    });
    await expect(agent1.teamChannel!.post("too late")).rejects.toThrow("attempt ended");
    await expect(
      runtime.publishReleasedStage("agent-1", stage(1), () => undefined),
    ).rejects.toThrow("attempt ended");
  });

  it("returns immutable released-stage snapshots across later releases", async () => {
    const { runtime } = fixture({ teamChannelEnabled: false });
    const agent1 = runtime.forAgent("agent-1");

    await runtime.publishReleasedStage("agent-1", stage(1), () => undefined);
    const captured = agent1.captureReleasedStages();
    await runtime.publishReleasedStage("agent-1", stage(2), () => undefined);

    expect(captured.map(({ ordinal }) => ordinal)).toEqual([1]);
    expect(agent1.captureReleasedStages().map(({ ordinal }) => ordinal)).toEqual([1, 2]);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured[0])).toBe(true);
  });

  it("publishes Git activity only to the repository's assigned agents", async () => {
    const { runtime } = fixture({ teamChannelEnabled: false });
    await runtime.recordGitChange("agent-1", ["agent-1"], ["refs/heads/main"]);

    await expect(runtime.forAgent("agent-1").waitForActivity(0)).resolves.toMatchObject({
      kind: "git-changed",
      sequence: 1,
    });
    const waiting = runtime.forAgent("agent-2").waitForActivity(0);
    await runtime.close("sessions-ended");
    await expect(waiting).resolves.toEqual({ ended: true, reason: "sessions-ended" });
  });

  it("rejects invalid messages and pages without committing state", async () => {
    const { runtime, observations } = fixture();
    const channel = runtime.forAgent("agent-1").teamChannel!;

    await expect(channel.post(" \n ")).rejects.toThrow("non-whitespace");
    await expect(channel.post("x".repeat(TEAM_MESSAGE_MAX_CHARACTERS + 1))).rejects.toThrow(
      "at most 4000",
    );
    expect(() => channel.read(-1)).toThrow("non-negative safe integer");
    for (let index = 0; index < TEAM_MESSAGE_PAGE_SIZE + 1; index += 1) {
      await channel.post(`message ${String(index + 1)}`);
    }
    expect(channel.read(0)).toMatchObject({
      latestSequence: TEAM_MESSAGE_PAGE_SIZE + 1,
      nextSequence: TEAM_MESSAGE_PAGE_SIZE,
      hasMore: true,
    });
    expect(observations.filter(({ kind }) => kind === "team.message")).toHaveLength(
      TEAM_MESSAGE_PAGE_SIZE + 1,
    );
  });

  it("publishes a stage without waiting behind unrelated trace persistence", async () => {
    let releaseTrace: (() => void) | undefined;
    const traceBlocked = new Promise<void>((resolve) => {
      releaseTrace = resolve;
    });
    let traceStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      traceStarted = resolve;
    });
    const { runtime } = fixture({
      observe: async ({ kind }) => {
        if (kind === "team.message") {
          traceStarted?.();
          await traceBlocked;
        }
      },
    });
    const agent1 = runtime.forAgent("agent-1");
    const posting = runtime.forAgent("agent-2").teamChannel!.post("trace backlog");
    await started;

    let visible = false;
    const publishing = runtime.publishReleasedStage("agent-1", stage(1), () => {
      visible = true;
    });

    expect(visible).toBe(true);
    expect(agent1.captureReleasedStages()).toEqual([stage(1)]);
    await expect(agent1.waitForActivity(1)).resolves.toMatchObject({
      sequence: 2,
      kind: "stage-released",
    });
    releaseTrace?.();
    await expect(Promise.all([posting, publishing])).resolves.toBeDefined();
  });

  it("poisons the attempt when a live commit cannot be persisted", async () => {
    const fatalErrors: InfrastructureError[] = [];
    const { runtime } = fixture({
      observe: () => {
        throw new Error("trace unavailable");
      },
      onFatal: (error) => {
        fatalErrors.push(error);
      },
    });
    const agent1 = runtime.forAgent("agent-1");
    const agent2 = runtime.forAgent("agent-2");

    await expect(agent1.teamChannel!.post("not accepted")).rejects.toThrow(
      AttemptRuntimeInfrastructureError,
    );
    expect(agent1.teamChannel!.read(0).messages).toHaveLength(1);
    expect(agent1.latestActivitySequence).toBe(1);
    await expect(agent2.waitForActivity(1)).resolves.toEqual({
      ended: true,
      reason: "infrastructure-error",
    });
    await expect(
      runtime.publishReleasedStage("agent-1", stage(1), () => undefined),
    ).rejects.toThrow("attempt ended");
    expect(fatalErrors).toHaveLength(1);
  });
});
