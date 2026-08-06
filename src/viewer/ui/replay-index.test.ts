import { describe, expect, it } from "vitest";

import type { DecodeCheckpoint, ViewerRun } from "../contracts.js";
import {
  appendDecodeCheckpoint,
  buildMapLayout,
  buildViewerReplayIndex,
  countCiphertextWords,
  decodeStateName,
  filterViewerLane,
  MAP_COLORS,
  replayTimeAt,
  stateColor,
  tokenizeLines,
  upperBound,
} from "./replay-index.js";

function run(): ViewerRun {
  return {
    runId: "index-test",
    status: "completed",
    startedAt: "2026-01-01T00:00:00.000Z",
    frozenAt: "2026-01-01T00:01:00.000Z",
    durationMs: 60_000,
    communicationMode: "shared",
    fixtureId: "fixture-test",
    variantId: "stationary",
    rekeyAtStage: null,
    treatmentSummary:
      "1 agent on a shared channel receives 1 timed evidence drop; the cipher stays fixed. No checker · 1-minute cutoff.",
    schedule: {
      releases: [{ ordinal: 1, offsetMs: 0, isRekey: false }],
      cutoffMs: 60_000,
      rekeyOrdinal: null,
      rekeyAtMs: null,
    },
    tokenLimitPerAgent: null,
    spendCeilingCents: 0,
    hasChecker: false,
    agents: [
      {
        agentId: "agent-1",
        profile: "fake",
        requestedModel: "requested",
        actualModel: "actual",
        session: {
          state: "finished",
          inputTokens: 0,
          outputTokens: 0,
          terminationReason: "voluntary final response",
        },
      },
    ],
    origins: [{ originId: "shared", agentIds: ["agent-1"], finalCommit: null }],
    finalScores: [],
    ciphertext: "one two three",
    events: [
      {
        sequence: 1,
        atMs: 10,
        kind: "model.response",
        category: "model",
        agentId: "agent-1",
        display: { type: "model-response", finalResponse: "response" },
      },
      {
        sequence: 3,
        atMs: 20,
        kind: "stage.released",
        category: "stage",
        agentId: "agent-1",
        display: { type: "milestone", label: "Evidence stage 1 released" },
      },
    ],
    toolCalls: [
      {
        id: "call-1",
        agentId: "agent-1",
        name: "run_command",
        startedSequence: 2,
        startedAtMs: 15,
        completedSequence: 4,
        completedAtMs: 25,
        status: "completed",
      },
    ],
    teamMessages: [
      { sequence: 1, traceSequence: 5, atMs: 30, author: "agent-1", message: "message" },
    ],
  };
}

function checkpoint(
  checkpointId: string,
  atMs: number,
  deltas: NonNullable<DecodeCheckpoint["deltas"]>,
): DecodeCheckpoint {
  return {
    checkpointId,
    originId: "shared",
    commit: checkpointId.padEnd(40, "0"),
    atMs,
    timing: "exact",
    author: "Agent",
    subject: checkpointId,
    status: "ready",
    deltas,
  };
}

describe("viewer replay index", () => {
  it("indexes lane entries and completion boundaries once", () => {
    const index = buildViewerReplayIndex(run());
    const lane = index.lanes[0]!;
    expect(lane.model).toBe("actual");
    expect(lane.items.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(lane.transitionTimes).toEqual([10, 15, 20, 25]);
    expect(index.teamMessageTimes).toEqual([30]);

    const filtered = filterViewerLane(lane, new Set(["tool"]));
    expect(filtered.items.map(({ sequence }) => sequence)).toEqual([2]);
    expect(filtered.transitionTimes).toEqual([15, 25]);
  });

  it("uses inclusive binary-search boundaries for forward and backward scrubbing", () => {
    const times = [10, 15, 20, 25];
    expect(upperBound(times, 9)).toBe(0);
    expect(upperBound(times, 10)).toBe(1);
    expect(upperBound(times, 24)).toBe(3);
    expect(upperBound(times, 25)).toBe(4);
    expect(upperBound(times, 12)).toBe(1);
  });

  it("anchors playback to wall time at every supported speed", () => {
    expect([1, 10, 60, 300].map((speed) => replayTimeAt(1_000, 2_000, speed, 1_000_000))).toEqual([
      3_000, 21_000, 121_000, 601_000,
    ]);
    expect(replayTimeAt(900_000, 2_000, 300, 1_000_000)).toBe(1_000_000);
    expect(replayTimeAt(1_000, -100, 60, 1_000_000)).toBe(1_000);
  });

  it("materializes compact checkpoint snapshots and retains prior state on failures", () => {
    const first = checkpoint("a", 10, [
      { index: 0, candidate: "ONE", state: "newly-correct" },
      { index: 1, candidate: "TWO", state: "changed-incorrect" },
    ]);
    const second = checkpoint("b", 20, [{ index: 1, candidate: "two", state: "newly-correct" }]);
    const failed: DecodeCheckpoint = {
      ...checkpoint("c", 30, []),
      status: "failed",
      error: "solver failed",
    };
    const afterFirst = appendDecodeCheckpoint([], first, 3);
    const afterSecond = appendDecodeCheckpoint(afterFirst, second, 3);
    const afterFailure = appendDecodeCheckpoint(afterSecond, failed, 3);

    expect(afterFirst[0]!.candidates).toEqual(["ONE", "TWO", undefined]);
    expect([...afterFirst[0]!.states].map(decodeStateName)).toEqual([
      "newly-correct",
      "changed-incorrect",
      "unchanged",
    ]);
    expect([...afterSecond[1]!.states].map(decodeStateName)).toEqual([
      "previously-correct",
      "newly-correct",
      "unchanged",
    ]);
    expect(afterFailure[2]!.candidates).toBe(afterSecond[1]!.candidates);
    expect(afterFailure[2]!.states).toBe(afterSecond[1]!.states);
    expect(
      upperBound(
        afterFailure.map(({ checkpoint: item }) => item.atMs),
        15,
      ),
    ).toBe(1);
    expect(appendDecodeCheckpoint(afterFailure, second, 3)).toBe(afterFailure);
  });

  it("rejects malformed checkpoint ordering and word indexes", () => {
    const current = appendDecodeCheckpoint([], checkpoint("b", 20, []), 3);
    expect(() => appendDecodeCheckpoint(current, checkpoint("a", 10, []), 3)).toThrow(
      /out of order/,
    );
    expect(() =>
      appendDecodeCheckpoint(
        [],
        checkpoint("d", 10, [{ index: 3, candidate: "x", state: "unchanged" }]),
        3,
      ),
    ).toThrow(/exceeds the ciphertext/);
    expect(countCiphertextWords("one two's three\nfour")).toBe(4);
  });

  it("tokenizes lines into plain and word spans with running word indexes", () => {
    const lines = tokenizeLines("one two\n  three");
    expect(lines).toEqual([
      {
        key: 0,
        spans: [
          { surface: "one", wordIndex: 0 },
          { surface: " " },
          { surface: "two", wordIndex: 1 },
        ],
      },
      {
        key: 1,
        spans: [{ surface: "  " }, { surface: "three", wordIndex: 2 }],
      },
    ]);
    // Word indexes stay aligned with countCiphertextWords across the whole text.
    const spanWords = lines.flatMap((line) =>
      line.spans.filter((span) => span.wordIndex !== undefined),
    );
    expect(spanWords).toHaveLength(countCiphertextWords("one two\n  three"));
  });

  it("keeps a trailing word as the final span without a following plain span", () => {
    // Regression: rendering a line that ends in a word must not assume a trailing span exists.
    const [line] = tokenizeLines("alpha beta");
    expect(line!.spans.at(-1)).toEqual({ surface: "beta", wordIndex: 1 });
  });
});

describe("buildMapLayout", () => {
  it("groups words per source line with a continuous wordIndex", () => {
    const layout = buildMapLayout("the sea\nrose high");
    expect(layout.wordCount).toBe(4);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]!.words).toEqual([
      { wordIndex: 0, length: 3 },
      { wordIndex: 1, length: 3 },
    ]);
    expect(layout.lines[1]!.words).toEqual([
      { wordIndex: 2, length: 4 },
      { wordIndex: 3, length: 4 },
    ]);
  });

  it("keeps a blank line as an empty row so paragraph spacing shows", () => {
    const layout = buildMapLayout("a\n\nb");
    expect(layout.lines).toHaveLength(3);
    expect(layout.lines[1]!.words).toEqual([]);
    expect(layout.wordCount).toBe(2);
  });

  it("returns no words for empty ciphertext", () => {
    const layout = buildMapLayout("");
    expect(layout.wordCount).toBe(0);
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0]!.words).toEqual([]);
  });
});

describe("stateColor", () => {
  it("maps decode states to the manuscript palette", () => {
    expect(stateColor(1, true)).toBe(MAP_COLORS.fresh); // newly-correct
    expect(stateColor(2, true)).toBe(MAP_COLORS.ink); // previously-correct
    expect(stateColor(3, true)).toBe(MAP_COLORS.regress); // regressed
    expect(stateColor(4, true)).toBe(MAP_COLORS.amber); // changed-incorrect
  });

  it("distinguishes ciphered from resolved for unchanged words", () => {
    expect(stateColor(0, false)).toBe(MAP_COLORS.ciphered);
    expect(stateColor(0, true)).toBe(MAP_COLORS.ink);
  });
});
